---
name: SKILL-architecture
description: Full system architecture for VerdictChain — read before building any pipeline, agent, debate, watchdog, or self-healing code.
---

# VerdictChain — System Architecture (LOCKED)

## 1. End-to-end data flow

```
Raw Logs (CICIDS2017 subset + CERT r4.2 subset + Docker-simulated logs)
      │
      ▼
[1] Log Ingestion & Normalization
      → common schema: timestamp, source, event_type, severity, raw_fields (JSON), source_file
      ▼
[2] Trigger Layer (hybrid — see Section 4)
      → continuous background monitor OR manual "Simulate scenario" injection
      ▼
[3] Investigator Agents (3, run in parallel via LangGraph)
      → Network-Traffic Agent | Access-Log Agent | Endpoint-Behavior Agent
      → each outputs: { theory, confidence, cited_evidence[] }
      ▼
[4] Debate Engine (minimum 3 rounds)
      → Round 1: state initial theories
      → Round 2: challenge/rebut other agents' theories
      → Round 3: final positions
      → Verdict aggregation (not a round — a final synthesis step)
      ▼
[5] Watchdog / Trust Agent
      → cross-verifies every cited_evidence entry against raw logs in Postgres
      → updates each agent's continuous Credibility Score (CrS)
      → isolates + activates backup agent if CrS < 0.30
      ▼
[6] Self-Healing Response Agent
      → triggered only if: verdict confidence is high-confidence AND all
        contributing agents have CrS above threshold
      → runs threat-type-aware SANDBOXED containment actions
      ▼
[7] Dashboard (React, existing Figma Make code)
      → Investigation Report | Debate Transcript | Trust Log | Response Actions
      → all values are live from the API — nothing hardcoded
```

## 2. The three Investigator Agents

| Agent | Data source | Detects |
|---|---|---|
| Network-Traffic Agent | CICIDS2017 subset | External attacks: DDoS, port-scan, brute-force, botnet C2 |
| Access-Log Agent | CERT r4.2 `file.csv` | Insider: unauthorized/off-hours file access, cross-department access |
| Endpoint-Behavior Agent | CERT r4.2 `logon.csv`, `device.csv` | Insider: login-time anomalies, device/session anomalies, privilege misuse |

Each agent:
- Reads ONLY its own data slice as primary evidence.
- Also receives a lightweight **peripheral-awareness digest** (a short summary, not raw
  data) of what the other two domains observed in the same time window — this exists
  specifically so debate isn't one-sided when only one domain has strong signal
  (see Section 5, "Avoiding one-sided debate").
- Is blind to which scenario was manually selected (if manually triggered) — golden
  rule, never violate this.
- Must cite specific log row IDs for every claim. A claim with no citation is invalid
  and must be rejected by the calling code before it reaches the debate engine.

## 3. Debate Engine — exact protocol

- **Round 1:** each agent states its theory, confidence (0.0–1.0), and cited evidence,
  based only on its own slice + the peripheral digest.
- **Round 2:** each agent sees the other two agents' Round 1 output and must either
  challenge (with a reason) or explicitly concede/support. No agent may simply repeat
  its Round 1 text — the code must reject a Round 2 message that is a near-duplicate
  of the same agent's Round 1 message (implement a simple similarity check).
- **Round 3:** final positions, incorporating Round 2 challenges.
- **Verdict aggregation:** a deterministic function (not another LLM call) combines
  the three final positions + their confidences into a single verdict: attack class,
  overall confidence, and the list of evidence rows that support it. Ties or highly
  split verdicts should be flagged as `"status": "ambiguous"` rather than forced to
  a class.
- Full transcript (every round, every agent, every message) is persisted to
  `debate_transcripts` — this is what the dashboard's "Debate Transcript" tab reads.
  Each row records the provider that answered that call (`debate_transcripts.provider`).
- **Lifecycle (implemented in `backend/debate/engine.py`):** `start_investigation()` creates
  the investigation row and its `investigation_started` audit entry in one transaction. The
  audit detail carries the settings snapshot, the noise values and the injected row ids. The
  scenario label stays on the investigation row only. `run_debate()` then runs
  `DEBATE_ROUNDS = 3` rounds on that investigation.
- **Active agents:** the three investigators, minus any whose `agent_quarantine` row is
  active when the debate starts. Fewer than two active agents raises `NotEnoughActiveAgents`
  (the API returns 409).
- **Isolation (decision D1):** after an agent's round is scored, a CrS below the isolation
  threshold sets its quarantine (audited as `agent_isolated`). The agent takes no part in
  later rounds or in the verdict. If fewer than two agents remain mid-debate, the verdict is
  `ambiguous` and no containment runs.
- **Round audit:** each round writes `round_completed` (round, agents, providers). The verdict
  writes `verdict_reached` in the same transaction as the investigation's status update.
