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
PH8 ⬜ Playwright E2E flows + no-bluff canary + CI extension
PH9 ⬜ Final integration: full backend + frontend suites, ONE live-LLM smoke run, final docs, Python 3.12 run

## B. Your directives (this chat)
UD1 ✅ Navigation moved from top bar to a left sidebar
UD2 ✅ Background pure jet black
UD3 ✅ Public landing page first, login behind a button
UD4 ✅ Landing hero fills the whole screen (not compact)
UD5 ✅ Debate Room reachable from the sidebar (live + recent list)
UD6 ⬜ Investigations filter becomes a clean dropdown
UD7 ✅ Overview and Access screens no longer crash (raw-logs/counts shape fixed)
UD8 ⬜ Overview + Access visual fidelity to the reference, verified by screenshot
UD9 ✅ Realtime push on EVERY page: Redis pub/sub event bus + /ws/events + every screen subscribes (proven: audit head #94 -> #111 in 0.6 s with no reload)
UD10 ✅ Why data did not sync: ROOT CAUSE (frontend types did not match the real API; mocks hid it) fixed, and every route re-verified on the live API
UD11 ✅ Seed script: complete investigations with zero LLM calls
UD12 ⬜ Real inject (live LLM) verified end to end once
UD13 ✅ Logic: isolation actually fires within a 3-round debate: default eta 0.15 -> 0.20 (migration 0007, audited setting): three fully-failing rounds take CrS 0.5 -> 0.256 < 0.30, so the agent is isolated when round 3 is scored
UD14 ✅ Logic: non-primary agents reason on the scenario's own rows, then the same users in its time window, then the window, then a recent sample; the basis is recorded per agent (audit + API input_basis)
UD15 ⬜ Logic: debate as a background job + live progress + instant inject feedback
UD16 🟡 Exact ditto of the reference look (tokens identical; Investigations + Trust re-ported; rest unverified)
UD17 🟡 Zero bluff on every stat, graph and label: contract-check now proves types match the live API; full audit pass + Playwright canary pending
UD18 ⬜ UI easier to understand (first-visit guidance, clearer labels)

## C. 70 points — FRONTEND
FE1 ✅ Debate Room in sidebar + running/recent list
FE2 ✅ Public full-viewport landing page
FE3 ✅ Pages refresh live (WebSocket push, polling fallback when the socket is down)
FE4 🟡 Jet black done; surface steps/borders re-tune for contrast pending
FE5 ⬜ Investigations filter as a clean dropdown/drawer
FE6 ⬜ First-visit hints / "how to read this" strip
FE7 🟡 Inject feedback: navigates to the debate; progress toast + "started" confirmation pending
FE8 ⬜ Empty states with an action ("Run first scenario")
FE9 ✅ Icon whitelist widened (17 -> ~75 glyphs), any icon size
FE10 ⬜ Global search / command palette (investigation id, host, row)

## D. 70 points — BACKEND
BE1 🟡 Debate off the request path: 202 + background thread done; queue-backed job + status endpoint pending
BE2 🟡 Multi-worker safe: events fan out over Redis pub/sub (done); atomic CrS update pending
BE3 🟡 Continuous mode: honestly reported as OFF; not wired to the pipeline
BE4 🟡 Gemini quota: daily caps + in-flight slot exist; clear quota-error message + caching pending
BE5 ⬜ /stats cached / precomputed (no full re-verify per call)
BE6 ⬜ Audit chain incremental verify
BE7 ⬜ Remove legacy unauthenticated /ws/scenarios route
BE8 🟡 Pagination: audit before_seq + investigations limit/offset done; remaining lists pending
BE9 ⬜ Boot-time provider key validation, fail fast with a clear message
BE10 ⬜ Request logging + provider/latency/quota metrics

## E. 70 points — LOGIC
LG1 ✅ Isolation reachable in 3 rounds (eta 0.20; tests in credibility, engine and the HTTP API; SKILL docs + Trust page wording updated)
LG2 🟡 Verdict: primary-agent tie-break done (+tests); structured verdict field instead of keywords pending
LG3 ✅ Non-primary agents see the scenario's rows / time window (tiered, tested incl. day-padding and label-blindness); CICIDS (2017) vs CERT (2010-11) have no shared timeline, so a network scenario honestly falls back to a recent sample
LG4 ⬜ Stance enforced in the agent schema (not parsed from the first word)
LG5 ⬜ Self-healing credibility gate can actually bite
LG6 ❓ Evaluation insider ground-truth mapping needs your confirmation
LG7 ⬜ Noise: separate, clearly labelled adversarial mode
LG8 🟡 Restore semantics: tested (restore resets CrS to 0.5, audited with previous CrS + note, no history recovery); UI/README wording pending
LG9 ✅ Live isolation path exercised end to end through POST /investigations/simulate: stub fabricate mode -> real Watchdog -> CrS -> quarantine -> next debate without the agent -> audited restore (+ seed_demo --drill, stub --fabricate)
LG10 ⬜ Analyst feedback actually feeds an adaptive threshold

## F. 70 points — STRUCTURE
ST1 ⬜ One source of truth for API schemas (no inline route models)
ST2 ⬜ Split 700–1000-line screens into view / data
ST3 ⬜ Shared usePageData hook (load / live / empty)
ST4 ❓ Reference folder: move to /reference or delete after the port
ST5 ⬜ Playwright specs (canary + flows)
ST6 ⬜ Agent id / name mapping centralised
ST7 🟡 API types vs backend: hand-written types now VERIFIED against the live API + OpenAPI by contract-check (no codegen)
ST8 ⬜ CI migration downgrade test
ST9 ⬜ Dev tools separated from the test harness in backend/scripts
ST10 ⬜ Docs consolidated (CLAUDE.md + SKILL files in sync)

## G. 70 points — FORMATTING
FM1 ⬜ Surface elevation + borders re-tuned for pure black
FM2 ⬜ One locked type scale
FM3 ⬜ Evidence values always JetBrains Mono (audit)
FM4 ⬜ Every status colour paired with an icon shape (audit)
FM5 ⬜ Number formatting centralised (counts / decimals / percent)
FM6 ⬜ Relative timestamps with absolute tooltip
FM7 ⬜ Copy button on every truncated hash
FM8 ⬜ 4px spacing grid snap
FM9 ⬜ Mobile: dense tables stack
FM10 ✅ color-scheme: dark set (native controls)

## H. 70 points — SYSTEM DESIGN
SD1 🟡 WS fan-out over Redis pub/sub done; CrS updates atomic pending
SD2 ⬜ Debates through a worker queue (RabbitMQ)
SD3 ⬜ Idempotency key on simulate (double-click safe)
SD4 ⬜ Per-user (not global) debate slot
SD5 ⬜ Boot-time secret/key validation
SD6 ⬜ Read endpoints rate-limited + cached
SD7 ⬜ Observability: provider, latency, quota
SD8 ⬜ Audit: per-investigation sub-chain + global chain
SD9 ⬜ DB backup / export script
SD10 ⬜ docker compose runs backend + frontend too (one command)

## I. 70 points — DATA FLOW
DF1 ✅ Live sync after a debate: Audit / Trust / Investigations / Dashboard update without reload
DF2 ✅ Dashboard / Fleet / Trust / Overview / Investigations / Access all subscribe to change topics
DF3 ✅ One database + seed script keeps demo data present
DF4 ✅ Old dev investigations replaced by fully consistent seeded ones
DF5 🟡 Inject -> debate handoff: id in URL + replay exist; failure paths unproven
DF6 ⬜ providers_used shown in the UI per round
DF7 ⬜ Continuous ingestion surfaced or removed from the claims
DF8 🟡 Labelled evaluation runs: seeded with labels; /evaluation view not yet re-checked
DF9 ❓ Credibility history: per-case vs global trend (your decision)
DF10 ✅ Footer shows live / reconnecting; screens poll as a fallback while the socket is down

## J. Release / hygiene
RL1 ✅ Your uncommitted agents WIP files never touched or committed
RL2 ⬜ CI: TEST_DATABASE_URL for the backend job
RL3 ⬜ Backend suite on Python 3.12 (CI pin; local is 3.14)
RL4 ⬜ README run instructions (backend, frontend, seed, stub)
RL5 ⬜ Final no-bluff sweep against the blacklist
RL6 ⬜ Merge decision: branch feat/ui-cyber-hud -> main (only when you say)

## K. Integration contract (new: found while tracing "data not syncing")
CT1 ✅ contract-check script: every client endpoint, response AND request body, validated against the live API + OpenAPI
CT2 ✅ Investigations list/detail and citations page fixed through adapters, tested on payloads captured from the real backend
CT3 ✅ Status words fixed (investigating/error), dataset name ("CERT r4.2"), debate_slot.status
CT4 ✅ POST/PUT response types fixed to the backend shapes: sign, containment, release, fault-injection, quarantine, stats, evaluation, bundle
CT5 ✅ Evaluation types accept "unclassified"/"BENIGN"; simulate 202 documented in OpenAPI; contract-check 0 failing on 22 live + 12 spec endpoints
CT6 ⬜ contract-check wired into the e2e/CI job (stub backend)
CT7 ✅ Every screen re-verified on the live API after the fixes: all 11 routes render real data, 0 console/page errors, 0 HTTP >= 400 (found + fixed a nested-button bug on Fleet)
CT8 ✅ Backend /stats gained mean_crs + citation counts the screens needed (+ tests)
CT9 ✅ Seeded + stub data is honestly labelled: providers read stub-groq / stub-gemini (restored on uninstall, tested); dev DB reseeded: 6 investigations, 70 stub replies, 0 real provider calls
CT10 ⬜ UI marks investigations produced by the offline stub, so evaluation accuracy on stub data never reads as system accuracy
CT11 🟡 API votes carry counted; quorum + supporters use counted votes; the aggregator marks an isolated agent as not counted; Debate Room lane wording for a quarantined agent pending
CT12 ✅ Manual containment re-derives the verdict WITHOUT isolated agents (it counted them: could contain a verdict the engine never reached); regression test, mutation-checked
CT13 ✅ rounds_complete counts the engine's round_completed audit entries (it was 0 for every debate that had a quarantined agent)
CT14 ⬜ Subject / containment-target ties: UI and backend must break a most-cited tie the same way (smallest value) and say it was a tie
CT15 ⬜ Debate Room shows each agent's input basis (scenario rows / same user window / time window / recent sample) and says 'quarantined, did not take part' for an agent that sat out

## Open decisions for you (❓)
- LG6 confirm insider scenario -> verdict-class mapping used by /evaluation
- ST4 keep, move or delete verdictchain---multi-agent-soc/
- DF9 credibility trend: global per agent, or per investigation
