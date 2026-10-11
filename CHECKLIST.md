# VerdictChain — Master Checklist

Legend: ✅ done · 🟡 partial · ⬜ todo · ❓ needs your decision · ➖ closed, not counted

Rule: one line per item, `ID status text`. Updated after every finished task. Counts are generated, not typed (see bottom).

## A. Build phases
PH1 ✅ Backend foundation: migrations 0003–0006, audit seq + lock, RBAC constants, Metric envelope, test-DB guard (8a76dd6)
PH2 ✅ Design skill v2 + CLAUDE.md NO-BLUFF rule (67a1434)
PH3 ✅ Offline LLM stub harness for zero-cost E2E + seeding (4e168f2)
PH4 ✅ Frontend foundation: tokens, UI kit, typed API client, router, shell, login (d2ce513)
PH5 ✅ Wave 1 backend: engine, auth/RBAC, settings, evidence/stats/evaluation, realtime, containment, noise, fault-injection (67c639c, 539 tests)
PH6 ✅ Dev DB migrated 0002 -> 0006, all real data intact
PH7 ✅ Screens on real data: Dashboard, Scenario modal, Debate, Investigations, Trust, Fleet, Audit, Access, Overview (all built and compared with the reference page by page: docs/fidelity)
PH8 🟡 Playwright E2E on its own stack + CI job written; all specs pass locally; the CI job has never run on GitHub: it needs your OK to push the branch (no merge)
PH9 🟡 Final integration: every suite re-run green on 2026-10-11 after the last edits (see OA9); the run against the real model is yours (OA8); the commits are prepared on feat/ui-cyber-hud, and the push needs your GitHub sign-in (see OP9)

