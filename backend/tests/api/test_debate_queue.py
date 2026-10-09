"""The debate queue (checklist SD2, SD4): a request that arrives while a debate runs waits as 'queued' and the
single worker runs the accepted debates oldest first. The debate itself is a fake (no LLM)."""

import json
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from backend.api.debate_queue import build_run_spec, queue_position, worker
from backend.api.main import app
from backend.api.rate_limit import DEBATE_SLOT_KEY, DebateSlot, get_redis
from backend.config import settings
from backend.db.models import AuditTrail, Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate.engine import start_investigation
from backend.tests.fixtures.auth import auth_headers
from backend.tests.fixtures.debate_queue import wait_until_idle
from backend.tests.fixtures.read_seed import bearer_for

client = TestClient(app)
SIMULATE = "/investigations/simulate"
T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)


def _clear() -> None:
    redis_client = get_redis()
    redis_client.delete(DEBATE_SLOT_KEY)
    for pattern in ("verdictchain:cap:*", "verdictchain:ratelimit:simulate:*"):
        for key in redis_client.scan_iter(pattern):
            redis_client.delete(key)


@pytest.fixture(autouse=True)
def _clean_redis_state():
    _clear()
    yield
    _clear()


def _seed(db_session, n: int = 5) -> None:
    db_session.add_all(
        RawLog(
            timestamp=T0 + timedelta(seconds=i),
            source="cicids2017",
            event_type="network_flow",
            host_id="10.0.0.5",
            raw_fields={"Destination Port": 445},
            ground_truth_label="DDoS",
        )
        for i in range(n)
    )
    db_session.commit()


def _result(investigation_id) -> dict:
    return {
        "investigation_id": str(investigation_id),
        "status": "verdict_reached",
        "verdict": {"verdict_class": "ddos", "verdict_confidence": 0.9, "status": "verdict_reached"},
        "providers_used": {},
        "actions_taken": [],
    }


def _post(headers, **extra):
    return client.post(SIMULATE, json={"scenario_label": "DDoS", "wait": False, **extra}, headers=headers)


def _hold_slot() -> DebateSlot:
    slot = DebateSlot()
    assert slot.acquire()
    slot.bind(str(uuid.uuid4()))
    return slot


def _statuses() -> dict[str, str]:
    with SessionLocal() as session:
        return {str(i.investigation_id): i.status for i in session.execute(select(Investigation)).scalars()}