- **Status:** `investigating` → `verdict_reached` or `ambiguous`. A non-empty set of
  self-healing actions makes it `contained`. A failed debate is `error`.

## 4. Hybrid trigger model

- **Continuous mode (default, always on):** a background worker replays/streams the
  normalized log dataset (respecting original relative timestamps, sped up) into
  RabbitMQ. The pipeline consumes from the same queue regardless of trigger source.
- **Manual mode ("Simulate scenario" button):** the frontend lets the user pick one
  scenario from two groups:
  - Internal: off-hours cross-department file access, privileged-account misuse,
    unusual data exfiltration
  - External: DDoS, port-scan/recon, brute-force login, botnet C2
  Selecting one injects the corresponding log window directly into the same queue,
  bypassing the replay-timing wait.
- **Blind-test principle (non-negotiable):** whichever scenario was selected is stored
  ONLY as a hidden ground-truth tag (for later precision/recall evaluation). It is
  never passed to any investigator agent's prompt or context.
- **Simulate request (implemented in `backend/api/routes/simulate.py`):** `POST
  /investigations/simulate` takes `scenario_label`, `max_rows_per_agent` (1–15),
  `noise_pct` (0, 15 or 30) and `wait`. The checks run in this order: authentication,
  capability `inject_scenario`, rate limit (5 per minute per client), intake paused (423),
  rows (404), dominant investigator (422), noise dilution, the single debate slot (409),
  the daily caps per analyst and across analysts (429, 24-hour window), then
  `start_investigation()`. `wait=true` runs the debate inline and returns 201. `wait=false`
  returns 202 with the investigation id and runs the debate in a background thread. The
  slot (`verdictchain:debate:slot`) is released in `finally`.
- **Noise (`backend/pipeline/noise.py`):** the window the agent reads (the first
  `max_rows_per_agent` rows) loses k = round(n × pct / 100) scenario rows, always keeping at
  least one. Each dropped row is replaced by a benign row of the same source, so no value is
  changed. The effective percentage is stored on the investigation. Agents get no hint.
- **Live channel:** `POST /auth/ws-ticket` issues a single-use ticket valid for 30 seconds.
  `WS /ws/investigations/{id}?ticket=…` sends a snapshot built from the database first, then
  live frames. A missing or bad ticket closes with 4401. Every frame carries
  `investigation_id`. Clients dedupe on type, round and agent id.

## 5. Avoiding one-sided debate

A known design risk: if each agent only ever sees its own domain, "debate" degenerates
into whichever agent has relevant data simply winning by default, every time. Two
mitigations, both required:
1. **Peripheral-awareness digest** (Section 2) — every agent gets a lightweight
   cross-domain summary, so it can meaningfully engage even outside its primary domain.
2. **Mixed/ambiguous scenarios in the dataset** — the scenario set must include at
   least one case where evidence genuinely spans two domains (e.g. an insider who
   also causes an unusual outbound-traffic pattern), so Round 2/3 challenges have
   real substance to work with, not just one agent conceding immediately.

## 6. Watchdog / Trust Agent

- Maintains a continuous **Credibility Score (CrS)** per investigator agent, stored
  in Redis for fast read/write, logged to Postgres (`credibility_log`) on every update.
- After each round, for every cited evidence row: look it up directly in the raw
  logs table. If the row doesn't exist or the cited values don't match, that's a
  verification failure.
- Exact update formula (see `SKILL-data-schema.md` Section 5 for the persisted fields):
  `CrS_new = clamp(CrS_old * (1 + η * (2 * verification_match_rate − 1)), 0, 1)`, with
  `η = 0.20` as the default (runtime setting `eta`). A rate of 0.5 leaves CrS unchanged,
  1 grows it, 0 shrinks it. Resolved 2026-10-05, owner-approved. Default η raised from 0.15
  to 0.20 on 2026-10-09 (migration 0007) so three rate-0 rounds (0.40, 0.32, 0.256) cross the
  0.30 isolation threshold inside one 3-round debate; at 0.15 they left 0.307.
- **Isolation threshold: 0.30** (runtime setting `isolation_threshold`). If an agent's CrS
  drops below it, the agent is isolated: its `agent_quarantine` row is set active (audited as
  `agent_isolated`). It is excluded from the rest of that debate, from the verdict and from
  later debates, until an audited restore. Restore resets CrS to 0.5. No backup instance is
  activated, because each investigator has one implementation. Isolation is exclusion, not
  replacement.
- The debate layer itself provides a first line of redundancy (Section 3) — the
  Watchdog is a second, independent layer. Document this as "reduces single-point-
  of-failure risk" — never claim it "eliminates" it. The Watchdog itself becoming
  compromised remains an acknowledged, undefended limitation (state this plainly in
  any report/paper text, never overclaim).

