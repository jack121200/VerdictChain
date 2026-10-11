# Claims audit: Landing, Login, Overview, Dashboard, Live (2026-10-11)

Rule being checked (CLAUDE.md, NO BLUFF): every value, label and sentence on a page is either an API field, a browser
calculation whose formula is shown, or a statement with a mechanism behind it in the code. This file is the record of
reading the five pages not yet covered by the earlier audit (Investigations, Debate Room, Trust, Fleet, Audit and Access
were read first and gave the six fixes TA1 to TA6 in CHECKLIST.md section M).

How it was done: every static sentence, label, badge and Proof definition of each page was read in the source, and the
code that makes it true was found and read. **OK** = backed as written. **FIXED** = the wording claimed more than the
code does, so it was changed and a test now holds the new wording.

## Landing (`frontend/src/features/landing/index.tsx`)

| Statement | Backed by | Verdict |
|---|---|---|
| Phase 01: raw flows and insider logs "are normalised into one evidence table that every agent cites against" | `raw_logs` (`backend/db/models.py`), `backend/pipeline/normalization.py`, citations checked in `backend/watchdog/verification.py` | OK |
| Phase 02: three agents "state a theory, challenge each other, and finalise their positions over three rounds. No agent is told the scenario" | `backend/debate/engine.py` (`DEBATE_ROUNDS`), `backend/agents/rows.py` (no label attribute), `tests/agents/test_blind_boundary.py` | OK |
| Phase 03: every cited row is looked up in the raw logs; "a deterministic database check, not another model" | `check_citations` (one SQL query, no model call) | OK |
| Phase 04: "A confident verdict triggers simulated containment" | `should_respond` needs the confidence **and** every contributing agent at CrS 0.50 or more | **FIXED**: now "A confident verdict backed by credible agents triggers…" |
| Phase 04: "tamper-evident SHA-256 audit chain" | `backend/db/audit.py` | OK |
| Capability chips (agents, debate, Watchdog scoring, citations checked, simulated containment only, hash-chained audit) | one module each; the sandbox has no networking code | OK |
| Hero badge and headline ("Multi-agent debate · Watchdog verification · Simulated response") | the project's own description | OK |
| "From raw telemetry to a signed-off verdict" | sign-off is an optional audited acknowledgement (`POST /investigations/{id}/sign`), not a signature and not part of every verdict | **FIXED**: now "an audited verdict" |
| "Run a scenario, watch the three agents debate live, and inspect every cited row and audit entry yourself" | Dashboard inject, Debate Room, citations table, Audit page | OK |
| "Sandboxed forensic console · Authorized personnel only" | anyone can register an analyst account, so "authorized" is not enforced | **FIXED**: now "Sign-in required" |
| The page shows no value from the API | no `fetch`, no number | OK (test: no percentage appears) |

## Login (`frontend/src/features/login/index.tsx`)

| Statement | Backed by | Verdict |
|---|---|---|
| Left panel: agents debate, a Watchdog checks every cited row and scores credibility, containment is simulated, every action is audited | as above | OK |
| Feature pills | as the Landing capability chips | OK |
| "At least 3 characters" / "At least 8 characters" | `backend/api/schemas/auth.py` (`min_length` 3 and 8) and `validate.ts` | OK |
| "New accounts start as forensic analysts." | `register` creates `forensic_analyst`; the request cannot carry a role | OK |
| Proof of the submit button: "Sends the username and password to the API and stores the returned token in this browser. Nothing else is sent." | `login()` / `register()` in `api/client.ts` | OK |
| Proof of the mode switch: "Registration never accepts a role. Roles are set by a secops lead." | `extra="forbid"` on the request, `PUT /users/{id}/role` needs `manage_users` | OK |
| "Protected system. Authorized personnel only." | open registration | **FIXED**: now "Protected system. Sign-in required; roles are enforced on the server." |
| The node graph | decorative, carries no value (`aria-hidden`) | OK |

## Overview (`frontend/src/features/overview/index.tsx`)

