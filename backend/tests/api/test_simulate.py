"""POST /investigations/simulate: status codes in order, the single debate slot (a busy slot queues the
request), the daily caps, the intake pause, the background path and the noise bookkeeping. The debate itself
is replaced by a fake (no LLM). The queue has its own tests in test_debate_queue.py.
"""

import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from backend.api.debate_queue import worker
from backend.api.main import app
from backend.api.rate_limit import DebateSlot, get_redis, slot_holder
from backend.config import settings
from backend.db.models import AuditTrail, Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate.engine import DebateFailedError
from backend.tests.fixtures.auth import auth_headers
from backend.tests.fixtures.debate_queue import wait_until_idle

client = TestClient(app)
SIMULATE = "/investigations/simulate"
T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)


def _clear_debate_state() -> None:
    redis_client = get_redis()
    redis_client.delete("verdictchain:debate:slot")
    for key in redis_client.scan_iter("verdictchain:cap:*"):
        redis_client.delete(key)


@pytest.fixture(autouse=True)
def _debate_state_is_clean():
    _clear_debate_state()
    yield
    _clear_debate_state()


def _row(index: int, label: str, *, event_type: str = "network_flow", source: str = "cicids2017") -> RawLog:
    return RawLog(
        timestamp=T0 + timedelta(seconds=index),
        source=source,
        event_type=event_type,
        host_id="10.0.0.5",
        raw_fields={"Destination Port": 445},
        ground_truth_label=label,
    )


def _seed_scenario(db_session, n: int = 5, label: str = "DDoS") -> None:
    db_session.add_all([_row(i, label) for i in range(n)])
    db_session.commit()


def _seed_benign(db_session, n: int) -> None:
    db_session.add_all([_row(100 + i, "BENIGN") for i in range(n)])
    db_session.commit()


def _fake_result(investigation_id) -> dict:
    return {
        "investigation_id": str(investigation_id),
        "status": "verdict_reached",
        "verdict": {"verdict_class": "ddos", "verdict_confidence": 0.9, "status": "verdict_reached"},
        "providers_used": {},
        "actions_taken": [],
    }


