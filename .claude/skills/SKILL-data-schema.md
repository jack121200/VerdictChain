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

### 2.1 Read and evidence endpoints (W1-C, plan section 3.4)

All numbers are `Metric` envelopes (`value`, `n`, `as_of`, `source`, `definition`, `reason`). A null value
always has a reason. Counts are real zeros. Nothing returned here includes `scenario_label` or
`ground_truth_label`, except `/scenarios` and `/evaluation`, which are analyst-only analytics.

| Endpoint | Purpose | Notes |
|---|---|---|
| `GET /stats` | Headline KPIs | Whole audit chain verified per call. Brier from analyst feedback only. |
| `GET /investigations` | Filtered list | `limit` 1..200, `offset`, `status`, `verdict_class`, `trigger_type`, `primary_agent`, `q` (id prefix, verdict, trigger). |
| `GET /investigations/{id}` | Detail | `debate` (stance and provider per transcript row), `votes` (`classify_theory` plus matched keywords), `citations`, `credibility`, `actions` (`is_simulated`). |
| `GET /investigations/{id}/citations` | Per-citation re-check | VERIFIED, DISCREPANCY or INVALID_ROW with a reason and `row_fingerprint`. |
| `GET /citations` | Global ledger | Paged `limit` 1..200 and `offset`; filters `agent_id`, `status`; adds `investigation_id`. |
| `GET /investigations/{id}/evidence-bundle` | Bundle plus SHA-256 | `bundle`, `bundle_sha256`, `signatures`. See 2.2. |
| `POST /investigations/{id}/sign` | Audited acknowledgement | Capability `sign_evidence_bundle`. Status must be verdict_reached, contained or ambiguous, else 409. Not a cryptographic signature. |
| `GET /raw-logs/{row_id}`, `/recent`, `/counts` | Allow-listed rows and counts | `raw_fields` sanitised: NaN and inf dropped, strings to 2000 chars, control characters removed, nesting capped at 6. |
| `GET /agents/fleet` | Investigator fleet | Signals are checked against each agent's prompt. Provider chain is read from the agent source. Temperature is read from `llm_clients.py`. |
| `GET /agents/{id}/credibility-history` | CrS trajectory | `limit` 1..500, `since`; oldest first. |
| `GET /audit-trail` | Audit entries | Filters `action`, `actor`, `investigation_id`, `before_seq`. Returns `hash_input` (the exact pre-image). |
| `POST /audit-trail/verify` | Whole-chain verify | 10 per minute per analyst. Not audited. |
| `GET /response-actions` | Containment actions | Adds `id` and `investigation_id`. |
| `GET /scenarios` | Eight labels with row counts | `primary_agent` is the dominant domain of the label's rows (ties: network, access, endpoint). |
| `GET /evaluation` | Accuracy and per-class metrics | Labelled investigations that reached a verdict only. Mapping in 6. |

### 2.2 Evidence bundle canonical form

The bundle is `investigation_id`, `verdict`, `transcript`, `credibility`, `actions` and `citations`. It has
no labels and no timestamps of the read itself. It is serialised with sorted keys, compact separators
(`,` and `:`), UTF-8, and `ensure_ascii=False`. Numbers follow JavaScript: an integral float is written
as an int (`1.0` becomes `1`), and other floats are rounded to 6 decimal places. The browser recomputes
the SHA-256 from `JSON.stringify` of the same sorted form.

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
CrS_new = clamp( CrS_old * (1 + η * (2 * verification_match_rate − 1)), 0.0, 1.0 )
```
- `η` (eta) = 0.20 by default (runtime setting `eta`, range [0.01, 0.5], shown as the "Trust Threshold" tab).
- Rate 0.5 leaves CrS unchanged. Rate 1 grows it by η. Rate 0 shrinks it by η.
- `verification_match_rate` = (# cited_evidence entries that matched raw_logs) /
  (total # cited_evidence entries) for that agent in that round.
- Starting CrS for any agent (including a freshly-activated backup) = 0.5 (neutral,
  not zero — avoids unfairly punishing a new agent instantly).
- **Isolation threshold: 0.30** (runtime setting `isolation_threshold`). CrS below it →
  the agent's `agent_quarantine` row is set active, and `credibility_log` records
  `isolated = true`. From 0.5 with η = 0.20, three consecutive rate-0 rounds (0.40, 0.32, 0.256) isolate an agent,
  so an agent none of whose citations verify for a whole 3-round debate is isolated when round 3
  is scored. (Default η was 0.15 until 2026-10-09; migration 0007 moves an unedited row.)

**Formula resolved 2026-10-05, owner-approved.** The earlier multiplier `(1 + η·rate)` could
only hold or grow CrS, so isolation was unreachable from 0.5. The corrected form shrinks CrS
when the rate is below 0.5, and `backend/watchdog/credibility.py` implements it as
`compute_crs(c, rate, eta)`.

## 6. Ground-truth handling — hard boundary

`ground_truth_label` (on `raw_logs`) and `scenario_label` (on `investigations`) exist
ONLY for evaluation (precision/recall/F1 computation) and for the manual-trigger
selection UI. No code path in `backend/agents/` may read either column. Enforce this
with a code-review checklist item, and ideally a lint rule / import boundary if
feasible in the chosen framework.

### 6.1 Label-to-class mapping (used by `/evaluation` only)

Code: `backend/evaluation/ground_truth_map.py`. A test checks that every `ScenarioLabel` is mapped and
that every mapped class is in `VERDICT_CLASSES`.

| Scenario label | Expected class | Accepted alternative |
|---|---|---|
| DDoS | ddos | none |
| Portscan | port_scan | none |
| FTP-Patator | brute_force | none |
| SSH-Patator | brute_force | none |
| Botnet | botnet_c2 | none |
| BENIGN | benign | none |
| insider_scenario_1 | insider_logon_anomaly | insider_file_exfiltration |
| insider_scenario_2 | insider_file_exfiltration | insider_logon_anomaly |
| insider_scenario_3 | insider_logon_anomaly | insider_file_exfiltration |

The insider rows come from the CERT r4.2 answer files (`data/raw_data/insider_raw_data/answers_extracted/answers/r4.2-N/`),
which list every event of each insider. Scenario 1 (30 insiders) is logon, device and http events, 126 of its 138 logons
outside 07:00-19:00. Scenario 2 (30 insiders) is http, email and device events, with no logon events at all. Scenario 3
(10 insiders) is logon, device, file, email and http events, and the only one with file events. The other insider class
is accepted in every case, so acceptable and family accuracy do not depend on which class is primary; exact accuracy
does. `test_ground_truth_map.py` re-derives the event types when the dataset is present.
`ambiguous` counts as an abstention and is never correct. Accuracy is an exact match, acceptable accuracy
also accepts the listed alternative, and family accuracy compares network, insider and benign families.