def test_debates_run_one_at_a_time_and_oldest_first(db_session, monkeypatch):
    _seed(db_session)
    order: list[str] = []
    running = threading.Event()
    release = threading.Event()
    overlap: list[int] = []
    active = [0]

    def fake(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        active[0] += 1
        overlap.append(active[0])
        order.append(str(investigation_id))
        running.set()
        release.wait(timeout=10)
        active[0] -= 1
        return _result(investigation_id)

    monkeypatch.setattr("backend.api.debate_queue.run_debate", fake)
    monkeypatch.setattr(settings, "debate_queue_max_per_user", 5)
    headers = auth_headers("forensic_analyst")

    first = _post(headers).json()
    assert running.wait(timeout=5)  # the first one runs and blocks
    second = _post(headers).json()
    third = _post(headers).json()

    # The first one is running, so it is not in the queue: the second waits alone, the third behind it.
    assert second["status"] == "queued" and (second["queue_position"], second["queue_length"]) == (1, 1)
    assert third["status"] == "queued" and (third["queue_position"], third["queue_length"]) == (2, 2)

    release.set()
    wait_until_idle()

    assert order == [first["investigation_id"], second["investigation_id"], third["investigation_id"]]
    assert max(overlap) == 1  # never two at the same time


def test_progress_of_a_queued_investigation_names_its_place_and_what_it_waits_for(db_session, monkeypatch):
    _seed(db_session)
    monkeypatch.setattr(
        "backend.api.debate_queue.run_debate", lambda *a, **kw: _result(kw["investigation_id"])
    )
    holder = _hold_slot()
    try:
        body = _post(auth_headers("forensic_analyst")).json()
        progress = client.get(
            f"/investigations/{body['investigation_id']}/progress", headers=bearer_for("forensic_analyst")
        ).json()
    finally:
        holder.release()
    worker.notify()
    wait_until_idle()

    assert progress["phase"] == "queued" and progress["status"] == "queued"
    assert (progress["queue_position"], progress["queue_length"]) == (1, 1)
    assert progress["waiting_for"] is not None
    assert progress["round"] is None and progress["rounds_complete"] == 0


def test_the_queue_is_limited_per_analyst_and_in_total(db_session, monkeypatch):
    _seed(db_session)
    monkeypatch.setattr(
        "backend.api.debate_queue.run_debate", lambda *a, **kw: _result(kw["investigation_id"])
    )
    monkeypatch.setattr(settings, "debate_queue_max_per_user", 2)
    monkeypatch.setattr(settings, "debate_queue_max_total", 3)
    holder = _hold_slot()
    try:
        analyst = auth_headers("forensic_analyst")
        assert _post(analyst).status_code == 202
        assert _post(analyst).status_code == 202
        mine = _post(analyst)
        assert mine.status_code == 429 and "already have 2 debates waiting" in mine.json()["detail"]

        lead = auth_headers("secops_lead")
        assert _post(lead).status_code == 202  # a different analyst still fits: 3 waiting
        full = _post(auth_headers("red_team_auditor"))
        assert full.status_code == 429 and "queue is full (3 waiting)" in full.json()["detail"]
    finally:
        holder.release()
    worker.notify()
    wait_until_idle()


def test_a_refused_request_is_not_counted_against_the_daily_caps(db_session, monkeypatch):
    _seed(db_session)
    monkeypatch.setattr(
        "backend.api.debate_queue.run_debate", lambda *a, **kw: _result(kw["investigation_id"])
    )
    monkeypatch.setattr(settings, "debate_queue_max_total", 0)
    assert _post(auth_headers("forensic_analyst")).status_code == 429
    assert get_redis().get("verdictchain:cap:debate_global:all") is None


def test_paused_intake_keeps_accepted_debates_waiting_until_it_is_resumed(db_session, monkeypatch):
    _seed(db_session)
    ran = threading.Event()

    def fake(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        ran.set()
        return _result(investigation_id)

    monkeypatch.setattr("backend.api.debate_queue.run_debate", fake)
    holder = _hold_slot()
    try:
        body = _post(auth_headers("forensic_analyst")).json()  # accepted while the slot is busy
        db_session.execute(text("UPDATE runtime_settings SET intake_paused = true WHERE id = 1"))
        db_session.commit()
    finally:
        holder.release()
    worker.notify()
    assert not ran.wait(timeout=0.7), "a debate started while intake was paused"
    assert _statuses()[body["investigation_id"]] == "queued"

    db_session.execute(text("UPDATE runtime_settings SET intake_paused = false WHERE id = 1"))
    db_session.commit()
    worker.notify()
    assert ran.wait(timeout=5)
    wait_until_idle()


def test_a_queued_investigation_left_by_a_restart_is_run_when_the_worker_starts(db_session, monkeypatch):
    _seed(db_session)
    seen: list[dict] = []

    def fake(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        seen.append({"primary": primary, "rows": len(rows), "scenario_rows": len(scenario_rows or [])})
        return _result(investigation_id)

    monkeypatch.setattr("backend.api.debate_queue.run_debate", fake)
    row_ids = [row.row_id for row in db_session.execute(select(RawLog)).scalars()]
    investigation_id = start_investigation(
        trigger_type="manual",
        trigger_reason="left by a restart",
        scenario_label="DDoS",
        primary_agent="network_traffic",
        noise_pct=0,
        effective_noise_pct=0.0,
        injected_row_ids=[],
        started_by="someone",
        max_rows_per_agent=3,
        run_spec=build_run_spec(
            primary_agent="network_traffic",
            row_ids=row_ids[:3],
            scenario_row_ids=None,
            max_rows_per_agent=3,
            requested_by="someone",
        ),
    )
    worker.ensure_started()  # what the app's start-up does
    wait_until_idle()

    assert seen == [{"primary": "network_traffic", "rows": 3, "scenario_rows": 5}]
    assert str(investigation_id) in _statuses()


def test_starting_a_queued_debate_is_audited_with_how_long_it_waited(db_session, monkeypatch):
    _seed(db_session)
    monkeypatch.setattr(
        "backend.api.debate_queue.run_debate", lambda *a, **kw: _result(kw["investigation_id"])
    )
    holder = _hold_slot()
    try:
        body = _post(auth_headers("forensic_analyst")).json()
        time.sleep(0.3)
    finally:
        holder.release()
    worker.notify()
    wait_until_idle()

    with SessionLocal() as session:
        entry = session.execute(
            select(AuditTrail).where(
                AuditTrail.investigation_id == uuid.UUID(body["investigation_id"]),
                AuditTrail.action == "debate_started",
            )
        ).scalar_one()
        started = session.execute(
            select(AuditTrail).where(
                AuditTrail.investigation_id == uuid.UUID(body["investigation_id"]),
                AuditTrail.action == "investigation_started",
            )
        ).scalar_one()
    assert entry.actor == "debate_queue"
    assert entry.detail["waited_seconds"] >= 0.3
    assert started.detail["queued"] is True and entry.seq > started.seq


def test_a_crashing_debate_is_marked_error_and_the_next_one_still_runs(db_session, monkeypatch):
    _seed(db_session)
    calls: list[str] = []

    def fake(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        calls.append(str(investigation_id))
        if len(calls) == 1:
            raise RuntimeError("boom")
        return _result(investigation_id)

    monkeypatch.setattr("backend.api.debate_queue.run_debate", fake)
    monkeypatch.setattr(settings, "debate_queue_max_per_user", 5)
    holder = _hold_slot()
    try:
        first = _post(auth_headers("forensic_analyst")).json()
        second = _post(auth_headers("forensic_analyst")).json()
    finally:
        holder.release()
    worker.notify()
    wait_until_idle()

    assert calls == [first["investigation_id"], second["investigation_id"]]
    assert _statuses()[first["investigation_id"]] == "error"


def test_wait_true_returns_the_verdict_after_waiting_in_the_queue(db_session, monkeypatch):
    _seed(db_session)
    monkeypatch.setattr(
        "backend.api.debate_queue.run_debate", lambda *a, **kw: _result(kw["investigation_id"])
    )
    holder = _hold_slot()
    answers: list = []

    def request() -> None:
        answers.append(
            client.post(SIMULATE, json={"scenario_label": "DDoS"}, headers=auth_headers("secops_lead"))
        )

    thread = threading.Thread(target=request)
    thread.start()
    time.sleep(0.5)
    assert not answers, "wait=true answered while its debate was still queued"
    holder.release()
    worker.notify()
    thread.join(timeout=10)

    assert answers[0].status_code == 201
    assert answers[0].json()["verdict"]["verdict_class"] == "ddos"
    wait_until_idle()


def test_the_run_spec_holds_ids_and_numbers_only_never_a_label(db_session, monkeypatch):
    _seed(db_session)
    monkeypatch.setattr(
        "backend.api.debate_queue.run_debate", lambda *a, **kw: _result(kw["investigation_id"])
    )
    holder = _hold_slot()
    try:
        body = _post(auth_headers("forensic_analyst")).json()
        with SessionLocal() as session:
            spec = session.get(Investigation, uuid.UUID(body["investigation_id"])).run_spec
            position = queue_position(session, uuid.UUID(body["investigation_id"]))
    finally:
        holder.release()
    worker.notify()
    wait_until_idle()

    assert set(spec) == {"primary_agent", "row_ids", "scenario_row_ids", "max_rows_per_agent", "requested_by"}
    assert "DDoS" not in json.dumps(spec)
    assert spec["scenario_row_ids"] is None and len(spec["row_ids"]) == 5
    assert position == (1, 1)
