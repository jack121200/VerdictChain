"""WebSocket tickets and the investigation channel: ticket flow, close codes 4401 and 4404, snapshot as the
first frame, and every live frame carrying its investigation id.
"""

import asyncio
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import backend.api.websocket as websocket_module
from backend.api.main import app
from backend.api.rate_limit import DEBATE_SLOT_KEY, get_redis, slot_holder
from backend.api.websocket import investigation_key, make_debate_broadcaster
from backend.api.ws_tickets import TICKET_TTL_SECONDS, consume_ticket, issue_ticket
from backend.db.models import CredibilityLog, DebateTranscript, Investigation, RawLog, ResponseAction
from backend.db.session import SessionLocal
from backend.tests.fixtures.auth import auth_headers

T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _ws_state_is_clean():
    redis_client = get_redis()
    for key in redis_client.scan_iter("verdictchain:wsticket:*"):
        redis_client.delete(key)
    redis_client.delete(DEBATE_SLOT_KEY)
    for key in redis_client.scan_iter("verdictchain:cap:*"):
        redis_client.delete(key)
    yield


def _investigation(db_session, *, with_verdict: bool) -> uuid.UUID:
    session = SessionLocal()
    try:
        inv = Investigation(
            trigger_type="manual",
            status="verdict_reached" if with_verdict else "investigating",
            verdict_class="ddos" if with_verdict else None,
            verdict_confidence=0.9 if with_verdict else None,
        )
        session.add(inv)
        session.commit()
        session.refresh(inv)
        return inv.investigation_id
    finally:
        session.close()


