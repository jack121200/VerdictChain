# VerdictChain

Multi-agent insider-threat & network-intrusion forensics platform. See `CLAUDE.md`
and `.claude/skills/*.md` for the full architecture, agent prompts, data schema,
security rules, and design system — those are the source of truth, not this file.

## Stack

Python/FastAPI backend (REST + WebSocket), Postgres + Redis + RabbitMQ via Docker
Compose, Groq/Gemini for agent LLM calls, React/TypeScript frontend (Vite).

## First-time setup

```bash
docker compose up -d                        # Postgres, Redis, RabbitMQ
pip install -r backend/requirements.txt
cd backend && python -m alembic upgrade head && cd ..

# ingest the datasets (data/raw_data/ must already hold the CICIDS2017 +
# CERT r4.2 files - see .claude/skills/SKILL-architecture.md Section 9)
python -m backend.pipeline.ingestion
python -m backend.pipeline.cert_ingestion

cd frontend && pnpm install && cd ..
```

`.env` (gitignored) needs `GROQ_API_KEY`, `GEMINI_API_KEY`, `JWT_SECRET_KEY`, plus
the Postgres/Redis/RabbitMQ URLs docker-compose.yml expects — see `.env.example`.

## Running it

```bash
# backend API (REST + WebSocket)
python -m uvicorn backend.api.main:app --reload

# frontend dev server (separate terminal)
cd frontend && pnpm dev
```

Register an analyst account from the login screen, then trigger a scenario from
New Investigation — the Debate Room shows the 3-round debate live over the
WebSocket as it actually happens, not a simulated animation.

## Tests

```bash
pytest                    # backend - every LLM call is mocked, no API keys needed
cd frontend && npx tsc --noEmit && pnpm build
```

Two things worth knowing:
- `backend/tests/conftest.py`'s `db_session` fixture truncates `raw_logs` between
  tests. Re-run the two ingestion commands above after running the suite to
  restore the real dataset.
- This has occasionally hit real memory pressure on a constrained dev machine
  (`data/verdictchain_network_dataset.csv` is a ~2M-row pool) — if `pytest` fails
  with a `numpy` `_ArrayMemoryError` or pandas `ParserError: out of memory`, that's
  the host, not the code; free up RAM and re-run.

Live (non-mocked) proof of the LLM-calling paths lives in `backend/scripts/
smoke_test_*.py` — run these manually when you want to see a real Groq/Gemini
call, a real 3-agent live debate, or a real WebSocket push, end to end.

## CI

`.github/workflows/ci.yml` runs black/ruff + pytest (with ephemeral Postgres/
Redis/RabbitMQ service containers) on the backend, and `tsc --noEmit` + `vite
build` on the frontend, on every push/PR to `main`.
