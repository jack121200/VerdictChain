"""Live debate/credibility updates over WebSocket - CLAUDE.md's real-time
requirement, driven by backend.debate.engine.run_debate's on_update callback
(one push per round per agent, plus a final verdict push), not polling.
"""

import asyncio
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Per-investigation subscriber list. In-process only (single FastAPI
    worker) - fine for the dev/demo deployment shape (SKILL-architecture.md
    Section 10); a multi-worker deployment would need Redis pub/sub instead,
    flagged here rather than built speculatively.
    """

    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, investigation_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(investigation_id, []).append(websocket)

    def disconnect(self, investigation_id: str, websocket: WebSocket) -> None:
        conns = self._connections.get(investigation_id, [])
        if websocket in conns:
            conns.remove(websocket)

    async def broadcast(self, investigation_id: str, message: dict) -> None:
        for ws in list(self._connections.get(investigation_id, [])):
            try:
                await ws.send_text(json.dumps(message, default=str))
            except Exception:  # noqa: BLE001 - a dead socket must never break the broadcast for others
                logger.warning("dropping dead websocket for investigation %s", investigation_id)
                self.disconnect(investigation_id, ws)


manager = ConnectionManager()


def make_broadcaster(investigation_id: str, loop: asyncio.AbstractEventLoop):
    """run_debate() runs synchronously in a worker thread (see
    routes/investigations.py) - this bridges its on_update() calls back onto
    the asyncio event loop so broadcast() can actually await the sends.
    """

    def _on_update(message: dict) -> None:
        asyncio.run_coroutine_threadsafe(manager.broadcast(investigation_id, message), loop)

    return _on_update


async def investigation_feed(websocket: WebSocket, investigation_id: str) -> None:
    await manager.connect(investigation_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # clients don't send anything meaningful; just detects disconnects
    except WebSocketDisconnect:
        manager.disconnect(investigation_id, websocket)
