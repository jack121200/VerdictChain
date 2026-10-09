"""Idempotency-Key on POST /investigations/simulate, GET /investigations/{id}/progress, and the clean-up of
debates a restart cut off (checklist UD15, SD3, BE1)."""

import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.api.main import app
from backend.api.rate_limit import DEBATE_SLOT_KEY, DebateSlot, get_redis, slot_holder
from backend.api.recovery import recover_after_restart
from backend.db.models import Investigation, RawLog
from backend.db.session import SessionLocal
from backend.tests.fixtures.auth import auth_headers
from backend.tests.fixtures.read_seed import add_investigation, audit, bearer_for

client = TestClient(app)
SIMULATE = "/investigations/simulate"
T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)


def _clear() -> None:
    redis_client = get_redis()
    redis_client.delete(DEBATE_SLOT_KEY)
    for pattern in ("verdictchain:cap:*", "verdictchain:idem:*", "verdictchain:ratelimit:simulate:*"):
        for key in redis_client.scan_iter(pattern):
            redis_client.delete(key)


@pytest.fixture(autouse=True)
def _clean_redis_state():
    _clear()
    yield
    _clear()


def _seed_scenario(db_session, n: int = 5) -> None:
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


def _fast_debate(monkeypatch, calls: list | None = None) -> None:
    def quick(primary, rows, *, investigation_id, max_rows_per_agent, on_update, scenario_rows=None):
        if calls is not None:
            calls.append(investigation_id)
        return {
            "investigation_id": str(investigation_id),
            "status": "verdict_reached",
            "verdict": {"verdict_class": "ddos", "verdict_confidence": 0.9, "status": "verdict_reached"},
            "providers_used": {},
            "actions_taken": [],
        }

    monkeypatch.setattr("backend.api.routes.simulate.run_debate", quick)


def _wait_until_slot_free(timeout: float = 5.0) -> None:
    deadline = time.monotonic() + timeout
    while slot_holder() is not None and time.monotonic() < deadline:
        time.sleep(0.02)
    assert slot_holder() is None


def _investigation_count() -> int:
    with SessionLocal() as session:
        return len(session.execute(select(Investigation.investigation_id)).scalars().all())


# ---------------------------------------------------------------- idempotency


def test_the_same_key_returns_the_first_investigation_and_starts_no_second_debate(db_session, monkeypatch):
    _seed_scenario(db_session)
    calls: list = []
    _fast_debate(monkeypatch, calls)
    headers = {**auth_headers("forensic_analyst"), "Idempotency-Key": "click-0001-abcdef"}
    body = {"scenario_label": "DDoS", "wait": False}

    first = client.post(SIMULATE, json=body, headers=headers)
    _wait_until_slot_free()
    second = client.post(SIMULATE, json=body, headers=headers)

    assert first.status_code == 202 and "Idempotent-Replay" not in first.headers
    assert second.status_code == 202
    assert second.headers["Idempotent-Replay"] == "true"
    assert second.json()["investigation_id"] == first.json()["investigation_id"]
    assert second.json()["primary_agent"] == "network_traffic"
    assert _investigation_count() == 1
    assert len(calls) == 1  # the debate ran once


def test_a_different_key_or_no_key_starts_a_new_debate(db_session, monkeypatch):
    _seed_scenario(db_session)
    _fast_debate(monkeypatch)
    headers = auth_headers("forensic_analyst")
    body = {"scenario_label": "DDoS", "wait": False}

    ids = set()
    for key in ("first-key-0001", "second-key-0002", None):
        sent = {**headers, **({"Idempotency-Key": key} if key else {})}
        response = client.post(SIMULATE, json=body, headers=sent)
        assert response.status_code == 202
        ids.add(response.json()["investigation_id"])
        _wait_until_slot_free()

    assert len(ids) == 3


def test_a_key_belongs_to_one_analyst(db_session, monkeypatch):
    _seed_scenario(db_session)
    _fast_debate(monkeypatch)
    body = {"scenario_label": "DDoS", "wait": False}
    key = {"Idempotency-Key": "shared-key-0001"}

    first = client.post(SIMULATE, json=body, headers={**auth_headers("forensic_analyst"), **key})
    _wait_until_slot_free()
    other = client.post(SIMULATE, json=body, headers={**auth_headers("forensic_analyst"), **key})

    assert first.status_code == other.status_code == 202
    assert "Idempotent-Replay" not in other.headers
    assert other.json()["investigation_id"] != first.json()["investigation_id"]


