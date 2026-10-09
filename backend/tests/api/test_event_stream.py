"""Realtime push for every screen: change events after audited commits, and the /ws/events socket.

The end-to-end test runs the real app lifespan (Redis subscriber), connects a ticketed socket, makes a real
audited change in Postgres, and waits for the event to arrive on the socket. No mocks on that path.
"""

import json
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.ws_tickets import issue_ticket
from backend.db import change_events
from backend.db.audit import append_entry
from backend.db.models import Investigation
from backend.db.session import SessionLocal


def test_action_to_topics_mapping():
    assert "credibility" in change_events.topics_for_action("round_completed")
    assert "actions" in change_events.topics_for_action("verdict_reached")
    assert change_events.topics_for_action("release:lock_account") == change_events.topics_for_action(
        "emergency_containment"
    )
    # an action with no explicit mapping still refreshes the audit view
    assert change_events.topics_for_action("something_new") == ("audit",)


def test_build_event_merges_topics_without_duplicates():
    event = change_events.build_event(["round_completed", "credibility_update"], ["inv-1"])
    assert event["type"] == "changed"
    assert event["topics"].count("credibility") == 1
    assert event["investigation_ids"] == ["inv-1"]
    assert event["actions"] == ["round_completed", "credibility_update"]


def test_publish_change_never_raises_when_redis_is_down(monkeypatch):
    class Broken:
        def publish(self, *_args, **_kwargs):
            raise ConnectionError("redis is down")

    monkeypatch.setattr(change_events, "_redis", lambda: Broken())
    assert change_events.publish_change(["login"]) is False


@pytest.fixture()
def published(monkeypatch):
    """Captures what the commit hook would publish, without touching Redis."""
    calls: list[tuple[list[str], list[str]]] = []
    monkeypatch.setattr(
        change_events, "publish_change", lambda actions, ids=None: calls.append((actions, ids or [])) or True
    )
    return calls


def test_event_is_published_only_after_the_transaction_commits(db_session, published):
    session = SessionLocal()
    try:
        append_entry(session, "tester", "login", {"role": "forensic_analyst"})
        assert published == []  # not before commit: a client that refetches would not see the row yet
        session.commit()
    finally:
        session.close()
    assert published == [(["login"], [])]


def test_no_event_when_the_transaction_rolls_back(db_session, published):
    session = SessionLocal()
    try:
        append_entry(session, "tester", "login", {"role": "forensic_analyst"})
        session.rollback()
        session.commit()
    finally:
        session.close()
    assert published == []


def test_one_event_per_commit_carries_every_action_and_the_investigation(db_session, published):
    session = SessionLocal()
    try:
        inv = Investigation(trigger_type="manual", trigger_reason="t", status="investigating")
        session.add(inv)
        session.flush()
        append_entry(
            session, "debate_engine", "round_completed", {"round": 1}, investigation_id=inv.investigation_id
        )
        append_entry(
            session, "watchdog", "credibility_update", {"round": 1}, investigation_id=inv.investigation_id
        )
        session.commit()
        inv_id = str(inv.investigation_id)
    finally:
        session.close()
    assert published == [(["round_completed", "credibility_update"], [inv_id])]


def test_events_socket_rejects_a_bad_ticket():
    with TestClient(app) as client:
        with client.websocket_connect("/ws/events?ticket=nope") as socket:
            with pytest.raises(Exception) as closed:
                socket.receive_json()
            assert "4401" in str(closed.value) or getattr(closed.value, "code", None) == 4401


def _receive_changed(socket, wanted_action: str, timeout_s: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        message = socket.receive_json()
        if message.get("type") == "changed" and wanted_action in message.get("actions", []):
            return message
    raise AssertionError(f"no 'changed' event for {wanted_action!r} within {timeout_s}s")


def test_a_committed_audit_change_reaches_a_connected_socket_end_to_end(db_session):
    """Real Postgres commit -> Redis publish -> app forwarder -> WebSocket. Nothing mocked."""
    marker = f"e2e-{uuid.uuid4().hex[:8]}"
    with TestClient(app) as client:  # runs the lifespan, which starts the Redis subscriber
        ticket = issue_ticket("tester")
        with client.websocket_connect(f"/ws/events?ticket={ticket}") as socket:
            assert socket.receive_json()["type"] == "hello"
            time.sleep(0.5)  # let the subscriber finish SUBSCRIBE before we publish

            session = SessionLocal()
            try:
                append_entry(session, marker, "login", {"role": "forensic_analyst"})
                session.commit()
            finally:
                session.close()

            message = _receive_changed(socket, "login")
    assert "audit" in message["topics"]
    assert "at" in message
    # the channel carries topics and ids only, never row data
    assert marker not in json.dumps(message)
