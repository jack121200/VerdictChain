"""FastAPI app assembly. Run: uvicorn backend.api.main:app --reload"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
from backend.api.ws_investigations import router as ws_investigations_router

app = FastAPI(title="VerdictChain API")

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
)

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
