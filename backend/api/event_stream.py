"""Forwards change events from Redis to every connected /ws/events socket (plan: realtime on every page).

backend/db/change_events.py publishes a small "changed" event after any audited transaction commits. This
module runs one subscriber task per API process (started in the app lifespan) and broadcasts each event to
the sockets registered on the global channel. With Redis in the middle, two API workers each receive every
event and each serves its own sockets, so no connection is missed.
"""

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator

import redis.asyncio as aioredis
from fastapi import WebSocket, WebSocketDisconnect

from backend.api.websocket import ConnectionManager, manager
from backend.config import settings
from backend.db.change_events import CHANNEL

logger = logging.getLogger(__name__)

GLOBAL_KEY = "events:global"
RETRY_SECONDS = 2.0


async def _messages(url: str) -> AsyncIterator[dict]:
    """Yields decoded events from the Redis channel until the connection drops."""
    client = aioredis.from_url(url)
    pubsub = client.pubsub()
    try:
        await pubsub.subscribe(CHANNEL)
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            try:
                yield json.loads(message["data"])
            except (ValueError, TypeError):
                logger.warning("ignoring an unreadable change event")
    finally:
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe(CHANNEL)
            await pubsub.aclose()
            await client.aclose()


async def run_event_forwarder(
    connections: ConnectionManager = manager, url: str | None = None, retry_seconds: float = RETRY_SECONDS
) -> None:
    """Runs until cancelled. If Redis drops, waits and resubscribes: clients keep their sockets and the
    polling fallback in the browser covers the gap.
    """
    target = url or settings.redis_url
    while True:
        try:
            async for event in _messages(target):
                await connections.broadcast(GLOBAL_KEY, event)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 - keep forwarding after a Redis hiccup
            logger.warning("event forwarder lost Redis, retrying in %.1fs", retry_seconds, exc_info=True)
        await asyncio.sleep(retry_seconds)


async def event_channel(websocket: WebSocket, connections: ConnectionManager = manager) -> None:
    """Serves one accepted, ticket-checked socket: registers it, says hello, then holds it open."""
    connections.register(GLOBAL_KEY, websocket)
    try:
        await websocket.send_json({"type": "hello", "topics": []})
        while True:
            await websocket.receive_text()  # clients send nothing meaningful; this detects disconnects
    except WebSocketDisconnect:
        pass
    finally:
        connections.disconnect(GLOBAL_KEY, websocket)