def test_ws_ticket_route_returns_a_ticket_and_the_30_second_ttl(db_session):
    headers = auth_headers("forensic_analyst")
    resp = TestClient(app).post("/auth/ws-ticket", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["expires_in"] == TICKET_TTL_SECONDS == 30
    assert len(body["ticket"]) >= 32
    ttl = get_redis().ttl(f"verdictchain:wsticket:{body['ticket']}")
    assert 0 < ttl <= 30


def test_ws_ticket_route_requires_authentication(db_session):
    resp = TestClient(app).post("/auth/ws-ticket")
    assert resp.status_code == 401


def test_a_ticket_is_single_use(db_session):
    ticket = issue_ticket("alice")
    assert consume_ticket(ticket) == "alice"
    assert consume_ticket(ticket) is None


def test_a_missing_or_unknown_ticket_consumes_to_none(db_session):
    assert consume_ticket(None) is None
    assert consume_ticket("") is None
    assert consume_ticket("never-issued") is None


def test_bad_ticket_closes_with_4401(db_session):
    investigation_id = uuid.uuid4()
    with pytest.raises(WebSocketDisconnect) as exc:
        with TestClient(app).websocket_connect(f"/ws/investigations/{investigation_id}?ticket=bogus") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_missing_ticket_closes_with_4401(db_session):
    with pytest.raises(WebSocketDisconnect) as exc:
        with TestClient(app).websocket_connect(f"/ws/investigations/{uuid.uuid4()}") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_a_ticket_cannot_be_reused_for_a_second_connection(db_session):
    investigation_id = _investigation(db_session, with_verdict=False)
    ticket = issue_ticket("alice")
    client = TestClient(app)
    with client.websocket_connect(f"/ws/investigations/{investigation_id}?ticket={ticket}") as ws:
        assert ws.receive_json()["type"] == "snapshot"
    with pytest.raises(WebSocketDisconnect) as exc:
        with client.websocket_connect(f"/ws/investigations/{investigation_id}?ticket={ticket}") as ws:
            ws.receive_json()
    assert exc.value.code == 4401


def test_an_unknown_investigation_closes_with_4404(db_session):
    ticket = issue_ticket("alice")
    with pytest.raises(WebSocketDisconnect) as exc:
        with TestClient(app).websocket_connect(f"/ws/investigations/{uuid.uuid4()}?ticket={ticket}") as ws:
            ws.receive_json()
    assert exc.value.code == 4404


def test_a_malformed_investigation_id_closes_with_4404(db_session):
    ticket = issue_ticket("alice")
    with pytest.raises(WebSocketDisconnect) as exc:
        with TestClient(app).websocket_connect(f"/ws/investigations/not-a-uuid?ticket={ticket}") as ws:
            ws.receive_json()
    assert exc.value.code == 4404


def test_the_first_frame_is_a_snapshot_built_from_the_database(db_session):
    investigation_id = _investigation(db_session, with_verdict=True)
    session = SessionLocal()
    try:
        session.add(
            DebateTranscript(
                investigation_id=investigation_id,
                round=1,
                agent_id="network_traffic",
                theory="ddos flood",
                confidence=0.9,
                cited_evidence=[
                    {"row_id": str(uuid.uuid4()), "field": "event_type", "value": "network_flow"}
                ],
                provider="openai",
                stance="SUPPORT",
            )
        )
        session.add(
            CredibilityLog(
                investigation_id=investigation_id,
                agent_id="network_traffic",
                round=1,
                crs_before=0.5,
                crs_after=0.4,
                verification_match_rate=0.0,
                isolated=False,
            )
        )
        session.add(
            ResponseAction(
                investigation_id=investigation_id,
                action_type="trigger_audit",
                target="10.0.0.5",
                reason="audit",
                is_simulated=True,
            )
        )
        session.commit()
    finally:
        session.close()

    ticket = issue_ticket("alice")
    with TestClient(app).websocket_connect(f"/ws/investigations/{investigation_id}?ticket={ticket}") as ws:
        frame = ws.receive_json()

    assert frame["type"] == "snapshot"
    assert frame["investigation_id"] == str(investigation_id)
    assert frame["status"] == "verdict_reached"
    assert frame["rounds"][0]["round"] == 1
    assert frame["rounds"][0]["agents"][0] == {
        "agent_id": "network_traffic",
        "theory": "ddos flood",
        "confidence": 0.9,
        "provider": "openai",
        "cited_evidence": frame["rounds"][0]["agents"][0]["cited_evidence"],
        "stance": "SUPPORT",  # the stored stance, so a screen opened mid-debate shows it too
    }
    assert frame["credibility"][0]["crs_after"] == 0.4
    assert frame["actions"][0] == {
        "action_type": "trigger_audit",
        "target": "10.0.0.5",
        "reason": "audit",
        "is_simulated": True,
    }
    assert frame["verdict"] == {
        "verdict_class": "ddos",
        "verdict_confidence": 0.9,
        "status": "verdict_reached",
    }


def test_a_running_investigation_snapshot_has_no_verdict(db_session):
    investigation_id = _investigation(db_session, with_verdict=False)
    ticket = issue_ticket("alice")
    with TestClient(app).websocket_connect(f"/ws/investigations/{investigation_id}?ticket={ticket}") as ws:
        frame = ws.receive_json()
    assert frame["status"] == "investigating"
    assert frame["rounds"] == [] and frame["credibility"] == [] and frame["actions"] == []
    assert frame["verdict"] is None


@pytest.fixture()
def event_loop_thread():
    """A real event loop on its own thread, as the uvicorn loop is for the debate's worker thread."""
    loop = asyncio.new_event_loop()
    thread = threading.Thread(target=loop.run_forever, daemon=True)
    thread.start()
    yield loop
    loop.call_soon_threadsafe(loop.stop)
    thread.join(timeout=5)
    loop.close()


def test_the_broadcaster_tags_every_frame_and_feeds_the_investigation_channel_only(
    monkeypatch, event_loop_thread
):
    sent: list[tuple[str, dict]] = []

    async def record(key, message):
        sent.append((key, message))

    monkeypatch.setattr(websocket_module.manager, "broadcast", record)
    on_update = make_debate_broadcaster("inv-1", event_loop_thread)
    on_update({"type": "round_completed", "round": 1, "agents": []})

    deadline = time.monotonic() + 5
    while not sent and time.monotonic() < deadline:
        time.sleep(0.01)
    time.sleep(0.1)  # a second, wrongly keyed frame would arrive in this window
    assert [key for key, _ in sent] == [investigation_key("inv-1")]  # no scenario-keyed channel any more
    assert all(message["investigation_id"] == "inv-1" for _, message in sent)
    assert all(message["type"] == "round_completed" for _, message in sent)


def test_a_stopped_event_loop_never_breaks_the_debate(monkeypatch):
    loop = asyncio.new_event_loop()
    loop.close()  # the request that owned this loop has ended
    on_update = make_debate_broadcaster("inv-2", loop)
    on_update({"type": "verdict", "verdict": {}, "actions_taken": []})  # must not raise


def _seed_scenario(db_session, n: int = 5) -> None:
    db_session.add_all(
        [
            RawLog(
                timestamp=T0 + timedelta(seconds=i),
                source="cicids2017",
                event_type="network_flow",
                host_id="10.0.0.5",
                raw_fields={"Destination Port": 445},
                ground_truth_label="DDoS",
            )
            for i in range(n)
        ]
    )
    db_session.commit()


def test_live_frames_reach_the_socket_and_each_carries_the_investigation_id(db_session, monkeypatch):
    """The real route, the real start_investigation and the real broadcaster. Only the debate's own
    rounds are replaced by a fake that emits two frames on demand.
    """
    _seed_scenario(db_session)
    can_emit = threading.Event()
    finished = threading.Event()

    def fake_debate(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        can_emit.wait(timeout=10)
        on_update({"type": "round_completed", "round": 1, "agents": [{"agent_id": "network_traffic"}]})
        on_update({"type": "verdict", "verdict": {"verdict_class": "ddos"}, "actions_taken": []})
        finished.set()
        return {"investigation_id": str(investigation_id), "verdict": {"verdict_class": "ddos"}}

    monkeypatch.setattr("backend.api.debate_queue.run_debate", fake_debate)

    headers = auth_headers("forensic_analyst")
    with TestClient(app) as client:
        resp = client.post(
            "/investigations/simulate",
            json={"scenario_label": "DDoS", "wait": False},
            headers=headers,
        )
        assert resp.status_code == 202
        investigation_id = resp.json()["investigation_id"]
        ticket = client.post("/auth/ws-ticket", headers=headers).json()["ticket"]

        with client.websocket_connect(f"/ws/investigations/{investigation_id}?ticket={ticket}") as ws:
            snapshot = ws.receive_json()
            assert snapshot["type"] == "snapshot"  # first, before any live frame
            assert snapshot["investigation_id"] == investigation_id
            can_emit.set()
            round_frame = ws.receive_json()
            verdict_frame = ws.receive_json()

    assert finished.wait(timeout=5)
    assert round_frame["type"] == "round_completed" and round_frame["round"] == 1
    assert verdict_frame["type"] == "verdict"
    for frame in (snapshot, round_frame, verdict_frame):
        assert frame["investigation_id"] == investigation_id

    deadline = time.monotonic() + 5
    while slot_holder() is not None and time.monotonic() < deadline:
        time.sleep(0.02)
    assert slot_holder() is None
