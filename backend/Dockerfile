# VerdictChain API image (FastAPI + uvicorn).
# Build context is the repository root:  docker compose --profile app build backend
#                                  or:  docker build -f backend/Dockerfile -t verdictchain-backend .
# No secret is baked in: .env is excluded by .dockerignore and every setting arrives as an environment
# variable at run time (docker-compose.yml).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Dependencies first, so a code change does not reinstall them.
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend backend

RUN useradd --system --uid 10001 --no-create-home verdictchain
USER verdictchain

EXPOSE 8000

# alembic.ini lives in backend/ (its script_location is relative to it), so migrate from there. uvicorn then
# runs from /app so that `backend.api.main` imports. One worker: the per-investigation WebSocket
# ConnectionManager (backend/api/websocket.py) is in-process.
CMD ["sh", "-c", "cd backend && python -m alembic upgrade head && cd .. && exec uvicorn backend.api.main:app --host 0.0.0.0 --port 8000"]
