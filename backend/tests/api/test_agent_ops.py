"""Dry-run fault injection, quarantine and restore (plan sections 2.8 and 3.5)."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from backend.api.main import app
from backend.api.rate_limit import DebateSlot, get_redis
from backend.db.models import AgentQuarantine, AuditTrail, CredibilityLog, Investigation, RawLog
from backend.db.session import SessionLocal
from backend.tests.fixtures.auth import auth_headers
from backend.watchdog.credibility import get_crs, reset_agent

client = TestClient(app)
T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)
AGENT = "network_traffic"


def _set_crs(agent_id: str, value: float) -> None:
    """Sets the production CrS directly (the key format is credibility.py's)."""
    get_redis().set(f"verdictchain:crs:{agent_id}", value)


@pytest.fixture(autouse=True)
def _agent_state_is_clean():
    for agent in ("network_traffic", "access_log", "endpoint_behavior"):
        reset_agent(agent)
    get_redis().delete("verdictchain:debate:slot")
    yield
    for agent in ("network_traffic", "access_log", "endpoint_behavior"):
        reset_agent(agent)
    get_redis().delete("verdictchain:debate:slot")


def _count(model) -> int:
    session = SessionLocal()
    try:
        return session.execute(select(func.count()).select_from(model)).scalar_one()
    finally:
        session.close()


def _seed_rows(db_session, *, times: list[int]) -> list[uuid.UUID]:
    rows = [
        RawLog(
            timestamp=T0 + timedelta(seconds=s),
            source="cicids2017",
            event_type="network_flow",
            host_id="10.0.0.5",
            raw_fields={"Destination Port": 445},
            ground_truth_label="DDoS",
        )
        for s in times
    ]
    db_session.add_all(rows)
    db_session.commit()
    return [r.row_id for r in rows]


def _inject(kind: str, *, rounds: int = 1, role: str = "secops_lead", agent: str = AGENT, headers=None):
    return client.post(
        f"/agents/{agent}/fault-injection",
        json={"kind": kind, "rounds": rounds},
        headers=headers or auth_headers(role),
    )


# --- fault injection ----------------------------------------------------------------------------


def test_fault_injection_requires_the_capability(db_session):
    resp = _inject("ghost_row", role="forensic_analyst")
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Missing capability: override_fault_weights"


def test_unknown_kind_and_rounds_out_of_range_are_422(db_session):
    headers = auth_headers("secops_lead")
    assert _inject("bogus_kind", headers=headers).status_code == 422
    assert _inject("ghost_row", rounds=0, headers=headers).status_code == 422
    assert _inject("ghost_row", rounds=7, headers=headers).status_code == 422


def test_an_unknown_agent_is_404(db_session):
    resp = _inject("ghost_row", agent="sentinel_omega")
    assert resp.status_code == 404


def test_red_team_may_run_a_dry_run(db_session):
    resp = _inject("ghost_row", role="red_team_auditor")
    assert resp.status_code == 200
    assert resp.json()["dry_run"] is True


def test_a_ghost_row_dry_run_leaves_production_state_unchanged(db_session):
    _seed_rows(db_session, times=[0, 1])
    _set_crs(AGENT, 0.8)
    headers = auth_headers("secops_lead")  # the login writes its own audit entry, so log in first
    creds_before = _count(CredibilityLog)
    investigations_before = _count(Investigation)
    audit_before = _count(AuditTrail)

    resp = _inject("ghost_row", rounds=4, headers=headers)
    assert resp.status_code == 200
    body = resp.json()

    assert body["production_crs_unchanged"] is True
    assert body["production_crs_before"] == body["production_crs_after"] == 0.8
    assert get_crs(AGENT) == 0.8  # the production score is still what it was
    assert _count(CredibilityLog) == creds_before
    assert _count(Investigation) == investigations_before
    assert _count(AuditTrail) == audit_before + 1  # exactly one new entry: the fault injection itself

    session = SessionLocal()
    try:
        entry = session.execute(select(AuditTrail).order_by(AuditTrail.seq.desc()).limit(1)).scalar_one()
    finally:
        session.close()
    assert entry.action == "byzantine_fault_injected"
    assert entry.investigation_id is None
    assert entry.detail["dry_run"] is True

    assert body["citation"]["status"] == "INVALID_ROW"
    assert body["citation"]["reason"] == "row_not_found"
    assert body["projected_match_rate"] == 0.0
    assert body["eta"] == 0.20
    assert body["isolation_threshold"] == 0.30
    assert len(body["projected_trajectory"]) == 4
    assert body["projected_trajectory"][0]["projected_crs_before"] == 0.8
    assert body["projected_trajectory"][0]["projected_crs_after"] == pytest.approx(0.8 * (1 - 0.20))


def test_the_projection_isolates_after_three_rounds_from_the_starting_value(db_session):
    _set_crs(AGENT, 0.5)
    body = _inject("ghost_row", rounds=6).json()
    trajectory = body["projected_trajectory"]
    # 0.5 -> 0.400 -> 0.320 -> 0.256 with no verified citations (eta 0.20, threshold 0.30).
    assert [round(p["projected_crs_after"], 3) for p in trajectory[:3]] == [0.4, 0.32, 0.256]
    assert [p["projected_isolated"] for p in trajectory] == [False, False, True, True, True, True]
    assert body["would_isolate_at_round"] == 3
    assert get_crs(AGENT) == 0.5


def test_a_projection_that_never_isolates_says_so(db_session):
    _set_crs(AGENT, 0.9)
    body = _inject("ghost_row", rounds=2).json()
    assert body["would_isolate_at_round"] is None
    assert all(p["projected_isolated"] is False for p in body["projected_trajectory"])


def test_value_mismatch_cites_the_newest_row_of_the_domain(db_session):
    older, newest = _seed_rows(db_session, times=[0, 60])
    body = _inject("value_mismatch").json()
    assert body["citation"]["row_id"] == str(newest)
    assert body["citation"]["row_id"] != str(older)
    assert body["citation"]["status"] == "DISCREPANCY"
    assert body["citation"]["reason"] == "value_mismatch"


def test_value_mismatch_with_no_domain_rows_is_404(db_session):
    resp = _inject("value_mismatch")
    assert resp.status_code == 404


def test_a_malformed_row_id_is_an_invalid_row(db_session):
    body = _inject("malformed_row_id").json()
    assert body["citation"]["row_id"] == "not-a-uuid"
    assert body["citation"]["status"] == "INVALID_ROW"
    assert body["citation"]["reason"] == "malformed_row_id"


def test_fault_injection_is_limited_to_ten_per_minute_per_analyst(db_session):
    headers = auth_headers("secops_lead")
    codes = [_inject("ghost_row", headers=headers).status_code for _ in range(11)]
    assert codes[:10] == [200] * 10
    assert codes[10] == 429


# --- quarantine and restore ----------------------------------------------------------------------


def _quarantine(agent: str, reason: str, *, headers) -> object:
    return client.post(f"/agents/{agent}/quarantine", json={"reason": reason}, headers=headers)


def _restore(agent: str, note: str, *, headers) -> object:
    return client.post(f"/agents/{agent}/restore", json={"note": note}, headers=headers)


def _quarantine_row(agent: str) -> AgentQuarantine:
    session = SessionLocal()
    try:
        row = session.get(AgentQuarantine, agent)
        session.expunge(row)
        return row
    finally:
        session.close()


def _audit_entries(action: str) -> list[AuditTrail]:
    session = SessionLocal()
    try:
        return list(
            session.execute(select(AuditTrail).where(AuditTrail.action == action).order_by(AuditTrail.seq))
            .scalars()
            .all()
        )
    finally:
        session.close()


def test_quarantine_requires_the_capability(db_session):
    resp = _quarantine(AGENT, "suspicious theories", headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Missing capability: quarantine_agent"
    resp = _restore(AGENT, "reviewed", headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 403


def test_quarantine_then_restore_is_audited_with_the_previous_crs_and_resets_to_half(db_session):
    headers = auth_headers("watchdog_supervisor")
    _set_crs(AGENT, 0.2)

    quarantined = _quarantine(AGENT, "suspected stale citations", headers=headers)
    assert quarantined.status_code == 200
    assert quarantined.json()["active"] is True
    assert quarantined.json()["previous_crs"] == 0.2
    assert _quarantine_row(AGENT).active is True
    [entry] = _audit_entries("agent_quarantined")
    assert entry.detail["agent_id"] == AGENT
    assert entry.detail["previous_crs"] == 0.2

    restored = _restore(AGENT, "reviewed the citations", headers=headers)
    assert restored.status_code == 200
    assert restored.json()["active"] is False
    assert restored.json()["previous_crs"] == 0.2
    assert restored.json()["crs_now"] == 0.5
    assert _quarantine_row(AGENT).active is False
    assert get_crs(AGENT) == 0.5  # reset_agent: a restored agent starts from the neutral score
    [entry] = _audit_entries("agent_restored")
    assert entry.detail["previous_crs"] == 0.2
    assert entry.detail["note"] == "reviewed the citations"


def test_quarantining_twice_and_restoring_a_free_agent_are_409(db_session):
    headers = auth_headers("secops_lead")
    assert _restore(AGENT, "not quarantined", headers=headers).status_code == 409
    assert _quarantine(AGENT, "first reason", headers=headers).status_code == 200
    second = _quarantine(AGENT, "second reason", headers=headers)
    assert second.status_code == 409
    assert "already quarantined" in second.json()["detail"]


def test_quarantine_and_restore_are_refused_while_a_debate_holds_the_slot(db_session):
    headers = auth_headers("secops_lead")
    running = str(uuid.uuid4())
    slot = DebateSlot()
    assert slot.acquire()
    slot.bind(running)
    try:
        quarantine = _quarantine(AGENT, "during a debate", headers=headers)
        assert quarantine.status_code == 409
        assert running in quarantine.json()["detail"]

        session = SessionLocal()
        try:
            session.get(AgentQuarantine, AGENT).active = True
            session.commit()
        finally:
            session.close()
        restore = _restore(AGENT, "during a debate", headers=headers)
        assert restore.status_code == 409
    finally:
        slot.release()
    assert _quarantine_row(AGENT).active is True  # the refused restore changed nothing
    assert _restore(AGENT, "after the debate", headers=headers).status_code == 200


def test_an_unknown_agent_cannot_be_quarantined(db_session):
    resp = _quarantine("sentinel_omega", "not an agent", headers=auth_headers("secops_lead"))
    assert resp.status_code == 404


@pytest.mark.parametrize("reason", ["ab", "x" * 501])
def test_quarantine_reason_length_is_bounded(db_session, reason):
    resp = _quarantine(AGENT, reason, headers=auth_headers("secops_lead"))
    assert resp.status_code == 422
