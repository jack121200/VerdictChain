"""The simulated live feed end to end (checklist RT1-RT7): the sensor replays rows through RabbitMQ, the
monitor flags a window, an investigation starts by itself and the debate queue runs it. The debate is a
fake (no LLM)."""

import json
import time
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from backend.api.debate_queue import build_run_spec, worker
from backend.api.live_runner import LIVE_ACTOR, runner
from backend.api.main import app
from backend.api.rate_limit import DEBATE_SLOT_KEY, DebateSlot, get_redis, record_daily_run
from backend.config import settings
from backend.db.models import AuditTrail, Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate.engine import start_investigation
from backend.pipeline import live_state
from backend.tests.fixtures.auth import auth_headers
from backend.tests.fixtures.debate_queue import wait_until_idle
from backend.tests.pipeline.live_support import T0, logon_rows, private_queue, wait_until

client = TestClient(app)


@pytest.fixture(autouse=True)
def _live_environment(monkeypatch):
    """A private queue, small caps, and a feed that is stopped again whatever the test did."""
    redis_client = get_redis()
    redis_client.delete(DEBATE_SLOT_KEY)
    for pattern in ("verdictchain:cap:*", "verdictchain:ratelimit:live_control:*"):
        for key in redis_client.scan_iter(pattern):
            redis_client.delete(key)
    live_state.reset()
    with private_queue() as queue:
        monkeypatch.setattr(settings, "live_feed_queue", queue)
        monkeypatch.setattr(settings, "live_feed_attack_share", 1.0)
        monkeypatch.setattr(settings, "live_min_gap_seconds", 0)
        monkeypatch.setattr(settings, "live_daily_cap", 1)
        # The live feed asks OpenAI only (after this many rows); these tests never reach a real one.
        monkeypatch.setattr(settings, "openai_api_key", "test-key-never-sent")
        monkeypatch.setattr(settings, "live_llm_after_rows", 50)
        yield
        try:
            runner.stop("test")
        except Exception:  # noqa: BLE001 - it may not be running
            pass
    wait_until_idle()
    live_state.reset()
    redis_client.delete(DEBATE_SLOT_KEY)
    for key in redis_client.scan_iter("verdictchain:cap:*"):
        redis_client.delete(key)


def _seed_dataset(db_session) -> None:
    """300 ordinary logon rows (some off-hours, so the baseline has a spread) and 100 scenario rows."""
    ordinary = logon_rows(280, off_hours=False) + logon_rows(20, off_hours=True, start=280)
    scenario = logon_rows(100, off_hours=True, label="insider_scenario_1", start=400)
    db_session.add_all(ordinary + scenario)
    db_session.commit()


def _fake_debate(calls: list):
    def fake(
        primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None, **profile
    ):
        calls.append(
            {
                "investigation_id": str(investigation_id),
                "primary": primary,
                "rows": rows,
                "max_rows": max_rows_per_agent,
                "scenario_rows": scenario_rows,
                "profile": profile,
            }
        )
        return {
            "investigation_id": str(investigation_id),
            "status": "verdict_reached",
            "verdict": {"verdict_class": "benign", "verdict_confidence": 0.5, "status": "verdict_reached"},
            "providers_used": {},
            "actions_taken": [],
        }

    return fake


def _status(headers) -> dict:
    response = client.get("/live/status", headers=headers)
    assert response.status_code == 200
    return response.json()