## 7. Self-Healing Response Agent

- Fires only when BOTH are true: verdict confidence ≥ the verdict threshold (runtime
  setting `verdict_confidence_threshold`, default 0.80) AND every contributing agent's CrS
  ≥ 0.50 (`AUTONOMOUS_ACTION_MIN_CRS` = the starting CrS: a fresh agent's credibility). The engine
  passes the live verdict threshold in. The gate used to be the isolation threshold (0.30), but an
  agent below that is isolated and never contributes, so it could never refuse anything (changed
  2026-10-09). An agent between 0.30 and 0.50 still debates and votes; a human contains manually.
- A verdict with status `ambiguous` never triggers containment. When at least one action
  is taken, the investigation status becomes `contained`.
- Action set is threat-type-aware:
  - Insider-threat verdict → `lock_account()`, `trigger_audit()`
  - External/network verdict → `block_ip_range()`, `trigger_rate_limiting()`,
    `trigger_audit()`
- **Every action is simulated inside a sandbox boundary enforced in code** (see
  `SKILL-security.md`) — it must be structurally impossible for these functions to
  reach a real system, not just "we won't call the real API."
- Each action is logged with a short LLM-generated plain-English reason and a
  timestamp, feeding the `response_actions` table and the Audit Trail.
- **Manual override (`POST /investigations/{id}/emergency-containment`, implemented in
  `backend/api/routes/containment.py`):** an analyst with capability
  `trigger_emergency_containment` runs the same sandbox actions. The verdict is re-derived
  from the round-3 transcripts with `aggregate_verdict()`. No LLM is called, and the reason
  is a fixed template. The gates are: a plan exists for the verdict class (insider or
  external), the investigation is not already contained, and no contributing agent is
  quarantined. Each action is written with `is_simulated` TRUE and audited with trigger
  `manual_override`, and the request writes one `emergency_containment` audit entry.
- **Release (`POST /investigations/{id}/release-containment`):** runs the inverse sandbox
  functions (`unlock_account`, `unblock_ip_range`, `disable_rate_limiting`) and writes a
  `release:<action>` row for each. `trigger_audit` has no inverse. The contained state is
  derived from `response_actions`: a containment row minus its matching release row.
- **Sandbox proof:** `backend/self_healing/sandbox.py` has no networking import. The manual
  path also imports no LLM client, and a test enforces both
  (`tests/self_healing/test_manual_override.py`).

## 8. Adaptive false-positive handling (human-in-the-loop)

- Dashboard exposes "Confirm as Threat" / "Mark False Positive" on every verdict.
- This feedback is NOT discarded — it's stored and used two ways:
  1. **Adaptive filter sensitivity:** if recent feedback shows a burst of false
     positives, the confirmation threshold tightens slightly; if analysts are
     confirming quickly and consistently, it relaxes slightly.
  2. **Scheduled retraining:** every N confirmed samples (default N=50) or on a
     weekly schedule, the underlying classifier/heuristics are retrained on the
     newly confirmed data.
- **Version safety:** every retrained version is compared against the currently
  deployed version on a held-out set before being promoted. If the new version is
  worse (lower accuracy or higher false-positive rate), it is NOT deployed — the
  previous version keeps running. This must be a real automated comparison step in
  code, not a manual judgment call.

## 9. Data sources

- **CICIDS2017** (filtered subset, ~9.7k rows: benign + DDoS + Portscan +
  FTP-Patator + SSH-Patator + Botnet - revised from an original ~2-3k/3-type
  target per 2026-09-07 session decisions: first to cover all 4 signal types
  the Network-Traffic Agent's own system prompt describes (DDoS/port-scan/
  brute-force/botnet C2 - Botnet was missing entirely), then capped small
  because this dev machine's 7.7GB RAM couldn't sustain a larger ~26k-row
  write to the dockerized Postgres without it crashing under memory pressure.
  Revisit larger once on a machine with more headroom or before the actual
  demo. Per-call LLM batch size stays small regardless, ~15 rows/call - see
  backend/agents/network_traffic.py) → Network-Traffic Agent.
- **CERT r4.2** (`logon.csv`, `device.csv`, `file.csv`) → Access-Log Agent and
  Endpoint-Behavior Agent. Ground-truth labels come from `answers.tar.bz2` and are
  used only for evaluation, never fed to agents.
- **Docker-simulated logs** — for custom/injected scenarios not present in the
  above datasets (used by the manual "Simulate scenario" flow).

## 10. Deployment shape

100% containerized: `docker compose up` brings up Postgres, Redis, RabbitMQ, the
FastAPI backend, and the frontend dev server together. No cloud dependency required
for local development; Neon/Supabase + Render/Railway are used only for the hosted
demo deployment.
