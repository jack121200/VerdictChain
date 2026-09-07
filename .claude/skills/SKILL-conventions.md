---
name: SKILL-conventions
description: Coding standards, folder structure, and the regression-guard workflow. Read before writing or restructuring any code.
---

# VerdictChain — Coding Conventions (LOCKED)

## Folder structure
```
backend/
├── pipeline/        # ingestion.py, normalization.py, feature_extraction.py, log_streamer.py
├── agents/          # network_traffic.py, access_log.py, endpoint_behavior.py, base_agent.py
├── debate/          # engine.py, state.py, verdict.py
├── watchdog/        # credibility.py, verification.py
├── self_healing/    # actions.py, sandbox.py
├── api/             # routes/, websocket.py, schemas.py (Pydantic models)
├── db/              # models.py (SQLAlchemy), migrations/ (Alembic)
└── tests/           # mirrors the structure above 1:1
frontend/            # existing Figma Make React/TS app
data/                # raw/ and processed/ datasets
```

## Language & style
- Python: type hints on every function signature. `black` + `ruff` for formatting/lint.
- Async FastAPI handlers throughout; no blocking calls inside `async def` (no
  synchronous requests/DB calls without an async driver or `run_in_executor`).
- TypeScript strict mode on the frontend. No `any` unless genuinely unavoidable,
  and comment why when it is.
- One responsibility per file. If a file is doing ingestion AND feature extraction,
  split it.
- No global mutable state. Pass dependencies explicitly (FastAPI's `Depends`,
  constructor injection, etc.).

## Size discipline ("minimum correct code")
- Prefer the smallest change that correctly solves the task.
- Do not pre-build configurability, plugin systems, or abstractions for
  requirements that don't exist yet.
- A module's first version should be as short as it can be while passing its tests.
  Refactor for reuse only once a second real caller appears.

## Testing
- Every module gets unit tests before it's considered done (pytest for backend,
  Vitest/Jest for frontend where applicable).
- Integration test for the full pipeline (log in → verdict out) is required before
  Module 9 (CI/CD) is considered complete.
- Playwright end-to-end test drives the actual dashboard through the demo scenario.

## Git workflow
- Small, frequent commits. One logical change per commit.
- Commit message format: `[module] short description` — e.g.
  `[watchdog] add credibility score update + isolation threshold`.
- Never commit `.env`, `node_modules/`, `__pycache__/`, or raw data files
  (`data/raw/` is gitignored — only small processed samples may be committed).

## Regression-Guard Protocol (repeated here for emphasis — see CLAUDE.md)
1. Before editing shared/core code, list every module that imports or calls it.
2. After editing, re-run tests for ALL of those modules, not just the one you
   changed.
3. Any previously-passing test that now fails → STOP and diagnose the root cause.
   Do not patch around it blindly.
4. Commit only when the full touched-area test suite is green.

## The 5-step loop for every module (also see the "autonomous build loop" guide)
1. **Plan** — read the relevant skill file(s), propose file list + approach, wait
   for approval on anything non-trivial.
2. **Build** — smallest correct implementation.
3. **Test** — write/run tests, show passing output.
4. **Verify** — run the regression-guard protocol.
5. **Commit** — clear message, then move to the next module.

## Definition of Done (per module)
A module is NOT done until all of the following are true:
- [ ] Code runs without errors.
- [ ] Its own tests pass.
- [ ] Tests for every other module that depends on it still pass.
- [ ] No hardcoded values that should come from `.env`, the DB, or the API.
- [ ] Frontend (if touched) shows real data, not mock/placeholder data.
- [ ] Committed with a clear message.