def test_a_flagged_window_starts_an_investigation_with_nobody_clicking(db_session, monkeypatch):
    _seed_dataset(db_session)
    calls: list = []
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate(calls))
    lead = auth_headers("secops_lead", username="lead_live_1")

    started = client.post("/live/start", json={"events_per_second": 50}, headers=lead)
    assert started.status_code == 200 and started.json()["state"] == "running"
    wait_until(
        lambda: _status(lead)["triggered"]["value"] >= 1, timeout=30, what="an automatic investigation"
    )
    wait_until(lambda: len(calls) == 1, timeout=15, what="the debate to run")
    wait_until_idle()

    status = _status(lead)
    assert status["simulated"] is True and "No real network is monitored" in status["notice"]
    assert status["consumed"]["value"] > 0 and status["published"]["value"] >= status["consumed"]["value"]
    assert status["triggers_today"]["value"] == 1 and status["daily_cap"]["value"] == 1
    trigger = status["last_trigger"]
    assert "logon window" in trigger["reason"] and trigger["group"] == "logon"

    with SessionLocal() as session:
        investigation = session.get(Investigation, uuid.UUID(trigger["investigation_id"]))
        assert (
            investigation.trigger_type == "continuous" and investigation.trigger_reason == trigger["reason"]
        )
        assert investigation.primary_agent == "endpoint_behavior"
        assert investigation.scenario_label == "insider_scenario_1"  # attached on the server, for /evaluation
        assert "insider_scenario" not in json.dumps(investigation.run_spec) + trigger["reason"]
        assert investigation.run_spec["requested_by"] == LIVE_ACTOR
        started_entry = session.execute(
            select(AuditTrail).where(
                AuditTrail.investigation_id == investigation.investigation_id,
                AuditTrail.action == "investigation_started",
            )
        ).scalar_one()
        assert started_entry.actor == LIVE_ACTOR and started_entry.detail["queued"] is True
        assert "insider_scenario" not in json.dumps(started_entry.detail)

    call = calls[0]
    assert call["primary"] == "endpoint_behavior" and call["max_rows"] == 5
    assert 1 <= len(call["rows"]) <= 5 and all(row.source == "cert_r4.2_logon" for row in call["rows"])
    assert len(call["scenario_rows"]) == 20  # the whole flagged window is the context of the other agents

    detail = client.get(f"/investigations/{trigger['investigation_id']}", headers=lead).json()
    assert "insider_scenario" not in json.dumps(detail)  # the label is never returned by the API

    # The system reports continuous mode while the feed runs, and stops reporting it when it stops.
    assert client.get("/system/status", headers=lead).json()["continuous_mode"] is True
    assert client.post("/live/stop", headers=lead).json()["state"] == "stopped"
    assert client.get("/system/status", headers=lead).json()["continuous_mode"] is False


def test_start_and_stop_are_audited_with_the_analyst_and_the_settings(db_session, monkeypatch):
    _seed_dataset(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate([]))
    lead = auth_headers("secops_lead", username="lead_live_2")

    client.post("/live/start", json={"events_per_second": 12, "auto_investigate": False}, headers=lead)
    again = client.post("/live/start", json={}, headers=lead)
    stopped = client.post("/live/stop", headers=lead)
    nothing = client.post("/live/stop", headers=lead)

    assert again.status_code == 409 and "already running" in again.json()["detail"]
    assert stopped.status_code == 200
    assert nothing.status_code == 409
    with SessionLocal() as session:
        entries = (
            session.execute(select(AuditTrail).where(AuditTrail.action.like("live_feed_%"))).scalars().all()
        )
    by_action = {entry.action: entry for entry in entries}
    assert by_action["live_feed_started"].actor == "lead_live_2"
    assert by_action["live_feed_started"].detail["events_per_second"] == 12
    assert by_action["live_feed_started"].detail["auto_investigate"] is False
    assert by_action["live_feed_stopped"].actor == "lead_live_2"
    assert set(by_action["live_feed_stopped"].detail) == {"published", "consumed", "flagged", "triggered"}


def test_only_a_lead_or_a_supervisor_may_control_the_feed_everyone_may_watch_it(db_session):
    analyst = auth_headers("forensic_analyst")
    supervisor = auth_headers("watchdog_supervisor")

    denied = client.post("/live/start", json={}, headers=analyst)
    assert denied.status_code == 403 and denied.json()["detail"] == "Missing capability: control_live_feed"
    assert client.post("/live/stop", headers=analyst).status_code == 403
    assert client.get("/live/status", headers=analyst).status_code == 200
    assert client.get("/live/arrivals", headers=analyst).json() == []
    assert client.get("/live/status").status_code == 401
    assert client.post("/live/start", json={}).status_code == 401
    assert client.post("/live/start", json={"events_per_second": 0.1}, headers=supervisor).status_code == 422
    assert client.post("/live/start", json={"events_per_second": 100}, headers=supervisor).status_code == 422
    assert client.post("/live/start", json={"is_simulated": False}, headers=supervisor).status_code == 422


def test_automatic_investigations_can_be_switched_off_and_the_monitor_still_runs(db_session, monkeypatch):
    _seed_dataset(db_session)
    calls: list = []
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate(calls))
    lead = auth_headers("secops_lead")

    client.post("/live/start", json={"events_per_second": 50, "auto_investigate": False}, headers=lead)
    wait_until(lambda: _status(lead)["flagged"]["value"] >= 1, timeout=30, what="a flagged window")
    status = _status(lead)

    assert status["auto_investigate"] is False and status["triggered"]["value"] == 0
    assert calls == []
    with SessionLocal() as session:
        assert session.query(Investigation).count() == 0
    arrivals = client.get("/live/arrivals?limit=5", headers=lead).json()
    assert 1 <= len(arrivals) <= 5
    assert set(arrivals[0]) == {
        "row_id",
        "timestamp",
        "source",
        "event_type",
        "user_id",
        "host_id",
        "arrived_at",
    }
    assert "insider_scenario" not in json.dumps(arrivals)


