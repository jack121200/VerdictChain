# VerdictChain — Master Checklist

Legend: ✅ done · 🟡 partial · ⬜ todo · ❓ needs your decision

Rule: one line per item, `ID status text`. Updated after every finished task. Counts are generated, not typed (see bottom).

## A. Build phases
PH1 ✅ Backend foundation: migrations 0003–0006, audit seq + lock, RBAC constants, Metric envelope, test-DB guard (8a76dd6)
PH2 ✅ Design skill v2 + CLAUDE.md NO-BLUFF rule (67a1434)
PH3 ✅ Offline LLM stub harness for zero-cost E2E + seeding (4e168f2)
PH4 ✅ Frontend foundation: tokens, UI kit, typed API client, router, shell, login (d2ce513)
PH5 ✅ Wave 1 backend: engine, auth/RBAC, settings, evidence/stats/evaluation, realtime, containment, noise, fault-injection (67c639c, 539 tests)
PH6 ✅ Dev DB migrated 0002 -> 0006, all real data intact
PH7 🟡 Screens on real data: Dashboard, Scenario modal, Debate, Investigations, Trust, Fleet, Audit, Access, Overview (all built; exact-fidelity verification per screen pending)
PH8 🟡 Playwright E2E on its own stack + CI job written; all specs pass locally; the CI job itself has not run on GitHub
PH9 ⬜ Final integration: full backend + frontend suites, ONE live-LLM smoke run, final docs, Python 3.12 run

