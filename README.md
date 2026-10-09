# VerdictChain

A multi-agent forensics console for insider threats and network intrusions.

- **Three investigator agents** (Network-Traffic, Access-Log, Endpoint-Behavior) each read a different slice of
  the logs (CICIDS2017 network flows, CERT r4.2 file / logon / device events) and never see which scenario was
  injected. The blind test is enforced in code and covered by tests.
- **A 3-round debate** (state a theory, challenge or support, final position), run as a LangGraph state graph in
  which the investigators of a round answer in parallel. The verdict is a deterministic function of the final
  positions, not another LLM call.
- **A Watchdog** checks every cited log row against Postgres and keeps a credibility score per agent
  (`CrS_new = clamp(CrS_old * (1 + eta * (2 * match_rate - 1)), 0, 1)`, `eta` default 0.20). An agent whose score
  falls below the isolation threshold (default 0.30) is quarantined.
- **A Self-Healing agent** runs containment only when the verdict is confident and every contributing agent is
  credible. Every action is simulated: it writes a `response_actions` row, and the database refuses a row whose
  `is_simulated` is false.
- **An audit trail** with a SHA-256 hash chain (`prev_hash` / `entry_hash`), checked by `POST /audit-trail/verify`,
  and a **live React console** that updates over WebSockets.

`CLAUDE.md` and `.claude/skills/*.md` are the source of truth for architecture, agent prompts, schema, security
and design. This file only says how to run things. Open work is tracked in `CHECKLIST.md`.

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Docker + Docker Compose v2 | any recent | Postgres 16, Redis 7, RabbitMQ 3.13, and the optional app containers |
| Python | **3.12 or newer** | the code uses PEP 695 syntax (`def f[T](...)`), so 3.11 fails at import. CI pins 3.12 |
| Node + pnpm | Node 22, pnpm 12 (via `corepack enable`) | the frontend. CI and the frontend image pin pnpm 12.3.4 |
| Groq and Gemini API keys | optional | only for runs that call real models. The offline stub below needs none |

## Setup

```bash
cp .env.example .env              # then edit it: passwords, JWT_SECRET_KEY, BOOTSTRAP_LEAD_*, API keys if you have them
docker compose up -d              # Postgres (host port 5433), Redis (6379), RabbitMQ (5672, UI on 15672), loopback only

python -m venv .venv
source .venv/bin/activate         # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r backend/requirements.txt
pip install pandas==3.0.1         # needed by the ingestion pipeline; not listed in requirements.txt yet (see Known limits)

cd backend && python -m alembic upgrade head && cd ..   # alembic.ini lives in backend/, so migrate from there
```

Keep the passwords in `.env` consistent: `POSTGRES_PASSWORD` must match the one inside `LOCAL_DATABASE_URL` and
`TEST_DATABASE_URL`, `RABBITMQ_PASSWORD` the one inside `RABBITMQ_URL`. Postgres reads `POSTGRES_PASSWORD` only
when it first creates its volume.

### Load the datasets (needed for real scenario runs and for seeding)

The datasets are not in git. Put them here first:

```
data/raw_data/monday_plus.csv, tuesday_plus1.csv, wednesday_plus.csv, thursday_plus.csv, friday.csv   CICIDS2017 flows
data/raw_data/insider_raw_data/logon.csv, device.csv, file.csv, LDAP/                                 CERT r4.2
data/raw_data/insider_raw_data/answers_extracted/answers/        the extracted answers.tar.bz2 (ground truth, evaluation only)
```

```bash
python data/clean_merge_cicids.py          # from the repo root; skip if data/verdictchain_network_dataset.csv exists
python -m backend.pipeline.ingestion       # curated CICIDS2017 subset -> data/processed -> raw_logs
python -m backend.pipeline.cert_ingestion  # per-user-per-day CERT features -> data/processed -> raw_logs
```

Both ingestion commands can be re-run: each replaces only its own `source` rows in `raw_logs`.

## Run it

### The API

```bash
# real models (needs GROQ_API_KEY and GEMINI_API_KEY in .env; uses provider quota)
python -m uvicorn backend.api.main:app --reload --port 8000

# offline stub: the same API and the same agents, debate engine and Watchdog, with the two provider clients
# replaced by a deterministic stub. No keys, no network, no cost.
python -m backend.scripts.e2e_server --port 8000
python -m backend.scripts.e2e_server --port 8000 --fabricate access_log   # that agent cites wrong values, so the
                                                                          # Watchdog scores it 0 and isolates it
python -m backend.scripts.e2e_server --selftest                           # validate the stub's output, then exit
```

On start-up the API checks `JWT_SECRET_KEY` (set, not a placeholder, at least 32 characters), Postgres, Redis and
that at least one LLM key is set. With `ENVIRONMENT=production` any failure aborts start-up with one message; in
development each failure is logged as a warning and the API starts anyway (the stub has no keys).

