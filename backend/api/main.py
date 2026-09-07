"""FastAPI app assembly. Run: uvicorn backend.api.main:app --reload"""

from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware

from backend.api.routes import agents, audit, auth, investigations, response_actions
from backend.api.websocket import investigation_feed

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
app.include_router(investigations.router)
app.include_router(agents.router)
app.include_router(audit.router)
app.include_router(response_actions.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.websocket("/ws/scenarios/{scenario_label}")
async def scenario_feed(websocket: WebSocket, scenario_label: str) -> None:
    """Subscribe BEFORE calling POST /investigations/simulate with the same
    scenario_label - see routes/investigations.py's docstring for why the
    channel is scenario-keyed rather than investigation-id-keyed.
    """
    await investigation_feed(websocket, f"scenario:{scenario_label}")