def test_the_daily_cap_stops_a_second_investigation_and_says_why(db_session, monkeypatch):
    _seed_dataset(db_session)
    calls: list = []
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate(calls))
    lead = auth_headers("secops_lead")

    client.post("/live/start", json={"events_per_second": 50}, headers=lead)
    wait_until(
        lambda: "daily limit" in ((_status(lead)["blocked"] or {}).get("reason") or "")
        and _status(lead)["triggered"]["value"] == 1,
        timeout=40,
        what="the second flag to be refused because of the cap",
    )
    status = _status(lead)

    assert "daily limit for automatic investigations is reached (1)" in status["blocked"]["reason"]
    assert status["triggered"]["value"] == 1 and status["triggers_today"]["value"] == 1


def test_the_feed_can_start_with_the_api_and_stops_with_it(db_session, monkeypatch):
    _seed_dataset(db_session)
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate([]))
    monkeypatch.setattr(settings, "live_feed_autostart", True)

    with TestClient(app) as started:  # entering runs the app's start-up
        assert runner.running
        status = started.get("/live/status", headers=auth_headers("forensic_analyst")).json()
        assert status["state"] == "running" and status["started_by"] == "system"
    assert not runner.running  # leaving stopped the threads

    with SessionLocal() as session:
        actors = (
            session.execute(select(AuditTrail.actor).where(AuditTrail.action == "live_feed_started"))
            .scalars()
            .all()
        )
    assert actors == ["system"]


def test_a_start_up_without_the_setting_leaves_the_feed_off(db_session):
    with TestClient(app):
        assert not runner.running


def test_a_stopped_feed_that_never_ran_reports_zeros_and_missing_values_honestly(db_session):
    status = _status(auth_headers("forensic_analyst"))

    assert status["state"] == "stopped" and status["started_at"] is None
    assert status["published"]["value"] == 0 and status["consumed"]["value"] == 0
    assert status["rate"]["value"] is None and status["rate"]["reason"]
    assert status["backlog"]["value"] is None and status["backlog"]["reason"]
    assert [window["group"] for window in status["windows"]] == ["network", "logon", "device", "file"]
    assert all(
        window["rows"] == 0 and window["rule"] == "the feed has not run yet" for window in status["windows"]
    )
    assert status["last_trigger"] is None and status["blocked"] is None


def test_without_dataset_rows_the_feed_does_not_start(db_session):
    response = client.post("/live/start", json={}, headers=auth_headers("secops_lead"))

    assert response.status_code == 409
    assert "nothing to replay" in response.json()["detail"]
    assert _status(auth_headers("forensic_analyst"))["state"] == "stopped"


def test_when_rabbitmq_is_down_start_says_so(db_session, monkeypatch):
    _seed_dataset(db_session)
    headers = auth_headers("secops_lead")
    with monkeypatch.context() as patch:  # scoped, so the fixture can still clean its queue up afterwards
        patch.setattr(settings, "rabbitmq_url", "amqp://guest:guest@127.0.0.1:1/")
        response = client.post("/live/start", json={}, headers=headers)

    assert response.status_code == 503 and "RabbitMQ is not reachable" in response.json()["detail"]


# ---- the guards, one by one (no threads) -------------------------------------------------------------------


def _queue_one_automatic_investigation(db_session) -> None:
    db_session.add(RawLog(timestamp=T0, source="cert_r4.2_logon", event_type="logon", raw_fields={}))
    db_session.commit()
    start_investigation(
        trigger_type="continuous",
        trigger_reason="test",
        scenario_label=None,
        primary_agent="endpoint_behavior",
        noise_pct=0,
        effective_noise_pct=0.0,
        injected_row_ids=[],
        started_by=LIVE_ACTOR,
        max_rows_per_agent=5,
        run_spec=build_run_spec(
            primary_agent="endpoint_behavior",
            row_ids=[],
            scenario_row_ids=None,
            max_rows_per_agent=5,
            requested_by=LIVE_ACTOR,
        ),
    )