The API listens on http://127.0.0.1:8000 (interactive docs at `/docs`, health at `/health`). Everything the stub
produces is labelled `stub-groq` / `stub-gemini` in the provider column, and the stub exposes its call counter at
`/__e2e/stub-calls`. The stub is test tooling: the application has no stub flag.

### Demo data (zero LLM calls)

```bash
python -m backend.scripts.seed_demo                       # one full debate per default scenario, using the stub
python -m backend.scripts.seed_demo --scenarios DDoS Portscan --max-rows 5
python -m backend.scripts.seed_demo --drill access_log    # then a hallucination drill: debates until the Watchdog isolates that agent
```

It needs the datasets loaded, writes to whatever database `LOCAL_DATABASE_URL` points at, and is additive.
Seeded data is stub output: any accuracy computed on it measures the stub, not a model.

### Accounts

- Register on the login screen. New accounts are always `forensic_analyst`.
- The first administrator is created from `.env`: set `BOOTSTRAP_LEAD_USERNAME` and `BOOTSTRAP_LEAD_PASSWORD`,
  then run `python -m backend.scripts.bootstrap_lead`. It creates (or promotes) a `secops_lead`, is idempotent and
  never prints the password. Roles and what each may do are in `backend/api/rbac.py`.

### The frontend

```bash
cd frontend
pnpm install
pnpm dev            # http://localhost:5173 (Vite moves to the next free port if that one is taken)
```

It talks to `VITE_API_BASE`, default `http://127.0.0.1:8000`. The API accepts browser origins on any
`localhost` / `127.0.0.1` port.

### Everything in Docker (one command)

```bash
docker compose --profile app up -d --build      # adds the backend and frontend containers
docker compose --profile app down               # stop them
```

| Service | Address | What it does |
|---|---|---|
| backend | http://127.0.0.1:8000 | `alembic upgrade head`, then uvicorn (one worker) |
| frontend | http://127.0.0.1:5173 | the built console, served with `vite preview` |

Plain `docker compose up -d` still starts only Postgres, Redis and RabbitMQ. The app containers use the
in-network hostnames (`postgres:5432`, `redis:6379`, `rabbitmq:5672`) with the credentials from your `.env`, and
always use the compose Postgres, never `DATABASE_URL` (the backend container runs with `ENVIRONMENT=development`,
so the start-up checks only warn). They publish the same ports as the dev servers, so stop
those first. `VITE_API_BASE` is compiled into the frontend bundle: set it in `.env` and rebuild if the browser
must reach the API somewhere else. Ingestion and seeding still run from the host (the datasets are not in the
image). To create the first lead inside the container:
`docker compose --profile app exec backend python -m backend.scripts.bootstrap_lead`.

## Tests and gates

### Backend

The suite TRUNCATEs every table in its database, so it has its own. Create it once, with the `POSTGRES_USER` from
your `.env`:

```bash
docker compose exec postgres createdb -U verdictchain verdictchain_test
```

`TEST_DATABASE_URL` in `.env` (see `.env.example`) must point at it. The suite refuses to start if that database
is called `verdictchain` or has no `test` in its name. A few tests also delete the rate-limit, daily-cap, debate
slot and credibility keys (`verdictchain:*`) in whichever Redis database `REDIS_URL` names, so give the run a spare
one:

```bash
REDIS_URL=redis://127.0.0.1:6379/1 python -m pytest -q backend/tests          # bash
$env:REDIS_URL = "redis://127.0.0.1:6379/1"; python -m pytest -q backend/tests # PowerShell
```

No test calls a real LLM provider. The suite needs the compose stack up (it pings Redis and RabbitMQ) and applies
the migrations to the test database itself. `backend/tests/db/test_migrations_roundtrip.py` also creates a
scratch database `verdictchain_test_mig_<hex>`, runs upgrade, `downgrade base` and upgrade again, and drops it, so
the test role needs `CREATE DATABASE` (without it that one test skips). Tests that need the datasets skip when
the files are absent. Lint, read-only:

```bash
python -m black --line-length 110 --check backend
python -m ruff check backend --line-length 110
```

`backend/scripts/smoke_test_*_live.py` call the real providers (quota). They are not collected by pytest; run
them by hand if you want a live proof.

### Frontend

```bash
cd frontend
pnpm typecheck          # tsc --noEmit
pnpm build
pnpm check:no-bluff     # the no-bluff scanner (below)
pnpm test               # Vitest
```

Contract check: every endpoint the typed client calls is requested from a running API and the JSON is compared
with the TypeScript type the client declares (and request bodies with the OpenAPI schema). Start an API first
(the stub is enough) and use a throwaway analyst:

```bash
CONTRACT_USER=some_analyst CONTRACT_PASSWORD=... node scripts/contract-check.mjs     # API_BASE defaults to http://127.0.0.1:8000
```

