"""The live feed makes no model call before it has streamed the chosen number of rows, and it stops when the
OpenAI token budget is used up. These tests check the gate, the status block and the budget. No test reaches
OpenAI: a call attempt would fail the test.
"""

import time

import pytest
import redis
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.agents import openai_usage
from backend.agents.llm_clients import OpenAIClient
from backend.api.debate_queue import worker
from backend.api.live_runner import LIVE_ACTOR, runner
from backend.api.main import app
from backend.api.openai_allowance import build_allowance
from backend.api.rate_limit import DEBATE_SLOT_KEY, get_redis
from backend.config import settings
from backend.db.models import AuditTrail, Investigation
from backend.db.session import SessionLocal
from backend.pipeline import live_state
from backend.pipeline.live_detector import LOGON, WindowScore
from backend.pipeline.live_monitor import Flag
from backend.tests.fixtures.auth import auth_headers
from backend.tests.fixtures.debate_queue import wait_until_idle
from backend.tests.pipeline.live_support import logon_rows, private_queue, wait_until

client = TestClient(app)


@pytest.fixture(autouse=True)
def _environment(monkeypatch):
    """A private queue, no real OpenAI (a call attempt fails the test), and clean counters."""
    redis_client = get_redis()
    redis_client.delete(DEBATE_SLOT_KEY)
    for key in redis_client.scan_iter("verdictchain:cap:*"):
        redis_client.delete(key)
    live_state.reset()
    openai_usage.reset()

    def never(*args, **kwargs):
        raise AssertionError("OpenAI was called")

    monkeypatch.setattr(OpenAIClient, "_call", never)
    with private_queue() as queue:
        monkeypatch.setattr(settings, "live_feed_queue", queue)
        monkeypatch.setattr(settings, "live_min_gap_seconds", 0)
        monkeypatch.setattr(settings, "live_daily_cap", 5)
        monkeypatch.setattr(settings, "openai_api_key", "sk-test-never-sent")
        monkeypatch.setattr(settings, "openai_model", "")
        monkeypatch.setattr(settings, "openai_daily_token_limit", 100_000)
        monkeypatch.setattr(settings, "live_llm_after_rows", 1500)
        yield
        try:
            runner.stop("test")
        except Exception:  # noqa: BLE001 - it may not be running
            pass
    wait_until_idle()
    live_state.reset()
    openai_usage.reset()
    redis_client.delete(DEBATE_SLOT_KEY)
    for key in redis_client.scan_iter("verdictchain:cap:*"):
        redis_client.delete(key)


def _flag(db_session) -> Flag:
    rows = logon_rows(20, off_hours=True, label="insider_scenario_1")
    db_session.add_all(rows)
    db_session.commit()
    score = WindowScore(LOGON, 20, 1.0, 0.2, 5.0, 1.0, True, "logon window: test")
    return Flag(LOGON, score, [row.row_id for row in rows], [1.0] * 20)


def _configure_run(rows_needed: int, rows_seen: int) -> None:
    live_state.set_config({"llm_after_rows": rows_needed})
    live_state.incr("consumed", rows_seen)


