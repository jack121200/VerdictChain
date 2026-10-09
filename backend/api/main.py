"""FastAPI app assembly. Run: uvicorn backend.api.main:app --reload"""

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.event_stream import run_event_forwarder
from backend.api.recovery import recover_after_restart
from backend.api.request_logging import REQUEST_ID_HEADER, RequestLoggingMiddleware
from backend.api.routes import (
    agent_ops,
    agents,
    audit,
    auth,
    containment,
    evaluation,
    evidence,
    investigations,
    raw_logs,
    rbac,
    response_actions,
    scenarios,
    settings,
    simulate,
    stats,
    system,
    users,
)
from backend.api.startup_checks import run_startup_checks
from backend.api.ws_investigations import router as ws_investigations_router


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Startup checks first (production aborts on a problem), then one Redis subscriber per API process
    forwards change events to the /ws/events sockets."""
    await run_startup_checks()
    await asyncio.to_thread(recover_after_restart)
    forwarder = asyncio.create_task(run_event_forwarder())
    try:
        yield
    finally:
        forwarder.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await forwarder


app = FastAPI(title="VerdictChain API", lifespan=lifespan)

# Frontend dev server origin - dashboard is a separate origin from this API,
# so CORS is required for the browser to call it at all. Vite's default port
# is 5173, but it auto-increments (5174, 5175, ...) whenever that port is
# already taken, which happens often in practice - a regex matching ANY
# localhost/127.0.0.1 port avoids hardcoding one that silently breaks the
# next time Vite picks a different one. Still origin-restricted to loopback
# only, not "allow everything".
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[REQUEST_ID_HEADER],  # so the dashboard can show the id of a failed request
)
# Added last, so it is the outermost middleware and times everything, CORS included.
app.add_middleware(RequestLoggingMiddleware)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(settings.router)
app.include_router(system.router)
app.include_router(rbac.router)
app.include_router(stats.router)
app.include_router(evidence.router)
app.include_router(raw_logs.router)
app.include_router(evaluation.router)
app.include_router(scenarios.router)
app.include_router(agents.router)
app.include_router(agent_ops.router)
app.include_router(containment.router)
app.include_router(simulate.router)
app.include_router(investigations.router)
app.include_router(audit.router)
app.include_router(response_actions.router)
app.include_router(ws_investigations_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