## B. Your directives (this chat)
UD1 ✅ Navigation moved from top bar to a left sidebar
UD2 ✅ Background pure jet black
UD3 ✅ Public landing page first, login behind a button
UD4 ✅ Landing hero fills the whole screen (not compact)
UD5 ✅ Debate Room reachable from the sidebar (live + recent list)
UD6 ✅ Investigations filter is one clean Filters dropdown (status, verdict, agent) with an active count and Clear
UD7 ✅ Overview and Access screens no longer crash (raw-logs/counts shape fixed)
UD8 ⬜ Overview + Access visual fidelity to the reference, verified by screenshot
UD9 ✅ Realtime push on EVERY page: Redis pub/sub event bus + /ws/events + every screen subscribes (proven: audit head #94 -> #111 in 0.6 s with no reload)
UD10 ✅ Why data did not sync: ROOT CAUSE (frontend types did not match the real API; mocks hid it) fixed, and every route re-verified on the live API
UD11 ✅ Seed script: complete investigations with zero LLM calls
UD12 ⬜ Real inject (live LLM) verified end to end once
UD13 ✅ Logic: isolation actually fires within a 3-round debate: default eta 0.15 -> 0.20 (migration 0007, audited setting): three fully-failing rounds take CrS 0.5 -> 0.256 < 0.30, so the agent is isolated when round 3 is scored
UD14 ✅ Logic: non-primary agents reason on the scenario's own rows, then the same users in its time window, then the window, then a recent sample; the basis is recorded per agent (audit + API input_basis)
UD15 ✅ Debate off the request path with live progress and instant feedback: 202 + background run, GET /investigations/{id}/progress, Idempotency-Key, restart recovery (cut-off debates marked error, stale slot freed)
UD16 🟡 Exact ditto of the reference look (tokens identical; Investigations + Trust re-ported; rest unverified)
UD17 🟡 Zero bluff on every stat, graph and label: contract-check proves the types match the live API and the E2E canary proves numbers on screen = API numbers and no invented claim on any page; a full audit pass of type scale, status icons and fonts (FM2-FM4) is pending
UD18 🟡 UI easier to understand: hint strips, command palette, plain-word labels, quarantine and data-slice wording; a full first-time-user pass is pending

## C. 70 points — FRONTEND
FE1 ✅ Debate Room in sidebar + running/recent list
FE2 ✅ Public full-viewport landing page
FE3 ✅ Pages refresh live (WebSocket push, polling fallback when the socket is down)
FE4 🟡 Jet black done; surface steps/borders re-tune for contrast pending
FE5 ✅ Investigations filter as a dropdown (FilterMenu: keyboard, Esc, click-outside)
FE6 ✅ First-visit hint strip (dismissible, remembered) on Dashboard, Investigations, Debate list + room, Trust, Fleet, Audit; every sentence is a true statement about the page
FE7 ✅ Inject feedback: 202 at once, 'Investigation x started' toast, one Idempotency-Key per modal opening, lands on the live debate
FE8 ✅ Empty states with an action ('Run first scenario', role-aware) on Dashboard ledger, Investigations and the Debate list
FE9 ✅ Icon whitelist widened (17 -> ~75 glyphs), any icon size
FE10 ✅ Command palette (Ctrl/Cmd+K and a TopNav button): pages, investigation search, inject; arrow keys, Enter, Shift+Enter, Esc

## D. 70 points — BACKEND
BE1 🟡 Debate off the request path: 202 + thread, progress endpoint and restart recovery done; no job queue (see SD2/SD4 decision)
BE2 🟡 Multi-worker safe: events fan out over Redis pub/sub (done); atomic CrS update pending
BE3 🟡 Continuous mode: honestly reported as OFF; not wired to the pipeline
BE4 🟡 Gemini quota: daily caps + in-flight slot exist; clear quota-error message + caching pending
BE5 ✅ /stats cached 5 s in Redis, invalidated by every committed change, incremental chain check inside
BE6 ✅ Audit verify is incremental by default (checkpoint) and says so (mode, verified_from_seq); full=true re-verifies everything
BE7 ✅ Legacy unauthenticated /ws/scenarios route removed (with its manager code and tests)
BE8 ✅ List endpoints bounded (users, response-actions, citations, audit, investigations); a guard test fails for any unbounded array GET
BE9 ✅ Boot-time checks (JWT secret, Postgres, Redis, provider keys): production aborts with one clear message, development warns
BE10 ✅ Request logging: one structured line per request with a request id, slow-request warning, X-Request-ID exposed over CORS; provider latency/quota metrics still pending (SD7)

## E. 70 points — LOGIC
LG1 ✅ Isolation reachable in 3 rounds (eta 0.20; tests in credibility, engine and the HTTP API; SKILL docs + Trust page wording updated)
LG2 🟡 Verdict: primary-agent tie-break done (+tests); structured verdict field instead of keywords pending
LG3 ✅ Non-primary agents see the scenario's rows / time window (tiered, tested incl. day-padding and label-blindness); CICIDS (2017) vs CERT (2010-11) have no shared timeline, so a network scenario honestly falls back to a recent sample
LG4 ⬜ Stance enforced in the agent schema (not parsed from the first word)
LG5 ✅ Self-healing credibility gate now bites: an agent between 0.30 and 0.50 still votes but cannot trigger autonomous containment (it used to be the isolation threshold, which a contributing agent can never be under)
LG6 ❓ Evaluation insider ground-truth mapping needs your confirmation
LG7 ⬜ Noise: separate, clearly labelled adversarial mode
LG8 ✅ Restore semantics documented in the README and proven end to end (restore resets CrS to 0.50, audited, history stays)
LG9 ✅ Live isolation path exercised end to end through POST /investigations/simulate: stub fabricate mode -> real Watchdog -> CrS -> quarantine -> next debate without the agent -> audited restore (+ seed_demo --drill, stub --fabricate)
LG10 ⬜ Analyst feedback actually feeds an adaptive threshold

## F. 70 points — STRUCTURE
ST1 ✅ One source of truth for API schemas: no inline route models exist, a guard test keeps it that way
ST2 ⬜ Split 700–1000-line screens into view / data
ST3 ⬜ Shared usePageData hook (load / live / empty)
ST4 ❓ Reference folder: move to /reference or delete after the port
ST5 ✅ Playwright specs: smoke, inject flow, hallucination drill (isolate -> quarantined everywhere -> restore by a lead), no-bluff canary (numbers = API, no invented claim on any page, null metric = em dash + reason), RBAC + forged token, audit verify + browser SHA-256, realtime without reload
ST6 ⬜ Agent id / name mapping centralised
ST7 🟡 API types vs backend: hand-written types now VERIFIED against the live API + OpenAPI by contract-check (no codegen)
ST8 ✅ Migration round-trip test (upgrade, downgrade base, upgrade) on a scratch database; single head 0007
ST9 ⬜ Dev tools separated from the test harness in backend/scripts
ST10 ⬜ Docs consolidated (CLAUDE.md + SKILL files in sync)
ST11 ❓ LangGraph is in the locked stack (CLAUDE.md) but nothing imports it: the debate engine is plain Python. Adopt LangGraph, or change the stack list?

## G. 70 points — FORMATTING
FM1 ⬜ Surface elevation + borders re-tuned for pure black
FM2 ⬜ One locked type scale
FM3 ⬜ Evidence values always JetBrains Mono (audit)
FM4 ⬜ Every status colour paired with an icon shape (audit)
FM5 🟡 Number formatting goes through lib/format.ts on the pages the agent swept (Dashboard, Investigations, Audit, Access, Overview); Trust/Fleet/Debate sweep pending
FM6 ✅ Relative timestamps with the exact ISO time in the tooltip (Timestamp) on Dashboard, Investigations, Debate, Audit, Access, Overview, Trust
FM7 🟡 Copy button on truncated hashes/ids on Dashboard, Investigations, Audit and the TopNav; remaining pages not swept
FM8 ⬜ 4px spacing grid snap
FM9 🟡 Investigations list and Audit entries stack below 640px; other tables not done
FM10 ✅ color-scheme: dark set (native controls)

## H. 70 points — SYSTEM DESIGN
SD1 🟡 WS fan-out over Redis pub/sub done; CrS updates atomic pending
SD2 ❓ Debates through a worker queue: today ONE debate runs at a time on purpose (credibility is shared state, provider quota is global) and a second inject is refused with 409. A queue (DB-backed, one worker, no RabbitMQ needed) would accept it as 'queued'. Your call: queue, or keep the single slot?
SD3 ✅ Idempotency-Key on POST /investigations/simulate (same key = same investigation, no second debate; a refused request frees the key)
SD4 ❓ Per-user debate slot: same decision as SD2 (a per-user cap only makes sense once there is a queue)
SD5 ✅ Boot-time secret/key validation (api/startup_checks.py, 17 tests)
SD6 🟡 Stats cached; read endpoints are bounded; per-endpoint rate limits on reads not added
SD7 🟡 Observability: request id + latency log lines done; provider latency/quota counters pending
SD8 ⬜ Audit: per-investigation sub-chain + global chain
SD9 ✅ Logical export script (python -m backend.scripts.export_db): JSONL per table + manifest with row counts and chain-valid flag
SD10 ✅ docker compose --profile app runs backend + frontend (images built and smoke-tested); default compose still starts only the three services

## I. 70 points — DATA FLOW
DF1 ✅ Live sync after a debate: Audit / Trust / Investigations / Dashboard update without reload
DF2 ✅ Dashboard / Fleet / Trust / Overview / Investigations / Access all subscribe to change topics
DF3 ✅ One database + seed script keeps demo data present
DF4 ✅ Old dev investigations replaced by fully consistent seeded ones
DF5 🟡 Inject -> debate handoff: id in URL + replay exist; failure paths unproven
DF6 ✅ Provider shown per message in the debate stream and per investigation in the header
DF7 ✅ Continuous ingestion surfaced honestly: Access page shows 'off · manual injection only' from /system/status
DF8 🟡 Labelled evaluation runs: seeded with labels; /evaluation view not yet re-checked
DF9 ❓ Credibility history: per-case vs global trend (your decision)
DF10 ✅ Footer shows live / reconnecting; screens poll as a fallback while the socket is down

## J. Release / hygiene
RL1 ✅ Your uncommitted agents WIP files never touched or committed
RL2 ✅ CI: backend job creates verdictchain_test and sets TEST_DATABASE_URL (YAML validated; GitHub Actions itself not run)
RL3 🟡 Backend suite on Python 3.13: 671 passed, 1 failed (a test of the route removed afterwards); 3.14 local; 3.11 cannot import (PEP 695); 3.12 itself not installed here
RL4 ✅ README rewritten; every command verified to exist
RL5 ⬜ Final no-bluff sweep against the blacklist
RL6 ⬜ Merge decision: branch feat/ui-cyber-hud -> main (only when you say)

## K. Integration contract (new: found while tracing "data not syncing")
CT1 ✅ contract-check script: every client endpoint, response AND request body, validated against the live API + OpenAPI
CT2 ✅ Investigations list/detail and citations page fixed through adapters, tested on payloads captured from the real backend
CT3 ✅ Status words fixed (investigating/error), dataset name ("CERT r4.2"), debate_slot.status
CT4 ✅ POST/PUT response types fixed to the backend shapes: sign, containment, release, fault-injection, quarantine, stats, evaluation, bundle
CT5 ✅ Evaluation types accept "unclassified"/"BENIGN"; simulate 202 documented in OpenAPI; contract-check 0 failing on 22 live + 12 spec endpoints
CT6 ✅ contract-check runs in CI against the stub API (also rehearsed on an empty database)
CT7 ✅ Every screen re-verified on the live API after the fixes: all 11 routes render real data, 0 console/page errors, 0 HTTP >= 400 (found + fixed a nested-button bug on Fleet)
CT8 ✅ Backend /stats gained mean_crs + citation counts the screens needed (+ tests)
CT9 ✅ Seeded + stub data is honestly labelled: providers read stub-groq / stub-gemini (restored on uninstall, tested); dev DB reseeded: 6 investigations, 70 stub replies, 0 real provider calls
CT10 ⬜ UI marks investigations produced by the offline stub, so evaluation accuracy on stub data never reads as system accuracy
CT11 ✅ Votes carry counted; aggregator marks an isolated agent 'not counted · isolated'; a quarantined agent's lane says it did not take part
CT12 ✅ Manual containment re-derives the verdict WITHOUT isolated agents (it counted them: could contain a verdict the engine never reached); regression test, mutation-checked
CT13 ✅ rounds_complete counts the engine's round_completed audit entries (it was 0 for every debate that had a quarantined agent)
CT14 ✅ Most-cited ties break the same way everywhere (smallest value): dashboard, debate room, dossier and the containment target
CT15 ✅ Debate Room shows each agent's data slice (scenario rows / same user + window / window / recent sample) with a Proof, and says 'Quarantined: did not take part' for an agent that sat out
CT16 ⬜ Debate Room explains why an investigation was not contained (verdict under the threshold / an agent under the 0.50 floor / non-actionable class), derived in the browser with a Proof
CT17 ✅ Bugs the E2E suite found, all fixed with tests: the live verdict frame crashed the Debate Room, the snapshot gave action rows no id (React key warning), round frames carried a score dict where the page wanted a number, Overview crashed on a scenario with no rows, the first 401 could miss the login redirect, button inside a button in the scenario modal, dashboard without an h1, the palette lost its highlighted row on a refresh

## Open decisions for you (❓)
- LG6 confirm insider scenario -> verdict-class mapping used by /evaluation
- ST4 keep, move or delete verdictchain---multi-agent-soc/
- DF9 credibility trend: global per agent, or per investigation