def _fake_debate(calls: list):
    def fake(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        calls.append(str(investigation_id))
        return {
            "investigation_id": str(investigation_id),
            "status": "verdict_reached",
            "verdict": {"verdict_class": "benign", "verdict_confidence": 0.5, "status": "verdict_reached"},
            "providers_used": {},
            "actions_taken": [],
        }

    return fake


# ---- the gate: no model call before the feed has streamed enough rows ------------------------------------


def test_a_feed_that_has_not_streamed_enough_rows_starts_nothing_and_calls_nobody(db_session):
    flag = _flag(db_session)
    _configure_run(rows_needed=1500, rows_seen=620)

    assert runner.on_flag(flag) is False

    blocked = live_state.blocked()
    assert blocked is not None
    assert blocked["reason"] == "warming up: 620 of 1,500 rows seen; OpenAI is not called before that"
    with SessionLocal() as session:
        assert session.query(Investigation).count() == 0
    assert openai_usage.usage_24h().calls == 0  # and the autouse fixture fails the test on any OpenAI call


def test_once_the_rows_have_streamed_a_flag_opens_an_investigation_the_queue_runs(db_session, monkeypatch):
    calls: list = []
    monkeypatch.setattr("backend.api.debate_queue.run_debate", _fake_debate(calls))
    flag = _flag(db_session)
    _configure_run(rows_needed=1500, rows_seen=1500)

    assert runner.on_flag(flag) is True
    wait_until(lambda: len(calls) == 1, timeout=15, what="the debate to run")
    wait_until_idle()

    assert live_state.blocked() is None
    with SessionLocal() as session:
        investigation = session.execute(select(Investigation)).scalar_one()
        assert investigation.trigger_type == "continuous"
        assert investigation.run_spec["requested_by"] == LIVE_ACTOR
        assert investigation.scenario_label == "insider_scenario_1"  # evaluation only, attached on the server
    worker.notify()


def test_without_a_key_the_reason_says_so(db_session, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")
    _configure_run(rows_needed=50, rows_seen=5000)

    assert (
        runner._blocked_reason()
        == "OpenAI is not configured (OPENAI_API_KEY is empty), so no automatic investigation can run"
    )


def test_a_spent_token_budget_stops_new_investigations_and_says_so(db_session, monkeypatch):
    monkeypatch.setattr(settings, "openai_daily_token_limit", 1_000)
    _configure_run(rows_needed=50, rows_seen=5000)
    assert runner._blocked_reason() is None

    openai_usage.record(900, 150)

    assert (
        runner._blocked_reason() == "the OpenAI token budget for 24 hours is used up (1,050 of 1,000 tokens)"
    )


def test_a_key_openai_says_is_out_of_requests_stops_new_investigations_and_says_so(db_session):
    _configure_run(rows_needed=50, rows_seen=5000)
    assert runner._blocked_reason() is None

    openai_usage.record_limits(
        {"x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "0"}, blocked_for_s=1728
    )

    assert runner._blocked_reason() == (
        "OpenAI's limit for this key is reached; it frees up in about 29 minutes"
    )
    assert runner.on_flag(_flag(db_session)) is False  # nothing is queued that would only fail
    with SessionLocal() as session:
        assert session.query(Investigation).count() == 0


def test_a_budget_that_cannot_be_read_blocks_instead_of_guessing(db_session, monkeypatch):
    _configure_run(rows_needed=50, rows_seen=5000)

    def broken():
        raise redis.ConnectionError("down")

    with monkeypatch.context() as patch:
        patch.setattr(openai_usage, "usage_24h", broken)
        assert (
            runner._blocked_reason() == "the OpenAI token budget cannot be checked (Redis is not reachable)"
        )


def test_the_threshold_is_read_from_the_run_not_from_the_setting(db_session):
    _configure_run(rows_needed=300, rows_seen=299)
    assert runner._blocked_reason().startswith("warming up: 299 of 300 rows")
    live_state.incr("consumed")
    assert runner._blocked_reason() is None


# ---- starting the feed and the status block ----------------------------------------------------------------


def test_start_validates_the_activation_row_count(db_session):
    lead = auth_headers("secops_lead", username="lead_openai_1")

    assert client.post("/live/start", json={"llm_after_rows": 49}, headers=lead).status_code == 422
    assert client.post("/live/start", json={"llm_after_rows": 20001}, headers=lead).status_code == 422
    assert client.post("/live/start", json={"llm_after_rows": "many"}, headers=lead).status_code == 422
    with pytest.raises(Exception, match="llm_after_rows must be between 50 and 20,000"):
        runner.start("test", llm_after_rows=10)


def test_the_status_shows_the_llm_state_from_off_to_warming_up_to_active_to_budget(db_session):
    reader = auth_headers("forensic_analyst")

    def llm() -> dict:
        return client.get("/live/status", headers=reader).json()["llm"]

    block = llm()
    assert block["provider"] == "openai" and block["configured"] is True and block["state"] == "off"
    assert block["model"] == "gpt-4.1-mini"
    assert block["activation_rows"]["value"] is None and block["activation_rows"]["reason"]
    assert block["token_limit"]["value"] == 100_000 and block["tokens_24h"]["value"] == 0

    live_state.set_config({"llm_after_rows": 1500})
    live_state.incr("consumed", 400)
    runner._feed = runner._monitor = type(
        "Alive", (), {"alive": True, "error": None, "stop": lambda self: None}
    )()
    try:
        block = llm()
        assert block["state"] == "warming_up" and block["rows_seen"]["value"] == 400
        assert block["activation_rows"]["value"] == 1500

        live_state.incr("consumed", 1100)
        assert llm()["state"] == "active"

        openai_usage.record(60_000, 45_000)
        block = llm()
        assert block["state"] == "budget_reached"
        assert block["tokens_24h"]["value"] == 105_000 and block["calls_24h"]["value"] == 1
    finally:
        runner._feed = runner._monitor = None


def test_the_status_shows_what_openai_itself_allows_and_when_it_asked_for_a_wait(db_session):
    reader = auth_headers("forensic_analyst")

    def llm() -> dict:
        return client.get("/live/status", headers=reader).json()["llm"]

    nothing = llm()["allowance"]
    assert (
        nothing["requests_left"]["value"] is None and nothing["requests_left"]["reason"]
    )  # never a made-up 0
    assert nothing["held_until"] is None

    openai_usage.record_limits(
        {
            "x-ratelimit-limit-requests": "50",
            "x-ratelimit-remaining-requests": "7",
            "x-ratelimit-limit-tokens": "100000",
            "x-ratelimit-remaining-tokens": "81000",
        }
    )
    reading = llm()["allowance"]
    assert [reading[name]["value"] for name in ("requests_left", "requests_allowed")] == [7, 50]
    assert [reading[name]["value"] for name in ("tokens_left", "tokens_allowed")] == [81_000, 100_000]
    assert reading["requests_left"]["source"].startswith("x-ratelimit-")  # its own headers, not our count

    live_state.set_config({"llm_after_rows": 50})
    live_state.incr("consumed", 400)
    runner._feed = runner._monitor = type(
        "Alive", (), {"alive": True, "error": None, "stop": lambda self: None}
    )()
    try:
        assert llm()["state"] == "allowance_reached"  # 7 requests left, a debate needs 9
        openai_usage.record_limits(
            {"x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "0"}, blocked_for_s=900
        )
        held = llm()
        assert held["state"] == "allowance_reached" and held["allowance"]["held_until"] is not None
    finally:
        runner._feed = runner._monitor = None


def test_a_spent_allowance_is_shown_as_held_for_a_few_minutes_then_as_due_for_a_new_question():
    now = time.time()
    openai_usage.record_limits(
        {"x-ratelimit-limit-tokens": "100000", "x-ratelimit-remaining-tokens": "0"},
        blocked_for_s=729 * 3600,
        now=now,
    )

    assert build_allowance(now=now + 10).held_until is not None
    later = build_allowance(now=now + openai_usage.RECHECK_S + 1)
    assert later.held_until is None  # the page no longer claims "nothing is sent": the next call goes out
    assert later.tokens_left.value == 0 and later.tokens_left.n == 1  # the last reading stays, with its time


def test_without_a_key_the_status_says_not_configured_and_never_the_key(db_session, monkeypatch):
    monkeypatch.setattr(settings, "openai_api_key", "")

    status = client.get("/live/status", headers=auth_headers("forensic_analyst")).json()

    assert status["llm"]["state"] == "not_configured" and status["llm"]["model"] is None
    assert "sk-" not in str(status)


def test_system_status_lists_openai_as_the_only_provider_without_exposing_the_key(db_session):
    body = client.get("/system/status", headers=auth_headers("forensic_analyst")).json()

    assert list(body["providers"]) == ["openai"]
    assert (
        body["providers"]["openai"]["configured"] is True
        and body["providers"]["openai"]["model"] == "gpt-4.1-mini"
    )
    assert "sk-test-never-sent" not in str(body)
    allowance = body["providers"]["openai"]["allowance"]  # nothing recorded yet: nulls with reasons
    assert allowance["requests_left"]["value"] is None and allowance["requests_left"]["reason"]

    openai_usage.record_limits({"x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "12"})
    body = client.get("/system/status", headers=auth_headers("forensic_analyst")).json()
    assert body["providers"]["openai"]["allowance"]["requests_left"]["value"] == 12


def test_the_start_is_audited_with_the_activation_count(db_session):
    db_session.add_all(logon_rows(60, off_hours=False))
    db_session.commit()
    lead = auth_headers("secops_lead", username="lead_openai_2")

    started = client.post("/live/start", json={"events_per_second": 10, "llm_after_rows": 300}, headers=lead)
    assert started.status_code == 200 and started.json()["llm"]["activation_rows"]["value"] == 300
    client.post("/live/stop", headers=lead)

    with SessionLocal() as session:
        entry = session.execute(
            select(AuditTrail).where(AuditTrail.action == "live_feed_started")
        ).scalar_one()
    assert entry.detail["llm_after_rows"] == 300