def _quick_debate(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
    return _fake_result(investigation_id)


def _wait_until_slot_free() -> None:
    wait_until_idle()


def test_unauthenticated_request_is_rejected(db_session):
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"})
    assert resp.status_code == 401


def test_every_analyst_role_may_inject_a_scenario(db_session, monkeypatch):
    _seed_scenario(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("red_team_auditor"))
    assert resp.status_code == 201


def test_wait_true_runs_inline_and_returns_the_verdict(db_session, monkeypatch):
    _seed_scenario(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 201
    body = resp.json()
    assert body["verdict"]["verdict_class"] == "ddos"
    assert body["status"] == "verdict_reached"
    session = SessionLocal()
    try:
        inv = session.get(Investigation, uuid.UUID(body["investigation_id"]))
        assert inv is not None  # start_investigation created the row before the debate ran
        assert inv.primary_agent == "network_traffic"
        assert inv.scenario_label == "DDoS"
    finally:
        session.close()
    _wait_until_slot_free()


def test_wait_false_returns_202_with_the_id_before_the_debate_finishes(db_session, monkeypatch):
    _seed_scenario(db_session)
    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    seen: dict = {}

    def slow_debate(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        seen["investigation_id"] = investigation_id
        started.set()
        release.wait(timeout=10)
        finished.set()
        return _fake_result(investigation_id)

    monkeypatch.setattr("backend.api.debate_queue.run_debate", slow_debate)
    resp = client.post(
        SIMULATE, json={"scenario_label": "DDoS", "wait": False}, headers=auth_headers("forensic_analyst")
    )
    assert resp.status_code == 202
    body = resp.json()
    assert started.wait(timeout=5), "the background debate never started"
    assert not finished.is_set(), "the response came back only after the debate had finished"
    assert body["investigation_id"] == str(seen["investigation_id"])
    assert body["ws_path"] == f"/ws/investigations/{body['investigation_id']}"
    assert body["primary_agent"] == "network_traffic"
    assert body["status"] in ("queued", "investigating")  # the worker may already have taken it
    assert slot_holder() == body["investigation_id"]  # the slot is bound to the running investigation
    release.set()
    assert finished.wait(timeout=5)
    _wait_until_slot_free()


def test_a_held_slot_queues_the_request_and_it_runs_when_the_slot_is_free(db_session, monkeypatch):
    _seed_scenario(db_session)
    ran = threading.Event()

    def record(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        ran.set()
        return _fake_result(investigation_id)

    monkeypatch.setattr("backend.api.debate_queue.run_debate", record)
    running = str(uuid.uuid4())
    slot = DebateSlot()
    assert slot.acquire()
    slot.bind(running)
    try:
        resp = client.post(
            SIMULATE,
            json={"scenario_label": "DDoS", "wait": False},
            headers=auth_headers("forensic_analyst"),
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "queued"
        assert (body["queue_position"], body["queue_length"]) == (1, 1)
        assert not ran.wait(timeout=0.5), "the debate ran while another one held the slot"
    finally:
        slot.release()
    worker.notify()
    assert ran.wait(timeout=5), "the queued debate never started after the slot was freed"
    _wait_until_slot_free()


def test_intake_paused_returns_423_and_creates_nothing(db_session, monkeypatch):
    _seed_scenario(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    db_session.execute(text("UPDATE runtime_settings SET intake_paused = true WHERE id = 1"))
    db_session.commit()
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 423
    check = SessionLocal()
    try:
        assert check.query(Investigation).count() == 0
    finally:
        check.close()


def test_the_per_analyst_daily_cap_returns_429(db_session, monkeypatch):
    _seed_scenario(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    monkeypatch.setattr(settings, "debate_daily_limit_user", 1)
    headers = auth_headers("forensic_analyst")
    assert client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=headers).status_code == 201
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=headers)
    assert resp.status_code == 429
    assert "this analyst" in resp.json()["detail"]
    _wait_until_slot_free()


def test_the_global_daily_cap_returns_429_for_every_analyst(db_session, monkeypatch):
    _seed_scenario(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    monkeypatch.setattr(settings, "debate_daily_limit_global", 1)
    first = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    second = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("secops_lead"))
    assert first.status_code == 201
    assert second.status_code == 429
    assert "all analysts" in second.json()["detail"]
    _wait_until_slot_free()


def test_a_refused_cap_does_not_leave_the_slot_held(db_session, monkeypatch):
    _seed_scenario(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    monkeypatch.setattr(settings, "debate_daily_limit_user", 0)
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 429
    assert slot_holder() is None


def test_rows_that_map_to_no_agent_return_422(db_session, monkeypatch):
    db_session.add_all([_row(i, "DDoS", event_type="unmapped_event") for i in range(3)])
    db_session.commit()
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 422
    assert slot_holder() is None


def test_no_rows_for_the_scenario_returns_404(db_session, monkeypatch):
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 404


def test_the_rate_limit_of_five_per_minute_still_applies(db_session):
    headers = auth_headers("forensic_analyst")
    codes = [
        client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=headers).status_code for _ in range(6)
    ]
    assert codes[:5] == [404] * 5  # no rows seeded: refused after the rate limit, before the slot
    assert codes[5] == 429


def test_noise_is_recorded_on_the_investigation_and_in_its_audit_entry(db_session, monkeypatch):
    _seed_scenario(db_session, n=10)
    _seed_benign(db_session, n=10)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _quick_debate)
    resp = client.post(
        SIMULATE,
        json={"scenario_label": "DDoS", "noise_pct": 30, "max_rows_per_agent": 5, "wait": False},
        headers=auth_headers("forensic_analyst"),
    )
    assert resp.status_code == 202
    body = resp.json()
    # The window is 5 rows: round(5 * 30 / 100) = 2 dropped, so 40 % effective.
    assert body["noise_pct"] == 30
    assert body["effective_noise_pct"] == 40.0
    _wait_until_slot_free()

    session = SessionLocal()
    try:
        inv = session.get(Investigation, uuid.UUID(body["investigation_id"]))
        assert inv.noise_pct == 30
        assert inv.effective_noise_pct == 40.0
        started = session.execute(
            select(AuditTrail).where(
                AuditTrail.investigation_id == inv.investigation_id,
                AuditTrail.action == "investigation_started",
            )
        ).scalar_one()
        assert started.detail["noise_pct"] == 30
        assert started.detail["effective_noise_pct"] == 40.0
        assert len(started.detail["injected_row_ids"]) == 2
        assert set(started.detail["settings"]) == {
            "eta",
            "isolation_threshold",
            "verdict_confidence_threshold",
        }
        assert "scenario_label" not in started.detail
        assert "DDoS" not in str(started.detail)
    finally:
        session.close()


def test_a_failed_debate_returns_502_and_releases_the_slot(db_session, monkeypatch):
    _seed_scenario(db_session)

    def failing(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        raise DebateFailedError(str(investigation_id), "all providers exhausted")

    monkeypatch.setattr("backend.api.debate_queue.run_debate", failing)
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 502
    assert "all providers exhausted" in resp.json()["detail"]
    assert slot_holder() is None


@pytest.mark.parametrize(
    "extra",
    [
        {"noise_pct": 10},
        {"noise_pct": 45},
        {"max_rows_per_agent": 0},
        {"max_rows_per_agent": 16},
        {"wait": "maybe"},
        {"is_simulated": False},
    ],
)
def test_invalid_simulate_bodies_return_422(db_session, extra):
    body = {"scenario_label": "DDoS", **extra}
    resp = client.post(SIMULATE, json=body, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 422


def test_the_defaults_are_wait_true_no_noise_and_five_rows(db_session, monkeypatch):
    _seed_scenario(db_session)
    seen: dict = {}

    def capture(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        seen["max_rows"] = max_rows_per_agent
        return _fake_result(investigation_id)

    monkeypatch.setattr("backend.api.debate_queue.run_debate", capture)
    resp = client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 201  # wait defaults to true
    assert seen["max_rows"] == 5
    assert resp.json()["verdict"]["verdict_class"] == "ddos"


def test_the_debate_slot_is_one_redis_key(db_session):
    assert DebateSlot().acquire()
    assert get_redis().get("verdictchain:debate:slot") is not None
    assert not DebateSlot().acquire()  # a second holder is refused while the first holds the key
    _clear_debate_state()
