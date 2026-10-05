"""Manual 'Simulate scenario' trigger (SKILL-architecture.md Section 4). The debate runs synchronously
inside run_debate, offloaded to a worker thread via run_in_threadpool so the async event loop is
never blocked (SKILL-conventions.md: no blocking calls inside async def).
"""

import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool

from backend.api.auth import get_current_user
from backend.api.rate_limit import client_ip, enforce_rate_limit
from backend.api.schemas import SimulateScenarioRequest
from backend.debate.engine import DebateFailedError, run_debate
from backend.debate.state import primary_agent_for_rows
from backend.pipeline.log_streamer import get_rows_for_scenario

router = APIRouter(prefix="/investigations", tags=["investigations"])


@router.post("/simulate", status_code=status.HTTP_201_CREATED)
async def simulate_scenario(
    payload: SimulateScenarioRequest,
    request: Request,
    username: str = Depends(get_current_user),
) -> dict:
    enforce_rate_limit("simulate", client_ip(request), limit=5, window_seconds=60)

    rows = await run_in_threadpool(get_rows_for_scenario, payload.scenario_label)
    if not rows:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"No rows for scenario {payload.scenario_label!r}"
        )

    primary_agent = primary_agent_for_rows(rows)
    loop = asyncio.get_running_loop()

    try:
        result = await run_in_threadpool(
            _run_debate_with_broadcast,
            primary_agent,
            rows,
            payload.scenario_label,
            payload.max_rows_per_agent,
            loop,
        )
    except DebateFailedError as exc:
        # Both LLM providers exhausted mid-debate (observed live this session -
        # a real, if uncommon, failure mode, not hypothetical). The
        # Investigation is already marked status='error' by run_debate itself;
        # this just gives the client something actionable instead of a bare 500.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Debate could not complete (investigation {exc.investigation_id}): {exc.reason}",
        ) from exc

    return result


def _run_debate_with_broadcast(primary_agent, rows, scenario_label, max_rows_per_agent, loop):
    """investigation_id doesn't exist until run_debate() creates it internally,
    and round 1's first on_update() fires before the caller could ever learn
    that id - so live updates are broadcast on a scenario-keyed channel
    (`scenario:{scenario_label}`), not an investigation-id-keyed one. The
    WebSocket route (ws_investigations.py) subscribes by scenario_label for exactly this
    reason: a client opens the socket BEFORE calling /simulate and starts
    receiving round 1 immediately, rather than racing to learn an id first.
    """
    from backend.api.websocket import manager

    def _on_update(message: dict) -> None:
        asyncio.run_coroutine_threadsafe(manager.broadcast(f"scenario:{scenario_label}", message), loop)

    return run_debate(
        primary_agent,
        rows,
        max_rows_per_agent=max_rows_per_agent,
        scenario_label=scenario_label,
        on_update=_on_update,
    )