def test_a_refused_request_releases_the_key_for_a_corrected_retry(db_session, monkeypatch):
    _fast_debate(monkeypatch)
    headers = {**auth_headers("forensic_analyst"), "Idempotency-Key": "retry-key-0001"}
    body = {"scenario_label": "DDoS", "wait": False}

    refused = client.post(SIMULATE, json=body, headers=headers)  # no rows seeded yet: 404
    assert refused.status_code == 404

    _seed_scenario(db_session)
    retried = client.post(SIMULATE, json=body, headers=headers)
    assert retried.status_code == 202
    assert "Idempotent-Replay" not in retried.headers


def test_a_key_still_being_accepted_answers_409(db_session, monkeypatch):
    _seed_scenario(db_session)
    _fast_debate(monkeypatch)
    headers = auth_headers("forensic_analyst")
    username = client.get("/auth/me", headers=headers).json()["username"]
    get_redis().set(f"verdictchain:idem:{username}:busy-key-00001", "pending", ex=60)

    response = client.post(
        SIMULATE,
        json={"scenario_label": "DDoS", "wait": False},
        headers={**headers, "Idempotency-Key": "busy-key-00001"},
    )

    assert response.status_code == 409
    assert "still being processed" in response.json()["detail"]
    assert _investigation_count() == 0


@pytest.mark.parametrize("bad", ["short", "has spaces in it", "x" * 101, "semi;colon-key"])
def test_a_malformed_key_is_rejected(db_session, monkeypatch, bad):
    _seed_scenario(db_session)
    _fast_debate(monkeypatch)
    response = client.post(
        SIMULATE,
        json={"scenario_label": "DDoS", "wait": False},
        headers={**auth_headers("forensic_analyst"), "Idempotency-Key": bad},
    )
    assert response.status_code == 422
    assert _investigation_count() == 0


# ---------------------------------------------------------------- progress


def test_progress_of_a_finished_investigation(db_session):
    inv = add_investigation(
        db_session, status="contained", created_at=datetime.now(timezone.utc) - timedelta(seconds=90)
    )
    for round_no in (1, 2, 3):
        audit(db_session, "debate_engine", "round_completed", {"round": round_no}, inv.investigation_id)
    db_session.commit()

    body = client.get(
        f"/investigations/{inv.investigation_id}/progress", headers=bearer_for("forensic_analyst")
    ).json()

    assert body["phase"] == "finished" and body["status"] == "contained"
    assert (body["rounds_complete"], body["rounds_total"], body["round"]) == (3, 3, None)
    assert body["elapsed_seconds"] >= 90


def test_progress_of_the_debate_that_holds_the_slot_is_running(db_session):
    inv = add_investigation(db_session, status="investigating")
    audit(db_session, "debate_engine", "round_completed", {"round": 1}, inv.investigation_id)
    db_session.commit()
    slot = DebateSlot()
    assert slot.acquire()
    slot.bind(str(inv.investigation_id))

    body = client.get(
        f"/investigations/{inv.investigation_id}/progress", headers=bearer_for("forensic_analyst")
    ).json()

    assert body["phase"] == "running"
    assert (body["rounds_complete"], body["round"]) == (1, 2)  # round 2 is in progress


def test_progress_of_an_investigating_case_nobody_runs_is_unknown(db_session):
    inv = add_investigation(db_session, status="investigating")
    db_session.commit()

    body = client.get(
        f"/investigations/{inv.investigation_id}/progress", headers=bearer_for("forensic_analyst")
    ).json()

    assert body["phase"] == "unknown" and body["round"] is None


def test_progress_of_a_failed_debate_and_of_a_missing_one(db_session):
    inv = add_investigation(db_session, status="error")
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    assert (
        client.get(f"/investigations/{inv.investigation_id}/progress", headers=headers).json()["phase"]
        == "error"
    )
    assert client.get(f"/investigations/{uuid.uuid4()}/progress", headers=headers).status_code == 404
    assert client.get(f"/investigations/{inv.investigation_id}/progress").status_code == 401


# ---------------------------------------------------------------- recovery after a restart


def test_start_up_recovery_marks_cut_off_debates_and_frees_the_slot(db_session):
    running = add_investigation(db_session, status="investigating")
    done = add_investigation(db_session, status="contained")
    db_session.commit()
    slot = DebateSlot()
    assert slot.acquire()
    slot.bind(str(running.investigation_id))

    marked, holder = recover_after_restart()

    assert (marked, holder) == (1, str(running.investigation_id))
    assert slot_holder() is None
    with SessionLocal() as session:
        assert session.get(Investigation, running.investigation_id).status == "error"
        assert session.get(Investigation, done.investigation_id).status == "contained"  # untouched


def test_start_up_recovery_with_nothing_to_do_is_quiet(db_session):
    assert recover_after_restart() == (0, None)
