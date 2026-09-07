---
name: SKILL-data-schema
description: Postgres schema, normalized log format, feature spec, and the exact credibility-score formula. Read before writing migrations, ingestion, or watchdog code.
---

# VerdictChain — Data Schema (LOCKED)

## 1. Normalized log schema (output of the ingestion/normalization step)

All three raw sources (CICIDS2017 subset, CERT r4.2 subset, Docker-simulated logs)
are converted into one common shape before anything else touches them:

| Column | Type | Notes |
|---|---|---|
| row_id | UUID / serial PK | referenced by every agent's cited_evidence |
| timestamp | timestamptz | |
| source | text | e.g. `cicids2017`, `cert_r4.2_logon`, `cert_r4.2_file`, `docker_sim` |
| source_file | text | original filename, for traceability |
| event_type | text | e.g. `network_flow`, `file_access`, `logon`, `device_event` |
| user_id | text, nullable | present for CERT-derived rows |
| host_id | text, nullable | |
| severity | text, nullable | only if the source provides it |
| raw_fields | jsonb | the full original row, untouched, for citation lookups |
| ground_truth_label | text, nullable | scenario tag — NEVER exposed to agents, evaluation-only |

## 2. Core Postgres tables

```sql
CREATE TABLE raw_logs (
    row_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL,
    source_file TEXT,
    event_type TEXT NOT NULL,
    user_id TEXT,
    host_id TEXT,
    severity TEXT,
    raw_fields JSONB NOT NULL,
    ground_truth_label TEXT
);
CREATE INDEX idx_raw_logs_timestamp ON raw_logs (timestamp);
CREATE INDEX idx_raw_logs_source ON raw_logs (source);

CREATE TABLE investigations (
    investigation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger_type TEXT NOT NULL,          -- 'continuous' | 'manual'
    trigger_reason TEXT,
    scenario_label TEXT,                 -- hidden ground truth if manual; never sent to agents
    status TEXT NOT NULL DEFAULT 'investigating',  -- investigating | verdict_reached | contained | ambiguous
    verdict_class TEXT,
    verdict_confidence FLOAT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE debate_transcripts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID REFERENCES investigations(investigation_id),
    round INT NOT NULL,
    agent_id TEXT NOT NULL,
    theory TEXT NOT NULL,
    confidence FLOAT NOT NULL,
    cited_evidence JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE credibility_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID REFERENCES investigations(investigation_id),
    agent_id TEXT NOT NULL,
    round INT NOT NULL,
    crs_before FLOAT NOT NULL,
    crs_after FLOAT NOT NULL,
    verification_match_rate FLOAT NOT NULL,
    isolated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE response_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID REFERENCES investigations(investigation_id),
    action_type TEXT NOT NULL,           -- lock_account | block_ip_range | trigger_rate_limiting | trigger_audit
    target TEXT NOT NULL,
    reason TEXT,
    is_simulated BOOLEAN NOT NULL DEFAULT TRUE,  -- must always be TRUE — see SKILL-security.md
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE model_versions (
    version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trained_at TIMESTAMPTZ DEFAULT now(),
    accuracy FLOAT,
    false_positive_rate FLOAT,
    is_deployed BOOLEAN DEFAULT FALSE,
    notes TEXT
);

CREATE TABLE audit_trail (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID REFERENCES investigations(investigation_id),
    actor TEXT NOT NULL,                 -- agent_id or analyst identifier
    action TEXT NOT NULL,
    detail JSONB,
    prev_hash TEXT,                      -- hash-chained, see SKILL-security.md
    entry_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE analyst_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investigation_id UUID REFERENCES investigations(investigation_id),
    verdict_was_correct BOOLEAN NOT NULL,   -- true = confirmed threat, false = false positive
    created_at TIMESTAMPTZ DEFAULT now()
);
```

Use Alembic for all schema changes — never hand-edit the DB outside a migration.

## 3. Feature extraction spec (CICIDS2017 branch)

Keep only the columns listed as "wanted" in the merge/clean script already produced
for this project (network volume/rate, packet-size stats, IAT timing, TCP flags,
subflow, init-window, and Active/Idle mean-std-max-min for C2 beaconing). Drop the
known zero-variance columns (Bwd PSH Flags, Fwd/Bwd URG Flags, CWE Flag Count, all
6 "Bulk" columns) and the duplicate `Fwd Header Length` column. Clean inf/-inf
values (common in `Flow Bytes/s`, `Flow Packets/s`) before anything touches them.

## 4. Feature extraction spec (CERT r4.2 branch)

Aggregate `logon.csv`, `device.csv`, `file.csv` into per-user, per-time-bin features:
- failed/succeeded logon counts per bin
- distinct device IDs seen per user per bin (flag new/rare devices)
- file-access count per bin, plus a department-mismatch boolean (user dept vs.
  file/resource owner dept, if derivable from the LDAP/org data if included)
- off-hours boolean (outside that user's typical login-hour range, computed from
  their own history, not a single global cutoff)

## 5. Credibility Score (CrS) — exact formula

```
CrS_new = clamp( CrS_old * (1 + η * verification_match_rate), 0.0, 1.0 )
```
- `η` (eta) = 0.15 by default (exposed in Settings as "Trust Threshold" tab).
- `verification_match_rate` = (# cited_evidence entries that matched raw_logs) /
  (total # cited_evidence entries) for that agent in that round.
- Starting CrS for any agent (including a freshly-activated backup) = 0.5 (neutral,
  not zero — avoids unfairly punishing a new agent instantly).
- **Isolation threshold: 0.30.** CrS < 0.30 → isolate + activate backup, log to
  `credibility_log` with `isolated = true`.

## 6. Ground-truth handling — hard boundary

`ground_truth_label` (on `raw_logs`) and `scenario_label` (on `investigations`) exist
ONLY for evaluation (precision/recall/F1 computation) and for the manual-trigger
selection UI. No code path in `backend/agents/` may read either column. Enforce this
with a code-review checklist item, and ideally a lint rule / import boundary if
feasible in the chosen framework.
