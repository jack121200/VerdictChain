"""WebSocket routes for live debate updates (plan section 3.5). Both channels take a single-use ticket from
POST /auth/ws-ticket. (The legacy unauthenticated /ws/scenarios/{label} channel was removed: BE7.)
"""

import uuid

from fastapi import APIRouter, Depends, WebSocket
from fastapi.concurrency import run_in_threadpool

from backend.api.auth import get_current_user
from backend.api.event_stream import event_channel
from backend.api.schemas.realtime import WsTicketOut
from backend.api.websocket import investigation_channel
from backend.api.ws_tickets import TICKET_TTL_SECONDS, consume_ticket, issue_ticket

WS_CLOSE_UNAUTHORIZED = 4401
WS_CLOSE_NOT_FOUND = 4404

router = APIRouter()


@router.post("/auth/ws-ticket", response_model=WsTicketOut, tags=["auth"])
def create_ws_ticket(username: str = Depends(get_current_user)) -> WsTicketOut:
    """A single-use ticket for one WebSocket connection, valid for 30 seconds."""
    return WsTicketOut(ticket=issue_ticket(username), expires_in=TICKET_TTL_SECONDS)


@router.websocket("/ws/investigations/{investigation_id}")
async def investigation_socket(
    websocket: WebSocket, investigation_id: str, ticket: str | None = None
) -> None:
    """Live frames for one investigation: a snapshot first, then each round and verdict as it happens.
    A missing or bad ticket closes with 4401. The socket is accepted first, so the client sees the close
    code (a close before accept would only show as an HTTP rejection).
    """
    await websocket.accept()
    username = await run_in_threadpool(consume_ticket, ticket)
    if username is None:
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return
    try:
        parsed_id = uuid.UUID(investigation_id)
    except ValueError:
        await websocket.close(code=WS_CLOSE_NOT_FOUND)
        return
    await investigation_channel(websocket, parsed_id)


@router.websocket("/ws/events")
async def events_socket(websocket: WebSocket, ticket: str | None = None) -> None:
    """Push channel for every screen: one small "changed" event per committed audited change, carrying
    topic names only. The browser refetches through the normal REST endpoints. Same single-use ticket as
    the investigation socket; a missing or bad ticket closes with 4401.
    """
    await websocket.accept()
    username = await run_in_threadpool(consume_ticket, ticket)
    if username is None:
        await websocket.close(code=WS_CLOSE_UNAUTHORIZED)
        return
    await event_channel(websocket)
