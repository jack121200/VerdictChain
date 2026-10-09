"""Live debate/credibility updates over WebSocket - CLAUDE.md's real-time requirement, driven by
backend.debate.engine.run_debate's on_update callback (one push per round per agent, plus a final verdict
push), not polling.

A channel is registered before its snapshot is built, so no live frame can fall between the snapshot and
the subscription. Clients dedupe on type + round + agent_id, which covers a frame that lands in both.
"""

import asyncio
import json
import logging
import uuid
from collections.abc import Callable

from fastapi import WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from backend.api.schemas.realtime import (
    SnapshotActionOut,
    SnapshotAgentOut,
    SnapshotCredibilityOut,
    SnapshotFrame,
    SnapshotRoundOut,
    SnapshotVerdictOut,
)
from backend.db.models import CredibilityLog, DebateTranscript, Investigation, ResponseAction
from backend.db.session import SessionLocal

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Per-key subscriber list. In-process only (single FastAPI worker) - fine for the dev/demo deployment
    shape (SKILL-architecture.md Section 10); a multi-worker deployment would need Redis pub/sub instead,
    flagged here rather than built speculatively.
    """

    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}

    def register(self, key: str, websocket: WebSocket) -> None:
        """Subscribes an already-accepted socket."""
        self._connections.setdefault(key, []).append(websocket)

    def disconnect(self, key: str, websocket: WebSocket) -> None:
        conns = self._connections.get(key, [])
        if websocket in conns:
            conns.remove(websocket)

    async def broadcast(self, key: str, message: dict) -> None:
        for ws in list(self._connections.get(key, [])):
            try:
                await ws.send_text(json.dumps(message, default=str))
            except Exception:  # noqa: BLE001 - a dead socket must never break the broadcast for others
                logger.warning("dropping dead websocket for channel %s", key)
                self.disconnect(key, ws)


manager = ConnectionManager()


def investigation_key(investigation_id: str) -> str:
    return f"investigation:{investigation_id}"


def make_debate_broadcaster(investigation_id: str, loop: asyncio.AbstractEventLoop) -> Callable[[dict], None]:
    """run_debate() calls the returned function from a worker thread. Each frame gets investigation_id and
    goes to the investigation channel. A failed broadcast never breaks the debate.
    """
    key = investigation_key(investigation_id)

    def _on_update(message: dict) -> None:
        frame = {**message, "investigation_id": investigation_id}
        coro = manager.broadcast(key, frame)
        try:
            asyncio.run_coroutine_threadsafe(coro, loop)
        except RuntimeError:  # the event loop has stopped (for example, the request has ended)
            coro.close()
            logger.warning("no event loop to broadcast %s to", key)

    return _on_update


def build_snapshot(investigation_id: uuid.UUID) -> dict | None:
    """The investigation's state so far, from the database. None if it does not exist."""
    session = SessionLocal()
    try:
        inv = session.get(Investigation, investigation_id)
        if inv is None:
            return None
        transcripts = (
            session.execute(
                select(DebateTranscript)
                .where(DebateTranscript.investigation_id == investigation_id)
                .order_by(DebateTranscript.round, DebateTranscript.agent_id)
            )
            .scalars()
            .all()
        )
        credibility = (
            session.execute(
                select(CredibilityLog)
                .where(CredibilityLog.investigation_id == investigation_id)
                .order_by(CredibilityLog.created_at, CredibilityLog.round)
            )
            .scalars()
            .all()
        )
        actions = (
            session.execute(
                select(ResponseAction)
                .where(ResponseAction.investigation_id == investigation_id)
                .order_by(ResponseAction.created_at)
            )
            .scalars()
            .all()
        )

        rounds: dict[int, list[SnapshotAgentOut]] = {}
        for t in transcripts:
            rounds.setdefault(t.round, []).append(
                SnapshotAgentOut(
                    agent_id=t.agent_id,
                    theory=t.theory,
                    confidence=t.confidence,
                    provider=t.provider,
                    cited_evidence=t.cited_evidence,
                )
            )
        verdict = (
            SnapshotVerdictOut(
                verdict_class=inv.verdict_class,
                verdict_confidence=inv.verdict_confidence,
                status=inv.status,
            )
            if inv.verdict_class is not None
            else None
        )
        frame = SnapshotFrame(
            investigation_id=str(investigation_id),
            status=inv.status,
            rounds=[SnapshotRoundOut(round=r, agents=agents) for r, agents in sorted(rounds.items())],
            credibility=[
                SnapshotCredibilityOut(
                    agent_id=c.agent_id,
                    round=c.round,
                    crs_before=c.crs_before,
                    crs_after=c.crs_after,
                    verification_match_rate=c.verification_match_rate,
                    isolated=bool(c.isolated),
                )
                for c in credibility
            ],
            actions=[
                SnapshotActionOut(
                    action_type=a.action_type, target=a.target, reason=a.reason, is_simulated=a.is_simulated
                )
                for a in actions
            ],
            verdict=verdict,
        )
        return frame.model_dump(mode="json")
    finally:
        session.close()


async def investigation_channel(websocket: WebSocket, investigation_id: uuid.UUID) -> None:
    """Serves one accepted socket: registers it, sends the snapshot, then holds the connection open.
    An unknown investigation closes with 4404.
    """
    key = investigation_key(str(investigation_id))
    manager.register(key, websocket)
    try:
        # Built in a thread, so the event loop (and live broadcasts) keep running meanwhile.
        snapshot = await run_in_threadpool(build_snapshot, investigation_id)
        if snapshot is None:
            await websocket.close(code=4404)
            return
        await websocket.send_json(snapshot)
        while True:
            await websocket.receive_text()  # clients send nothing meaningful; this detects disconnects
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(key, websocket)
