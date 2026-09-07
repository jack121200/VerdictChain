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
- Exact update formula (see `SKILL-data-schema.md` for the persisted fields):
  `CrS_new = CrS_old * (1 + η * verification_match_rate)`, clamped to `[0, 1]`,
  with `η = 0.15` as the default learning-rate constant (adjustable via Settings).
- **Isolation threshold: 0.30.** If an agent's CrS drops below this, it is isolated
  (its input excluded from the current and future rounds until manually reviewed)
  and a backup agent instance is activated in its place.
- The debate layer itself provides a first line of redundancy (Section 3) — the
  Watchdog is a second, independent layer. Document this as "reduces single-point-
  of-failure risk" — never claim it "eliminates" it. The Watchdog itself becoming
  compromised remains an acknowledged, undefended limitation (state this plainly in
  any report/paper text, never overclaim).

## 7. Self-Healing Response Agent

- Fires only when BOTH are true: verdict confidence ≥ 0.80 (configurable in
  Settings) AND every agent that contributed to the verdict has CrS ≥ 0.30.
- Action set is threat-type-aware:
  - Insider-threat verdict → `lock_account()`, `trigger_audit()`
  - External/network verdict → `block_ip_range()`, `trigger_rate_limiting()`,
    `trigger_audit()`
- **Every action is simulated inside a sandbox boundary enforced in code** (see
  `SKILL-security.md`) — it must be structurally impossible for these functions to
  reach a real system, not just "we won't call the real API."
- Each action is logged with a short LLM-generated plain-English reason and a
  timestamp, feeding the `response_actions` table and the Audit Trail.

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