`pnpm e2e` runs Playwright (`frontend/playwright.config.ts`, specs in `frontend/e2e`) against its own isolated
stack: a separate API port with the offline stub, a separate Vite port, its own database and Redis db, so it never
touches the dev servers or the dev database. Install the browser once with
`pnpm exec playwright install chromium`; the details are in the header of `playwright.config.ts`.

### CI

`.github/workflows/ci.yml`, on every push and pull request to `main`:

- **backend**: Postgres, Redis and RabbitMQ service containers, a freshly created `verdictchain_test` database,
  `black --check`, `ruff`, `alembic upgrade head`, then the whole backend suite on Python 3.12.
- **frontend**: `pnpm typecheck`, `pnpm build`, `pnpm check:no-bluff`, `pnpm test`.
- **contract** (after both): Postgres and Redis, migrations, the stub API in the background, a throwaway analyst
  registered through `POST /auth/register`, then `frontend/scripts/contract-check.mjs`. Any mismatch fails the job.
- **e2e** (after backend and frontend): Postgres and Redis, the Playwright browser, then `pnpm e2e` on its own
  stack (stub API on 8100, Vite on 5190, database `verdictchain_test_pw`, Redis db 7). No provider key is set.

## Repository layout

```
CLAUDE.md, .claude/skills/   rules, locked stack and the specs (architecture, prompts, schema, security, design)
CHECKLIST.md                 open work
docker-compose.yml           infra services; backend + frontend under the "app" profile
.env.example                 every setting the app and compose read
backend/
  pipeline/                  dataset ingestion, normalization, noise, log streaming
  agents/                    the three investigators and the Groq / Gemini REST clients
  debate/                    the 3-round debate (LangGraph graph in graph.py, steps in engine.py) and the verdict
  watchdog/                  citation verification, credibility score, fault injection
  self_healing/              sandboxed containment actions
  evaluation/                ground-truth mapping and accuracy metrics (labelled runs only)
  api/                       FastAPI routes, schemas, auth, RBAC, WebSockets
  db/                        SQLAlchemy models, audit chain, Alembic migrations (alembic.ini is in backend/)
  scripts/                   e2e_server (stub), seed_demo, bootstrap_lead, live smoke scripts
  tests/                     pytest suite
frontend/                    React + TypeScript + Vite console (src/, scripts/, e2e/)
data/                        datasets and the CICIDS2017 merge script (the data itself is gitignored)
reference/                   read-only reference export of the approved HUD design (git-ignored, local only)
```

## The no-bluff contract

1. Every value, label, chart point, row and status on screen is an API field, or a browser function of API fields
   whose formula is shown in its Proof popover. Nothing is typed into a component.
2. Live numbers use the `Metric` envelope (`value`, `n`, `as_of`, `source`, `definition`, `reason`). A null value
   shows "—" with its reason; missing data is never shown as 0, and a real 0 is shown as 0.
3. Rates and averages need n >= 1. Agent-reported confidence is not accuracy: accuracy comes only from
   `/evaluation`, and the Brier score only from analyst feedback (null until there is some).
4. No claim without a mechanism, and only real project entities appear in the UI.
5. Every control is a real, RBAC-gated, audited action or it is removed. Enforced by
   `frontend/scripts/no-bluff-check.mjs` and `backend/tests/contract/test_no_bluff_contract.py`.

## Quarantine and restore

An investigator whose credibility falls below the isolation threshold (0.30) after a round is quarantined: it
takes no further part in that debate or its verdict, and it stays out of later debates until an analyst with the
`quarantine_agent` capability restores it (Fleet, "Restore agent", audited as `agent_restored`). Restoring sets
its credibility back to the starting 0.50. It does not recover the old score or erase the history: the credibility
log, the transcript and the `agent_isolated` audit entry stay. An agent between 0.30 and 0.50 still debates and
votes, but its verdict cannot trigger autonomous containment (a human can contain manually).

## Known limits

- **Stub data is not model data.** Output from `e2e_server` and `seed_demo` carries the provider `stub-groq` /
  `stub-gemini`. The console does not yet mark stub investigations, so `/evaluation` accuracy computed on them
  reflects the stub.
- **WebSockets are single-process.** The per-investigation channel (`/ws/investigations/{id}`) lives in an
  in-process `ConnectionManager`, so run one uvicorn worker. Page-change events (`/ws/events`) go through Redis
  pub/sub and do not have this limit.
- **Python.** The code needs 3.12 or newer. CI pins 3.12. Day-to-day development here runs on 3.14.
- **Datasets are not in git.** Without them there are no scenario rows: `/scenarios` reports no primary agent
  and `seed_demo` skips every scenario.
- **`pandas` is missing from `backend/requirements.txt`.** The ingestion modules (and three test modules) import
  it, which is why the setup and CI install it separately.
- **Continuous monitoring is off.** `/system/status` reports `continuous_mode: false`: investigations start from
  the Simulate flow (`POST /investigations/simulate`), not from a background stream.
- **The Docker app profile is a local stack**, not a deployment: no TLS, no reverse proxy, loopback ports only.