def test_every_guard_gives_its_own_reason(db_session, monkeypatch):
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate([]))
    monkeypatch.setattr(settings, "live_daily_cap", 3)
    monkeypatch.setattr(settings, "live_min_gap_seconds", 60)
    monkeypatch.setattr(settings, "live_max_queued", 1)
    reason = runner._blocked_reason
    live_state.incr("consumed", 100)  # past the OpenAI activation threshold (50 rows in these tests)
    assert reason() is None  # nothing in the way

    db_session.execute(text("UPDATE runtime_settings SET intake_paused = true WHERE id = 1"))
    db_session.commit()
    assert reason() == "intake is paused"
    db_session.execute(text("UPDATE runtime_settings SET intake_paused = false WHERE id = 1"))
    db_session.commit()

    db_session.execute(
        text("UPDATE agent_quarantine SET active = true WHERE agent_id IN ('access_log', 'network_traffic')")
    )
    db_session.commit()
    assert reason() == "fewer than 2 investigators are active"
    db_session.execute(text("UPDATE agent_quarantine SET active = false"))
    db_session.commit()

    live_state.set_group_trigger("logon", time.time() - 20)
    held = reason("logon")
    assert held.startswith("cooling down: ") and held.endswith(
        " s until the next automatic investigation from the logon window"
    )
    assert reason("file") is None  # the cooldown is per source window: another one is not held back by it
    assert reason() is None  # and a check without a window has none to apply
    live_state.reset()
    live_state.incr("consumed", 100)

    slot = DebateSlot()  # keeps the worker from taking the queued investigation while it is checked
    assert slot.acquire()
    try:
        _queue_one_automatic_investigation(db_session)
        assert reason() == "an automatic investigation is already waiting for a free debate slot"
        db_session.execute(text("UPDATE investigations SET status = 'error'"))
        db_session.commit()
        assert reason().startswith(
            "the last automatic investigation failed"
        )  # back off, the providers may be down
        db_session.execute(text("UPDATE investigations SET created_at = now() - interval '1 hour'"))
        db_session.commit()
        assert reason() is None  # it failed long ago: try again
        db_session.execute(text("UPDATE investigations SET status = 'verdict_reached'"))
        db_session.commit()
    finally:
        slot.release()

    for _ in range(3):
        record_daily_run("live_auto", "all")
    assert reason() == "the daily limit for automatic investigations is reached (3)"
    get_redis().delete("verdictchain:cap:live_auto:all")

    for _ in range(settings.debate_daily_limit_global):
        record_daily_run("debate_global", "all")
    assert reason() == "the daily debate limit across all analysts is reached"


def test_each_source_window_starts_its_own_investigation_and_has_its_own_cooldown(db_session, monkeypatch):
    from backend.pipeline.live_detector import FILE, LOGON, WindowScore
    from backend.pipeline.live_monitor import Flag

    calls: list = []
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate(calls))
    monkeypatch.setattr(settings, "live_daily_cap", 10)
    monkeypatch.setattr(settings, "live_min_gap_seconds", 60)
    monkeypatch.setattr(settings, "live_max_queued", 5)
    live_state.incr("consumed", 100)  # past the OpenAI activation threshold
    logon = logon_rows(20, off_hours=True)
    files = [
        RawLog(
            row_id=uuid.uuid4(),
            timestamp=T0 + timedelta(minutes=i),
            source="cert_r4.2_file",
            event_type="file_access",
            user_id=f"U{i % 3:03d}",
            host_id="PC-1",
            raw_fields={"file_access_count": 40},
            ground_truth_label="insider_scenario_2",
        )
        for i in range(20)
    ]
    db_session.add_all(logon + files)
    db_session.commit()

    def flag(group, rows, feature):
        score = WindowScore(group, 20, 1.0, 0.2, 5.0, 1.0, True, f"{group} window: test")
        return Flag(group, score, [row.row_id for row in rows], [feature] * len(rows))

    slot = DebateSlot()  # keeps the worker from starting them, so both stay queued while they are checked
    assert slot.acquire()
    try:
        assert runner.on_flag(flag(LOGON, logon, 1.0)) is True
        assert runner.on_flag(flag(FILE, files, 40.0)) is True  # another window: not held back by the first
        assert runner.on_flag(flag(LOGON, logon, 1.0)) is False  # the same window: still cooling down
        reason = live_state.blocked()["reason"]
        assert "cooling down" in reason and "from the logon window" in reason
        assert live_state.counters()["triggered"] == 2
    finally:
        slot.release()
    worker.notify()
    wait_until_idle()

    with SessionLocal() as session:
        queued = session.execute(select(Investigation).where(Investigation.trigger_type == "continuous"))
        agents = sorted(investigation.primary_agent for investigation in queued.scalars())
    assert agents == ["access_log", "endpoint_behavior"]
    assert len(calls) == 2


def test_a_window_whose_rows_are_gone_starts_nothing(db_session):
    from backend.pipeline.live_detector import LOGON, WindowScore
    from backend.pipeline.live_monitor import Flag

    score = WindowScore(LOGON, 20, 1.0, 0.2, 5.0, 1.0, True, "logon window: test")
    flag = Flag(LOGON, score, [uuid.uuid4() for _ in range(20)], [1.0] * 20)

    assert runner.on_flag(flag) is False
    with SessionLocal() as session:
        assert session.query(Investigation).count() == 0
