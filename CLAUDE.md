# CLAUDE.md — VerdictChain

## What this project is
VerdictChain is a multi-agent insider-threat & network-intrusion forensics platform.
Three investigator agents analyze different log slices and debate over 3 rounds to
reach a verdict. A Watchdog agent continuously scores each investigator's credibility
by cross-checking their cited evidence against raw logs. A Self-Healing agent
auto-contains confirmed threats in a sandbox. Everything is logged to an immutable
audit trail and shown on a live dashboard (React frontend, approved HUD design: SKILL-design-system.md v2).

Read `/.claude/skills/*.md` before touching the matching part of the system. Do not
guess architecture, agent behavior, schema, styling, or security rules — they are
already fully specified there.

## Tech stack — LOCKED. Never substitute or add a library outside this list without asking.
- Orchestration: LangGraph (Python)
- LLM backend: Groq (primary/fast path) + Gemini (secondary path, used by specific
  agents — see SKILL-agent-prompts.md Section 7 for routing). Cloud-only, no Ollama,
  no offline fallback — internet connectivity is required and guaranteed for dev/demo.
- Backend API: FastAPI (REST + WebSocket), async, Pydantic models on every endpoint
- Database: PostgreSQL (Neon/Supabase in prod, local Postgres via Docker in dev)
- Cache / live credibility scores: Redis
- Message queue (agent-to-agent + log ingestion): RabbitMQ
- Frontend: React (TypeScript). Port the approved HUD design (SKILL-design-system.md v2) onto the real API; the reference export lives in verdictchain---multi-agent-soc/ and is read-only
- Icons: Material Symbols Outlined (font). Lucide is not used
- Charts: hand-written SVG. Recharts is not used
- Test tooling: Vitest (frontend unit tests) and Playwright (frontend E2E)
- Containers: Docker + Docker Compose
- CI/CD: GitHub Actions
- Migrations: Alembic

## Golden rules — ALWAYS
1. Read the relevant `/.claude/skills/*.md` file(s) before writing code for that module.
2. Write the MINIMUM correct code for the task. No boilerplate bloat, no speculative
   abstraction, no 1000-line files where 100 lines do the job.
3. Every module ships with a test. Run it. Show the passing output before saying "done".
4. Parameterized DB queries only — never string-format SQL.
5. Secrets come from `.env` only. Never hardcode a key, token, or connection string.
6. Investigator agents are NEVER told which scenario/attack-type was selected
   (blind-test principle — this is a core scientific property of the system).
7. Self-healing actions run in a sandbox only. They must never be able to reach a
   real system, even by accident — enforce this in code, not just by convention.
8. After any change, run the Regression-Guard Protocol (below) before moving on.
9. Follow the exact design tokens in `SKILL-design-system.md` (v2, the approved HUD design)
   for any UI work — no ad hoc colors, fonts, or spacing values.
10. **NO BLUFF.** Full contract: `C:\Users\jatin sharma\.claude\plans\verdictchain-multi-agent-soc-ye-file-mei-stateful-perlis.md` §1.
    - Every value, label, chart point, row and status is an API field, or a browser function of API fields whose formula shows in its Proof popover. Nothing is typed into components. Every metric and control has a Proof popover (R1, R5).
    - Live numbers use the `Metric` envelope. A null value shows "—" with its reason. Never 0 for missing data; a real count of 0 shows as 0 (R2).
    - Rates and averages need n ≥ 1, shown in Proof. "Agent-reported confidence" is not accuracy; accuracy comes only from `/evaluation`. Brier comes only from analyst feedback and is null until feedback exists (R3, R4).
    - No claim without a mechanism: no RFC, Merkle, Ed25519, eBPF, container isolation, literature statistics, zero-trust, Byzantine claims or invented entities. Only real project entities (R6, R7).
    - Every control is a real, RBAC-gated, audited action, or it is removed. The blind test is a checked property, and the UI links to the proof location (R8, R9).
    - Enforced by `frontend/scripts/no-bluff-check.mjs`, the backend contract test and the Playwright canary (R10). Blacklist: plan §7.

## Golden rules — NEVER
- Never invent a new library or service outside the locked stack.
- Never hardcode data into the frontend — every value the UI shows comes from a
  real API/WebSocket call, with zero exceptions ("no bluff" requirement).
- Never expose the ground-truth scenario label to any investigator agent.
- Never mark a task complete without actually running it and seeing the output.
- Never silently change a module's public interface (function signature, API route,
  DB column) without checking and updating every caller.

## Regression-Guard Protocol (one fix must never break another module)
1. Before editing shared/core code, list every module that imports or calls it.
2. After the edit, re-run the tests for ALL of those modules — not just the one you
   changed.
3. If any previously-passing test now fails, STOP. Report it. Do not "fix forward"
   by patching around it blindly — diagnose the root cause first.
4. Only commit once the full test suite for every touched area is green.
5. Commit messages state what changed and which modules were re-verified.

## Team split (context, not enforced by code)
- Team A: Investigator Agents + Debate Engine
- Team B: Watchdog + Self-Healing + Dashboard wiring

## Where things live
```
verdictchain/
├── CLAUDE.md
├── .claude/skills/          ← architecture, agent-prompts, data-schema,
│                               conventions, security, design-system
├── data/                    ← raw + cleaned datasets (CICIDS2017, CERT r4.2)
├── frontend/                ← React (TypeScript) app: approved HUD design on the real API
├── backend/
│   ├── pipeline/            ← ingestion, normalization, feature extraction
│   ├── agents/               ← investigator agents (LangGraph nodes)
│   ├── debate/               ← debate engine / state machine
│   ├── watchdog/              ← credibility scoring + verification
│   ├── self_healing/          ← containment actions (sandboxed)
│   ├── api/                   ← FastAPI routes + WebSocket
│   └── tests/
└── docker-compose.yml
```

## First command to run each new session
"Read CLAUDE.md and every file in /.claude/skills/. Summarize the locked stack, the
golden rules, and the regression-guard protocol back to me in 5 lines before doing
anything else."
