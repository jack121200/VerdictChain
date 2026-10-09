"""Change events: tell connected clients that data changed, so every screen can refresh by push.

How it works. Every state change appends an audit entry (backend/db/audit.py). append_entry() records the
action on the session; once that transaction COMMITS (never before, so a client that refetches sees the new
rows), a hook publishes one small event on a Redis channel. The API process subscribes to that channel and
forwards each event to the connected WebSockets (backend/api/event_stream.py). Redis in the middle means any
process can publish (the API, a debate thread, the seed script) and more than one API worker can serve
sockets.

An event carries only topic names and an investigation id. The client refetches through the normal
authenticated REST endpoints, so the event channel never carries data and cannot leak any.

Publishing never raises: a Redis outage must not break the write that already committed.
"""

import json
import logging
from datetime import datetime, timezone

import redis
from sqlalchemy import event
from sqlalchemy.orm import Session

from backend.config import settings

logger = logging.getLogger(__name__)

CHANNEL = "verdictchain:events"

TOPICS = ("investigations", "stats", "audit", "credibility", "agents", "settings", "users", "actions")

_ALL_ROUND = ("investigations", "credibility", "agents", "stats", "audit")
_CONTAINMENT = ("actions", "investigations", "stats", "audit")

# Which topics an audit action invalidates. Anything not listed still invalidates "audit".
TOPICS_FOR_ACTION: dict[str, tuple[str, ...]] = {
    "investigation_started": ("investigations", "stats", "audit"),
    "round_completed": _ALL_ROUND,
    "credibility_update": _ALL_ROUND,
    "agent_isolated": ("agents", "credibility", "stats", "audit"),
    "agent_restored": ("agents", "credibility", "stats", "audit"),
    "agent_quarantined": ("agents", "credibility", "stats", "audit"),
    "verdict_reached": ("investigations", "stats", "actions", "audit"),
    "analyst_feedback": ("investigations", "stats", "audit"),
    "evidence_bundle_signed": ("investigations", "audit"),
    "emergency_containment": _CONTAINMENT,
    "containment_released": _CONTAINMENT,
    "lock_account": _CONTAINMENT,
    "block_ip_range": _CONTAINMENT,
    "trigger_rate_limiting": _CONTAINMENT,
    "trigger_audit": _CONTAINMENT,
    "settings_changed": ("settings", "stats", "audit"),
    "role_changed": ("users", "audit"),
    "register": ("users", "audit"),
    "login": ("audit",),
    "byzantine_fault_injected": ("agents", "audit"),
}

_client: redis.Redis | None = None


def topics_for_action(action: str) -> tuple[str, ...]:
    """The topics one audit action invalidates. release:* actions count as containment changes."""
    if action.startswith("release:"):
        return _CONTAINMENT
    return TOPICS_FOR_ACTION.get(action, ("audit",))


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.redis_url, socket_timeout=2, socket_connect_timeout=2)
    return _client


def build_event(actions: list[str], investigation_ids: list[str]) -> dict:
    topics: list[str] = []
    for action in actions:
        for topic in topics_for_action(action):
            if topic not in topics:
                topics.append(topic)
    return {
        "type": "changed",
        "topics": topics,
        "investigation_ids": investigation_ids,
        "actions": actions,
        "at": datetime.now(timezone.utc).isoformat(),
    }


def publish_change(actions: list[str], investigation_ids: list[str] | None = None) -> bool:
    """Publishes one change event. Returns False (and logs) if Redis is unreachable; never raises."""
    if not actions:
        return False
    payload = json.dumps(build_event(actions, sorted(set(investigation_ids or []))))
    try:
        _redis().publish(CHANNEL, payload)
        return True
    except Exception:  # noqa: BLE001 - a lost notification must never fail a committed write
        logger.warning("could not publish change event for %s", actions, exc_info=True)
        return False


_SESSION_KEY = "vc_pending_changes"


def note_change(session: Session, action: str, investigation_id: str | None) -> None:
    """Remembers that this session's transaction changed state. Called by append_entry."""
    pending = session.info.setdefault(_SESSION_KEY, {"actions": [], "investigations": []})
    pending["actions"].append(action)
    if investigation_id is not None and investigation_id not in pending["investigations"]:
        pending["investigations"].append(investigation_id)


def _after_commit(session: Session) -> None:
    pending = session.info.pop(_SESSION_KEY, None)
    if pending:
        publish_change(pending["actions"], pending["investigations"])


def _discard(session: Session) -> None:
    session.info.pop(_SESSION_KEY, None)


_installed = False


def install_commit_hook() -> None:
    """Registers the commit and rollback hooks once per process. Safe to call repeatedly."""
    global _installed
    if _installed:
        return
    event.listen(Session, "after_commit", _after_commit)
    event.listen(Session, "after_rollback", _discard)
    _installed = True