## B. Your directives (this chat)
UD1 ✅ Navigation moved from top bar to a left sidebar
UD2 ✅ Background pure jet black
UD3 ✅ Public landing page first, login behind a button
UD4 ✅ Landing hero fills the whole screen (not compact)
UD5 ✅ Debate Room reachable from the sidebar (live + recent list)
UD6 ✅ Investigations filter is one clean Filters dropdown (status, verdict, agent) with an active count and Clear
UD7 ✅ Overview and Access screens no longer crash (raw-logs/counts shape fixed)
UD8 ✅ Overview + Access visual fidelity to the reference: compared at 1440 x 900, every difference listed in docs/fidelity/overview.md and access.md as fixed, real data, removed claim or your directive; the image pairs were compared on screen and are not stored (the reference is git-ignored)
UD9 ✅ Realtime push on EVERY page: Redis pub/sub event bus + /ws/events + every screen subscribes (proven: audit head #94 -> #111 in 0.6 s with no reload)
UD10 ✅ Why data did not sync: ROOT CAUSE (frontend types did not match the real API; mocks hid it) fixed, and every route re-verified on the live API
UD11 ✅ Seed script: complete investigations with zero LLM calls
UD12 🟡 Real inject (live LLM) verified: three real runs reached rounds 1 to 2 with 36 of 36 citations verified, then the key's own limit (50 requests a day, 100,000 tokens) stopped them; one full run to a verdict is pending until the allowance returns (see OA8)
UD13 ✅ Logic: isolation actually fires within a 3-round debate: default eta 0.15 -> 0.20 (migration 0007, audited setting): three fully-failing rounds take CrS 0.5 -> 0.256 < 0.30, so the agent is isolated when round 3 is scored
UD14 ✅ Logic: non-primary agents reason on the scenario's own rows, then the same users in its time window, then the window, then a recent sample; the basis is recorded per agent (audit + API input_basis)
UD15 ✅ Debate off the request path with live progress and instant feedback: 202 + background run, GET /investigations/{id}/progress, Idempotency-Key, restart recovery (cut-off debates marked error, stale slot freed)
UD16 ✅ Exact ditto of the reference look: tokens identical and the eight pages that have a counterpart compared and recorded in docs/fidelity (Landing and Login have none in the reference); the contrast of every pair in use is measured (docs/fidelity/contrast.md)
UD17 ✅ Zero bluff on every stat, graph and label: contract-check proves the types match the live API, the E2E canary proves numbers on screen = API numbers and no invented claim on any page, and a claims audit has now read every page: Investigations, Debate Room, Trust, Fleet, Audit, Access (TA1 to TA6) and Landing, Login, Overview, Dashboard, Live (docs/CLAIMS_AUDIT.md: 11 statements reworded, each with a test; the audit file is also checked by the docs test)
UD18 🟡 UI easier to understand: hint strips, command palette, plain-word labels, quarantine and data-slice wording; the jargon pass is done (CrS is spelled out where it first meets a reader, the fingerprint is explained in the Dashboard Proof, every term has a Proof or a sentence); what remains is your ten minutes with the final build, to tell me what is still unclear

## C. 70 points — FRONTEND
FE1 ✅ Debate Room in sidebar + running/recent list
FE2 ✅ Public full-viewport landing page
FE3 ✅ Pages refresh live (WebSocket push, polling fallback when the socket is down)
FE4 ✅ Contrast measured: frontend/scripts/contrast-check.mjs (pnpm check:contrast, in CI) reads tokens.css and computes WCAG ratios for every text pair (46, all above 4.5:1, tightest 4.54) and every control edge (5, 3:1). One finding, fixed: inputs, selects and switches drew their edge in outline-variant at 1.4 to 1.7:1; they now use CONTROL_BORDER (outline, 5.4 to 6.6:1), one constant, with unit tests. Card borders and surface steps are decorative and keep the reference's values (docs/fidelity/contrast.md lists each with its ratio); SKILL-design-system amended
FE5 ✅ Investigations filter as a dropdown (FilterMenu: keyboard, Esc, click-outside)
FE6 ✅ First-visit hint strip (dismissible, remembered) on Dashboard, Investigations, Debate list + room, Trust, Fleet, Audit; every sentence is a true statement about the page
FE7 ✅ Inject feedback: 202 at once, 'Investigation x started' toast, one Idempotency-Key per modal opening, lands on the live debate
FE8 ✅ Empty states with an action ('Run first scenario', role-aware) on Dashboard ledger, Investigations and the Debate list
FE9 ✅ Icon whitelist widened (17 -> ~75 glyphs), any icon size
FE10 ✅ Command palette (Ctrl/Cmd+K and a TopNav button): pages, investigation search, inject; arrow keys, Enter, Shift+Enter, Esc

## D. 70 points — BACKEND
BE1 ✅ Debate off the request path: 202 at once, the queue worker runs it, progress endpoint (phase queued with place), restart recovery
BE2 ✅ Multi-worker safe: change events fan out over Redis pub/sub, and the CrS update is one atomic Redis transaction (40 threads lost updates before, none now; test mutation-checked)
BE3 ✅ Continuous mode is real: a simulated live feed (sensor, monitor, automatic investigations); /system/status.continuous_mode is true only while it runs
BE4 ✅ Gemini quota: daily caps, the single slot and the queue bound usage, and a debate ended by a quota or rate limit says so in plain words (which provider, daily or not, what to do) in the 502, the error frame and the Debate Room. Response caching is deliberately not built: an answer replayed from a cache would hide whether the provider still works
BE5 ✅ /stats cached 5 s in Redis, invalidated by every committed change, incremental chain check inside
BE6 ✅ Audit verify is incremental by default (checkpoint) and says so (mode, verified_from_seq); full=true re-verifies everything
BE7 ✅ Legacy unauthenticated /ws/scenarios route removed (with its manager code and tests)
BE8 ✅ List endpoints bounded (users, response-actions, citations, audit, investigations); a guard test fails for any unbounded array GET
BE9 ✅ Boot-time checks (JWT secret, Postgres, Redis, provider keys): production aborts with one clear message, development warns
BE10 ✅ Request logging: one structured line per request with a request id, slow-request warning, X-Request-ID exposed over CORS; provider latency/quota metrics still pending (SD7)

## E. 70 points — LOGIC
LG1 ✅ Isolation reachable in 3 rounds (eta 0.20; tests in credibility, engine and the HTTP API; SKILL docs + Trust page wording updated)
LG2 ✅ Verdict: the agent states its class itself (vote_class, one of the eight classes) and the verdict counts that; the keyword list is only the fallback for an answer that states none (older rows, a slip); a stated 'ambiguous' is an abstention; the primary-agent tie-break and the rest of the aggregation are unchanged. Found by classifying the 17 stored real OpenAI answers: 'No clear network attack is evident … weakly consistent with beaconing' was read as a botnet vote. Migration 0010 (reversible), the votes API says class_source (stated or keywords), the Debate Room row says 'stated' or 'read from text', SKILL-agent-prompts amendment 2026-10-11 (b). Tests: mutation-checked (6 fail when the stated class is ignored). Not yet seen with a real model: it needs credit (OA8)
LG3 ✅ Non-primary agents see the scenario's rows / time window (tiered, tested incl. day-padding and label-blindness); CICIDS (2017) vs CERT (2010-11) have no shared timeline, so a network scenario honestly falls back to a recent sample
LG4 ✅ Stance is stated in the agent schema (stance: CHALLENGE, SUPPORT or REVISE; lenient like vote_class), stored on the transcript, sent by the detail API and by the live snapshot (a screen opened mid-debate shows it); the first word of the theory is the fallback; the three prompts and the round 2/3 instruction ask for it in the same words; the offline stub states both fields; about 48 new backend test cases, 2 Vitest
LG5 ✅ Self-healing credibility gate now bites: an agent between 0.30 and 0.50 still votes but cannot trigger autonomous containment (it used to be the isolation threshold, which a contributing agent can never be under)
LG6 ✅ Insider scenario mapping derived from the CERT r4.2 answer files (event types per scenario: S1 off-hours logon + drive, S2 heavy drive use, S3 logon + file); a test re-derives them; the other insider class is accepted, so acceptable and family accuracy do not depend on the primary class
LG7 ⬜ Noise: separate, clearly labelled adversarial mode
LG8 ✅ Restore semantics documented in the README and proven end to end (restore resets CrS to 0.50, audited, history stays)
LG9 ✅ Live isolation path exercised end to end through POST /investigations/simulate: stub fabricate mode -> real Watchdog -> CrS -> quarantine -> next debate without the agent -> audited restore (+ seed_demo --drill, stub --fabricate)
LG10 ✅ Analyst feedback feeds an adaptive verdict threshold: newest 20 rows, 10 needed, 30% false positives tighten by 0.02, 5% or fewer relax by 0.01, at most once per 5 new rows, kept in 0.70-0.95, each move an audited settings_changed by adaptive_feedback; GET /settings/adaptive and a Trust page block. Scheduled retraining of the spec is not built: nothing in the system is trained
LG11 ✅ Blind test by construction: the investigators are handed AgentRow projections (backend/agents/rows.py), which have no label attribute at all, and the three agent modules import no database model; tests check both and that the projection is frozen

## F. 70 points — STRUCTURE
ST1 ✅ One source of truth for API schemas: no inline route models exist, a guard test keeps it that way
ST2 ✅ Big screens split into view and data files: every features/*/index.tsx is now under 300 lines (the largest, the Debate Room, has 291); typecheck, Vitest, build, no-bluff and Playwright green
ST3 ✅ usePageData (app/use-page-data.ts) works the page state out once (loading, failed, ready; a value kept from an earlier load stays ready) and <PageState> shows the placeholder and the plain-words error; nine screens migrated (Trust and its Evaluation and Adaptive floor panels, the case audit chain, the scenario modal, Dashboard, the Debate list, Live, Investigations); no-bluff-check.mjs fails on a page that repeats data === undefined with error === null (proved with a probe file); 9 new tests; the old page tests pass, and a Debate Room test that still looked for the label 'CrS' (reworded in the jargon pass) was brought up to date
ST4 ✅ Reference folder moved to reference/ and git-ignored (kept locally, never pushed)
ST5 ✅ Playwright specs: smoke, inject flow, hallucination drill (isolate -> quarantined everywhere -> restore by a lead), no-bluff canary (numbers = API, no invented claim on any page, null metric = em dash + reason), RBAC + forged token, audit verify + browser SHA-256, realtime without reload
ST6 ✅ One agent table on both sides: frontend/src/lib/agents.ts (INVESTIGATOR_IDS, INVESTIGATOR_VISUALS) replaces the three AGENT_TONE maps, the dashboard glyph map and the Trust id list; backend/agents/registry.py (ids, display names, domains, datasets, raw_logs sources, event types) replaces the copies in debate/state.py, routes/agents.py, investigations.py, scenarios.py and stats.py. Guards: no-bluff-check.mjs fails on a second frontend table (proved with a probe file) and backend/tests/agents/test_registry.py fails on a backend copy; 5 backend and 2 Vitest tests
ST7 ❓ API types vs backend: the hand-written types are VERIFIED against the live API and the OpenAPI by contract-check, which fails the build on any drift; generated types would add a dev library (openapi-typescript) outside the locked stack. Recommendation: do not add it. Your yes or no
ST8 ✅ Migration round-trip test (upgrade, downgrade base, upgrade) on a scratch database; single head 0007
ST9 ✅ The offline stub is a test harness and now lives apart from the developer tools: backend/testing/e2e_server.py (the application never imports it, test-checked); the checks that need the real key moved to backend/scripts/live_smoke/ (three smoke scripts and the new probe); 17 references updated (CI, README, guide, Playwright, seed scripts, four tests); a guard test fails if any file still names the old paths
ST10 ✅ Docs in sync: SKILL-security corrected (capability table, the sandbox is in-process mock services, not a container), SKILL-architecture, -agent-prompts and -data-schema updated (OpenAI only, error_reason, ask(), one reason call, the Watchdog match rule, 0009); backend/tests/docs/test_docs_in_sync.py (8 tests: migrations, capability table, audit actions, env names, routes named in documents, refused claims) passes, and a deliberately wrong line in a document makes it fail
ST11 ✅ LangGraph runs the debate: backend/debate/graph.py is a StateGraph (route_round fans out one node per investigator with Send, close_round joins them, then aggregate and respond); the investigators of a round run in parallel (peak 3 proven, results follow the agent order, a failing agent ends the debate as error); 63 debate tests, 703 backend tests green

## G. 70 points — FORMATTING
FM1 ✅ Surface elevation and borders on pure black: measured (card borders 1.2 to 1.6:1, surface steps 1.05 to 1.23:1) and kept as the reference's own look because they are decorative (WCAG asks nothing of them); the controls whose edge matters were raised to 3:1 (see FE4). Each exception is listed with its ratio in docs/fidelity/contrast.md
FM2 ➖ One locked type scale: closed. Your exact-ditto directive (UD16) keeps the reference font sizes, so a locked scale would reduce fidelity
FM3 ✅ Evidence values in the evidence font: test helper evidenceOutsideMono() (ids, digests, short ids outside font-mono) used by one test on Audit, Dashboard, Investigations (list and dossier), Debate Room, Trust, Live, Access and Overview; the detector itself is tested to fail on a bare id
FM4 ✅ Status colour never alone: statusIcon() beside every investigation status (Debate list, Live table, Dossier, Investigations cards, Dashboard ledger and incident banner), a glyph on verdict pills and on the adaptive-floor step pill; tests assert a different glyph per status
FM5 ✅ Number formatting: no-bluff-check.mjs now fails on toFixed, toLocaleString, toPrecision or Intl.NumberFormat outside lib/format.ts (proved with a probe file); the one hand-rounded aria-valuenow was fixed
FM6 ✅ Relative timestamps with the exact ISO time in the tooltip (Timestamp) on Dashboard, Investigations, Debate, Audit, Access, Overview, Trust
FM7 ✅ Copy button on shortened ids: the remaining sites got one (Dossier evidence caption, Live case links, queue banner) and no-bluff-check.mjs now fails on a {shortId(...)} printed as text without a CopyHash or CopyButton within six lines (proved with a probe file)
FM8 ❓ 4px spacing grid snap: proposal to close as superseded, like FM2, because the reference itself uses 2, 6, 10 and 14 px steps (gap-1.5, p-2.5, p-3.5) and your exact-ditto directive (UD16) keeps them. Your yes or no
FM9 ✅ Every page fits a phone screen: frontend/e2e/narrow.spec.ts visits nine routes, a debate, a dossier, the landing and sign-in screens at 390x844 and fails on any sideways page scroll (12 tests, on the seeded E2E stack). It found two real overflows (Dashboard 409 px, Landing 425 px: the agent-pod header row could not wrap), fixed with flex-wrap in PodTriad. The Investigations list and the Audit entries stack below 640 px; the other wide tables and the capability matrix scroll inside their own box instead of widening the page
FM10 ✅ color-scheme: dark set (native controls)

## H. 70 points — SYSTEM DESIGN
SD1 ✅ WebSocket fan-out over Redis pub/sub and an atomic CrS update (WATCH/MULTI with retry); the per-investigation socket is the one in-process part (documented: one API worker)
SD2 ✅ Debates run through a worker queue (backend/api/debate_queue.py, migration 0008): the queue is the investigations table (status queued, queued_at, run_spec with ids only), one worker takes the oldest, a second inject is accepted as queued with its place instead of 409, a restart keeps waiting debates, intake pause holds them; 11 backend tests, frontend queue banner and list
SD3 ✅ Idempotency-Key on POST /investigations/simulate (same key = same investigation, no second debate; a refused request frees the key)
SD4 ✅ Limits on waiting debates per analyst and in total (429 with the reason), checked before the daily caps are counted
SD5 ✅ Boot-time secret/key validation (api/startup_checks.py, 17 tests)
SD6 ✅ Reads: /stats cached 5 s, every list bounded, and per-client limits per minute on the heavy reads (evaluation 60, citations / audit / credibility 120, raw logs 240); a Redis outage never refuses a read
SD7 ✅ Observability: one structured line per request with a request id, and per-provider call time and quota-error counters in /system/status (shown on the Access page)
SD8 ✅ Audit: the dossier has a 'Case audit chain' panel fed by GET /investigations/{id}/audit-chain (entries of one case in chain order with their hash input, how each links into the global chain, a case digest, the global chain status). It is a view, nothing new is stored, and it says it is not a separate chain. The browser recomputes every entry's SHA-256 and the digest by the published rule and compares them with the server's (two implementations must agree); a changed entry is named in red. 11 backend tests (order, links, digest, no label, 404/401), 7 + 10 Vitest tests, contract-check, and a Playwright assertion on the real stack (17 of 17 match)
SD9 ✅ Logical export script (python -m backend.scripts.export_db): JSONL per table + manifest with row counts and chain-valid flag
SD10 ✅ docker compose --profile app runs backend + frontend (images built and smoke-tested); default compose still starts only the three services

## I. 70 points — DATA FLOW
DF1 ✅ Live sync after a debate: Audit / Trust / Investigations / Dashboard update without reload
DF2 ✅ Dashboard / Fleet / Trust / Overview / Investigations / Access all subscribe to change topics
DF3 ✅ One database + seed script keeps demo data present
DF4 ✅ Old dev investigations replaced by fully consistent seeded ones
DF5 ✅ Inject failure paths proven in the browser (frontend/e2e/inject-failures.spec.ts, 6 tests): paused intake (423), a filled daily cap (429), fewer than two active investigators (409) and a scenario with no rows (404) each show the server's own sentence with the dialog still open, no navigation and nothing created; a debate whose model call fails for lack of quota stops with its reason on the Debate Room, in the case list and as an investigation_failed audit entry, and the next injection works once quota returns; with the socket ticket refused the Debate Room still follows a running debate to its verdict. Test tooling: the offline stub got a quota mode (/__e2e/quota) and the E2E seed helper a fill-cap command; 2 backend tests
DF6 ✅ Provider shown per message in the debate stream and per investigation in the header
DF7 ✅ Continuous ingestion surfaced honestly: Access page reads continuous_mode from /system/status ('on · simulated live feed' or 'off · manual injection only')
DF8 ✅ Evaluation view: the Trust page has a new section 'Evaluation against labelled scenarios' (GET /evaluation with a source tab: model runs by default, offline stub, mixed, all): five headline rates, a model / stub / mixed row, a per-class table, a confusion matrix, results by noise level and the label mapping; every number a Metric with a Proof, a null rate shows a dash with its reason once, the stub's tab says 'measure the stub, not a model'; 9 panel tests + the Trust wiring + a Playwright assertion that the section equals the API after an injected DDoS; the API's reason sentence lost its developer hint '(see by_source)'. The data shows the honest picture: stub 20 scored, 50 % (it reads every network attack as DDoS), model runs none
DF9 ✅ Credibility history: Trust and Fleet show the global per-agent trend (last 60 scored rounds, threshold line); the Debate Room shows the per-case round-by-round CrS before and after
DF10 ✅ Footer shows live / reconnecting; screens poll as a fallback while the socket is down

## J. Release / hygiene
RL1 ✅ Your uncommitted agents WIP files never touched or committed
RL2 ✅ CI: backend job creates verdictchain_test and sets TEST_DATABASE_URL (YAML validated; GitHub Actions itself not run)
RL3 ✅ Backend suite on Python 3.12 (CI's version): 1033 passed in a python:3.12 container on the compose network against a scratch database (about 6 minutes); the first run there found one flaky test (an evidence-bundle assertion that matched '1.0' inside a timestamp), fixed; the development machine's 3.14 also gives 1033 passed
RL4 ✅ README rewritten; every command verified to exist
RL5 ✅ Final no-bluff sweep: the plan's blacklist over README, CLAUDE.md, the SKILL files, the guide, backend/api strings and the built bundle: 8 hits, all sentences that deny a claim or a note about dropped design pieces; 0 anywhere else
RL6 🟡 Local main is fast-forwarded to feat/ui-cyber-hud because you asked for everything in the repository and pasted the push-to-main commands; nothing is pushed or merged on GitHub until you run the push (see OP9)

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
CT10 ✅ Offline-stub investigations are marked: data_source (model / stub / mixed) from the stored providers, an 'Offline stub' badge with Proof on the lists, dossier, debate room and ledger; /evaluation counts model runs for its headline and shows stub accuracy separately and labelled
CT11 ✅ Votes carry counted; aggregator marks an isolated agent 'not counted · isolated'; a quarantined agent's lane says it did not take part
CT12 ✅ Manual containment re-derives the verdict WITHOUT isolated agents (it counted them: could contain a verdict the engine never reached); regression test, mutation-checked
CT13 ✅ rounds_complete counts the engine's round_completed audit entries (it was 0 for every debate that had a quarantined agent)
CT14 ✅ Most-cited ties break the same way everywhere (smallest value): dashboard, debate room, dossier and the containment target
CT15 ✅ Debate Room shows each agent's data slice (scenario rows / same user + window / window / recent sample) with a Proof, and says 'Quarantined: did not take part' for an agent that sat out
CT16 ✅ Debate Room says why a case was or was not contained: a 'Containment gate' card with four rows (a verdict was reached, the class has actions, confidence against the containment floor, every supporting agent against the starting CrS), each with its numbers and a Proof; derived in the browser by features/debate/gate.ts, which mirrors should_respond; 11 unit tests, 4 component tests, 2 Debate Room tests
CT17 ✅ Bugs the E2E suite found, all fixed with tests: the live verdict frame crashed the Debate Room, the snapshot gave action rows no id (React key warning), round frames carried a score dict where the page wanted a number, Overview crashed on a scenario with no rows, the first 401 could miss the login redirect, button inside a button in the scenario modal, dashboard without an h1, the palette lost its highlighted row on a refresh

## L. Real-time operation (your latest request: the system runs on its own)
RT1 ✅ Simulated sensor (backend/pipeline/live_feed.py): replays dataset rows into RabbitMQ on its own in short segments, pointer-only messages with no label, pauses when the queue backs up; 8 tests on real RabbitMQ
RT2 ✅ Monitor (live_monitor.py + live_detector.py): a window per source scored by a fixed rule that reads no label (network packet-rate spread; CERT window mean at 4 standard errors); on the local dataset 0 of 300 ordinary windows flagged per group and every scenario window flagged (measure_live_detector); Proof on each gauge
RT3 ✅ A flagged window starts an investigation by itself (trigger_type continuous) through the debate queue, guarded by intake pause, active agents, minimum gap, waiting limit, back-off after a failure, daily cap and queue limits; each refusal keeps its reason
RT4 ✅ Evaluation label of an automatic investigation is attached on the server (evaluation/live_labels.py); the monitor side never names a label (AST test), run_spec, audit detail and API responses carry none
RT5 ✅ Live feed page: honest simulated-replay notice, Metric tiles, one gauge per window with its rule, arrivals, last automatic investigation, why nothing started, investigations the monitor started; pushed over the live topic
RT6 ✅ Start and stop: capability control_live_feed, rate limited, audited (live_feed_started / live_feed_stopped with the analyst), speed and automatic-investigation switch chosen at start, LIVE_FEED_AUTOSTART for the API start-up
RT7 ✅ Tests: 12 API/runner, 41 pipeline, 15 Vitest and 2 Playwright specs (feed -> flagged window -> investigation -> verdict with nobody clicking); full Playwright suite 12 passed
RT8 ✅ Queue place shown: progress phase queued, Debate Room banner that reloads by itself, Debate list section, top bar chip with the queued count, inject toast
RT9 ✅ The Debate Room no longer freezes when the live socket cannot open (a refused ticket) or drops: while a case is running and no socket is open it reads the stored case again every 4 seconds (hook usePollWhile, 5 tests; 4 Debate Room tests; proved end to end by the DF5 socket test)

## M. Truth audit (found while writing the faculty guide: a label or Proof that did not match the code)
TA1 ✅ Analyst feedback is now in the audit chain: the dossier Proof said 'audited' but the route wrote only the feedback row; it now appends analyst_feedback (actor = the signed-in user, detail only verdict_was_correct) in the same transaction; 2 new tests (entry + chain valid; unknown case writes nothing), the stats-cache test rewritten to keep its premise, mutation-checked
TA2 ✅ The verdict confidence floor was described as 'decides a non-ambiguous verdict' on the Trust slider, the Debate Room and the Access page; in the code it is the Self-Healing gate (confidence at or above the floor and every contributing agent at CrS 0.50 or more) and the class comes from the vote. Wording fixed on all three; the Debate Room label is now 'Containment floor'
TA3 ✅ Fleet: the Watchdog and Self-Healing counters were labelled '(24 h)' but are all-time counts; relabelled
TA4 ✅ Audit inspector: the green 'Verified proof' tag was static (it showed even when the browser recompute failed); it now follows the recompute ('Hash verified in browser' / red 'Hash mismatch'), test added
TA5 ✅ Audit 'Verify' ran the server's incremental pass (blind to a change in an older row) and its answer replaced the list's whole-log check; it now runs ?full=true, a break reported by either check shows 'Broken', the tile says which pass ran; client type gained mode and verified_from_seq; 3 tests
TA6 ✅ 'Gapless' removed from the Audit page (a database identity column can skip numbers after a rollback)
DOC1 ✅ docs/PROJECT_GUIDE.md, the faculty guide, is complete: parts 0 to 9 (about 1,700 lines): every page with its elements, source and formula, four real cases walked through, the engine's rules (lifecycle, prompts, validation, Watchdog, verdict, containment, audit chain, evaluation, OpenAI limits, honest real-model status), the data model, the API map generated from the OpenAPI, the security map, the test evidence, 23 faculty questions with the honest limits, a 15-minute demo script with Plan B, troubleshooting and a command sheet; 18 screenshots taken with real icons; checked against the code and by the docs test. Open on your side: read Part 8

## N. OpenAI only, and the first runs against the real model (2026-10-11)
OA1 ✅ OpenAI is the only provider everywhere: one client (llm_clients.py), model from OPENAI_MODEL, a rolling 24 hour token budget, Groq and Gemini gone from code, config, CI, compose, UI, stub, docs and tests
OA2 ✅ A failed debate says why: investigations.error_reason (migration 0009) and an investigation_failed audit entry, shown in the Debate Room banner, the lists and the dossier; a live error frame flips the room to 'Debate stopped'; 12 backend and 8 frontend tests
OA3 ✅ A model slip costs one more question, not the debate: an invalid answer is re-asked once with the reason; agent_id and round are set from what was asked; other agents' row ids are withheld from the debate context; the prompts ask for one field per citation; a cut-off answer is asked again with room
OA4 ✅ The Watchdog matches a cited value as the agents read it (JSON text, Python text or the same number): the real run went from 28 of 44 to 36 of 36 verified
OA5 ✅ The key's own limits are read and obeyed: x-ratelimit headers kept in Redis, a 429 with a long wait is not retried and says when it frees up, an allowance block in /system/status and /live/status shown on the Live and Access pages, and a debate the key cannot finish is declined with 429 before it is queued
OA6 ✅ Fewer requests and tokens per debate: the network prompt carries 29 named fields instead of 67, 3 to 6 citations, one call writes all reasons of a verdict, daily debate caps 30 and 60 (the token budget is the cost guard)
OA7 ✅ Backend lint and format clean (black, ruff); every focused suite green; the failing timing test of the graph was made load-proof
OA8 🟡 Full real run to a verdict and a containment (manual, then the live feed with 'Call OpenAI after' 300): no longer blocked. The owner added the $5 credit (Build tier) and the project's probe shows 2,000,000 tokens and 5,000 requests a minute for gpt-6-luna, gpt-5.4-mini and gpt-4.1-mini alike, with 66 debates fitting at once; the review model is gpt-4.1-mini (OPENAI_MODEL). What is left is the run itself, which the owner makes with their own hands (manual injection and live feed); then record the tokens and the cost here
OA9 ✅ Re-run after the last edits, all green on 2026-10-11: backend 1033 passed (92 modules), black and ruff clean, Vitest 65 files / 548 tests, tsc, build, no-bluff (240 files, 0 violations), contrast (63 pairs, 0 below), contract-check (27 live + 14 schema, 0 failing), Playwright 32 passed
OA10 ✅ A stopped debate looks stopped everywhere: the cut-off round says 'Round 3 : stopped · 2 of 3 answered', the pill says 'no quorum: the debate stopped', the votes are headed 'Latest answers, classified (no vote was taken)', the verdict card and the containment gate say 'no verdict: the debate stopped'; derive, gate, component and page tests
OA11 ✅ Plan B cannot be blocked by a spent key: the offline stub forgets the limit that earlier real runs recorded in Redis when it starts (forget_provider_limits), 1 test
OA12 ✅ The top-bar live chip names 'OpenAI key limit' when OpenAI's own allowance is too small (it said nothing before); 3 tests
OA13 ✅ The six Starlette deprecation warnings of the backend suite are gone (HTTP_422_UNPROCESSABLE_CONTENT at four sites); the suite runs with no warnings
OA14 ✅ A spent allowance no longer blocks for a month: when the key's tokens ran out OpenAI said 'about 30 days', the app recorded that and refused every call for 30 days, also after credit was added and until the process was restarted. A wait longer than an hour is now believed for 5 minutes only (hold_in_force, RECHECK_S); after that the next call goes to OpenAI, whose answer decides, and an answer clears the wait; the Live and Access pages stop saying 'nothing is sent until …' at the same moment. 4 tests, mutation-checked
OA15 ✅ python -m backend.scripts.live_smoke.openai_probe asks the model one tiny question through the project's own client, leaves the key's allowance for the Live and Access pages and prints requests and tokens left and how many whole debates fit (exit code 0 when one does); 8 tests; the key is never printed
OA16 ✅ OpenAI's 'no credits remaining' answer (type insufficient_quota, code credit_balance_exhausted, seen live on seven models) is a spent account: it is not retried for 35 seconds and then called 'rate limiting, try again in a minute'; it fails at once with 'no quota or credit left', holds the client for 60 seconds only so the first call after a top-up goes through; 2 tests
OA17 ✅ The $5 top-up is verified and the model is switched: all three models probed answer 200 with the Build-tier limits; OPENAI_MODEL is now gpt-4.1-mini (the same limit as Luna, no hidden thinking tokens, about a second a call; one line to go back); the API was restarted on it; prices checked on the model pages (gpt-4.1-mini $0.40 / $0.10 / $1.60 per million tokens, so 2 to 9 cents a debate)

## O. Parallel investigations, the automation board and printable reports (2026-10-11)
OP1 ✅ Debates run side by side: a Redis sorted-set slot semaphore (one atomic Lua script, an expiry on every slot, maintenance takes all slots at once) and a worker pool sized by DEBATE_MAX_CONCURRENT (default 4); a case is claimed with FOR UPDATE SKIP LOCKED; safe because a credibility update is one atomic WATCH/MULTI transaction and audit writes take an advisory lock; 7 slot tests, 12 queue tests including a parallel run counted by a Counter
OP2 ✅ The live feed keeps up with the logs: the minimum gap is per source window (20 s), 4 automatic investigations may wait for a free slot, 80 a day (counted in the global cap of 120), so a stream of 1,000 to 1,500 rows becomes several investigations instead of one; every refusal keeps its reason in 'Why nothing started'; per-window cooldown tests in test_live
OP3 ✅ /stats.automation (Metric envelope, last 24 hours): share of cases the monitor started, cases contained hands-free, median detect-to-verdict and verdict-to-contain, each with its n and a Proof; /system/status.debate_slot gained running and capacity and the ids of the cases holding a slot; contract-check and the no-bluff contract test cover the new numbers
OP4 ✅ The Investigations page shows the automation, not only its results: an operations board (five live metrics and one lane per debate slot), a Detect > Debate > Verdict > Contain strip on every case card, an automation timeline, a Self-Healing agent panel (the four gate checks, the playbook with every action marked Simulated, the sandbox boundary), an evidence storyline; the same lanes on the Live page and a top-bar chip; 45 Vitest tests
OP5 ✅ Printable case report and chain-of-custody record (#/report/<id>, #/custody/<id>): A4 pages outside the console shell, the browser's print dialog saves them as PDF (no PDF library, selectable text), the digests are recomputed in the browser; 19 Vitest tests and a Playwright spec that prints both to real PDFs; the guide has the pages (Part 3.7 C, screenshots 22 to 25)
OP6 ✅ The report summary says when the primary investigator broke a tie (the same function the Debate Room uses) and no longer doubles the full stop after a failure reason; 1 new test and 1 corrected expectation
OP7 ✅ Docs follow the code: the guide (Part C printable documents, the operations board, new screenshots), README, SKILL-architecture, SKILL-design-system 11b, docs/fidelity (eight pages and the contrast table), docs/CLAIMS_AUDIT
OP8 ✅ Defaults agree everywhere: global debate cap 120, token budget 2,000,000 in the compose file too, and the container now receives DEBATE_MAX_CONCURRENT and the LIVE_* limits from .env; the config-defaults test (it asserted the old cap) is updated
OP9 🟡 Everything is committed locally on feat/ui-cyber-hud and main is fast-forwarded to it; the push to https://github.com/jack121200/VerdictChain.git needs your GitHub sign-in (no credentials in this session): the exact commands are in the last message

## What is left, and exactly how it will be done

Rough sizes: S under 30 min, M 1 to 2 hours, L half a day. Counts are printed by the update script after every task, not typed here.
After every item: run the test suites of every area it touched (regression guard), commit with what was re-verified, update this file.

**What is open now:** LG7 (adversarial noise: needs your OK on the definition), the items that need your word (below), and the push. Everything else in this file is done.

### LG7 · Adversarial noise (M, needs a definition)
- Proposal: `noise_mode = adversarial` replaces k % of the scenario's rows with rows of a different attack class from the same source (decoys), chosen on the server by label, no hint to the agents; stored in `investigations.noise_mode` (migration 0009); a separate, labelled option in the inject dialog; excluded from the headline accuracy and shown on its own line like the stub.
- Tests: noise unit tests, simulate route, evaluation split. Needs: your OK on this definition (default: build as described, off by default).

### Needs your word
- **PH9 + UD12 + OA8 · one live OpenAI run (yours).** With OPENAI_API_KEY and OPENAI_MODEL in `.env`: a manual injection from the Dashboard, then the live feed (Live page, 'Call OpenAI after' 300 rows); check that the case reads as a model run (no stub badge), the Debate Room is live, citations verify, containment runs and `/evaluation` shows the run; then record the tokens and the cost under OA8. A debate costs about 2 to 9 cents on gpt-4.1-mini.
- **PH8 · CI on GitHub.** The workflow has never run. Push `feat/ui-cyber-hud` to https://github.com/jack121200/VerdictChain.git (no merge), watch the run, fix CI-only failures (service containers, Playwright browsers). Needs: your GitHub sign-in for the push.
- **ST7 · generated API types.** Would add a dev library (`openapi-typescript`) outside the locked stack. Recommendation: no, `contract-check` already fails the build on any drift. Needs: yes or no.
- **FM8 · 4 px grid.** Proposal: close as superseded, like FM2, because the reference itself uses 2, 6, 10 and 14 px steps (`gap-1.5`, `p-2.5`, `p-3.5`) and exact-ditto (UD16) keeps them. Needs: yes or no.
- **UD18 · first-time-user pass.** I list every jargon word (CrS, eta, floor, quarantine, stub, data slice) and make sure each has a plain sentence or a Proof; the last step is yours: ten minutes with the final build, tell me what is still unclear.
- **RL6 · main on GitHub.** Local main equals feat/ui-cyber-hud; `git push -u origin main` (and `git push -u origin feat/ui-cyber-hud`) publishes it. The push is yours: no GitHub credentials exist in this session.

## Open decisions for you (❓)
- ST7: API types vs backend: the hand-written types are VERIFIED against the live API and the OpenAPI by contract-check, which fails the build on any drift; generated types would add a dev library (openapi-typescript) outside the locked stack. Recommendation: do not add it. Your yes or no
- FM8: 4px spacing grid snap: proposal to close as superseded, like FM2, because the reference itself uses 2, 6, 10 and 14 px steps (gap-1.5, p-2.5, p-3.5) and your exact-ditto directive (UD16) keeps them. Your yes or no