| Statement | Backed by | Verdict |
|---|---|---|
| Hero: "confirmed threats are contained in a sandbox" | containment is automatic when the gate opens; nobody "confirms" first | **FIXED**: now "a confident verdict backed by credible agents is contained in a sandbox" |
| "Aggregation is deterministic code; the LLM output is not." | `backend/debate/verdict.py` | OK |
| Ribbon: evaluated accuracy ("model runs only · N offline-stub runs not counted") | `GET /evaluation` (`accuracy`, `by_source.stub`) | OK |
| Ribbon: adjudication latency Proof | `deriveMeanLatencyMs` over the loaded audit entries | **FIXED**: the Proof now says a case that waited in the queue includes its wait (the start entry is written on acceptance) |
| Ribbon: grounding assurance, simulated actions | `GET /stats` (`citations.verified_rate`, `self_healing.simulated_share`) | OK |
| Raw ingestion ledger | `GET /raw-logs/recent` (allow-listed fields; the label is never returned) | OK |
| Agent-reported confidence gauge | `GET /investigations?limit=1`, labelled self-reported, "Accuracy comes only from /evaluation" | OK |
| Citation pin ("Postgres re-checked") | `GET /investigations/{id}/citations` | OK |
| Pillar 1 to 4 sentences and their counters | `GET /raw-logs/counts`, `GET /settings`, `GET /agents/fleet`, `GET /stats`, `GET /system/status` | OK |
| Scenario suite badge "LIVE INGESTION" | ingestion is a one-time load; only the **counts** are read live | **FIXED**: now "COUNTED IN raw_logs" |
| "Agents never see the label (blind test)" | `tests/agents/test_blind_boundary.py` | **FIXED**: the badge had no Proof; it now has one that names the test |
| Trust cards: tamper-evident audit, credibility scoring (η, Brier), sandboxed response, providers | `GET /audit-trail`, `GET /settings`, `GET /stats`, `GET /system/status` | OK |
| "Configured providers … The LLM backends the agents actually call" | there is one provider | **FIXED**: singular ("Configured provider … The LLM the agents actually call") |
| Closing badge "EVERY VALUE BACKED BY THE API" | enforced by `no-bluff-check.mjs`, the contract test and the Playwright canary | OK |
| Decorative images | `alt` says abstract artwork; no caption states a fact | OK |

## Dashboard (`frontend/src/features/dashboard/`)

| Statement | Backed by | Verdict |
|---|---|---|
| Hint strip (three sentences) | endpoints named are the ones the page calls | OK |
| Banner "Active incident" | the banner shows the newest investigation with a threat-class verdict, whatever its status or age (it may be contained and old) | **FIXED**: now "Latest threat verdict" |
| Banner subject and host with Proof | most-cited `user_id` / `host_id` among VERIFIED citations (`mostCitedValue`) | OK |
| "Log integrity: chain valid / broken / not verified" | `GET /audit-trail` (`chain.valid`) | OK |
| Card "Investigating now" with sub-line "Live debate slots" | `GET /stats.active`; there was one debate slot then (there are now up to `DEBATE_MAX_CONCURRENT`, and the sub-line counts debates running now either way) | **FIXED**: sub-line now "Debates running now" |
| Cards "Insider verdicts", "Fleet credibility", "Containment actions" | `GET /stats` Metrics with their own Proof | OK |
| "Attack dataset matrix", "Ground-truth: masked from pod swarm" + Proof | `GET /scenarios`; the Proof names the blind-boundary test | OK |
| Pods: credibility, formal stance, last vote, confidence by round, rounds scored, Active / Isolated | `GET /agents/fleet`, `GET /investigations/{id}`; each has a Proof | OK |
| Verdict ledger "Deterministic aggregation", the audit hash column | `GET /investigations`, `GET /audit-trail?action=verdict_reached` (`entry_hash`) | OK |
| Audit event stream | `GET /audit-trail` (newest 60); the Proof says Clear hides the view only | OK |
| Cited forensic evidence | `GET /investigations/{id}/citations`; images are decorative and the Proof says every caption is a real cited value | OK |

## Live (`frontend/src/features/live/index.tsx`, `derive.ts`)

| Statement | Backed by | Verdict |
|---|---|---|
| Subtitle "Logs arrive on their own…" | the rows are replayed from the datasets; the notice below says so | **FIXED**: now "Dataset rows are replayed on their own…" |
| Notice "Simulated replay of dataset rows … No real network is monitored." | `GET /live/status.notice` | OK |
| Model card: state pill, rows streamed before the first call, tokens, budget, calls, "What OpenAI allows this key" | `GET /live/status.llm` (`backend/api/routes/live.py`, `openai_usage.py`); every number is a Metric that shows "—" with its reason before OpenAI has answered | OK |
| Window cards and the rule in each Proof (network spread ≤ 0.50, CERT z ≥ 4, suspicion = clamp(1 − spread, 0, 1) or clamp(z / 8, 0, 1)) | `backend/pipeline/live_detector.py` (`NETWORK_MAX_SPREAD`, `Z_FLAG`, `WINDOW_SIZE`) read line by line | OK |
| Tiles (published, consumed, rate, backlog, flagged, automatic investigations, today of cap, investigations on/off) | `GET /live/status` Metrics | OK |
| "Why nothing started" | `blocked.reason`, written by the guard chain in `backend/api/live_runner.py` | OK |
| "Rows arriving" Proof ("no label and no raw field is returned") | `GET /live/arrivals` returns the pointer fields only | OK |

## What this audit does not cover

It checks sentences against code. It does not check pixels (see the fidelity work in CHECKLIST.md, item UD8 + UD16 +
PH7) and it does not re-run the numbers: those are held by the contract check and the Playwright canary.
