"""WebSocket routes for live debate updates. The legacy scenario-keyed channel stays until the
cleanup step (plan section 3.5). The investigation-keyed channel arrives with W1-D.
"""

from fastapi import APIRouter, WebSocket

from backend.api.websocket import investigation_feed

router = APIRouter()


@router.websocket("/ws/scenarios/{scenario_label}")
async def scenario_feed(websocket: WebSocket, scenario_label: str) -> None:
    """Subscribe BEFORE calling POST /investigations/simulate with the same scenario_label.
    See routes/simulate.py for why the channel is scenario-keyed rather than investigation-id-keyed.
    """
    await investigation_feed(websocket, f"scenario:{scenario_label}")
