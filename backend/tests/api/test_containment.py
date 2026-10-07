"""Emergency containment and release (plan sections 3.4 and 3.5). The manual path must never call an LLM:
the provider clients and httpx are patched to fail, and the path must still succeed.
"""

import types
import uuid
from datetime import datetime, timezone
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import backend.agents.llm_clients as llm_clients
from backend.api.main import app
from backend.db.audit import verify_chain
from backend.db.models import (
    AgentQuarantine,
    AuditTrail,
    DebateTranscript,
    Investigation,
    RawLog,
    ResponseAction,
)
from backend.db.session import SessionLocal
from backend.self_healing import sandbox
from backend.tests.fixtures.auth import auth_headers

client = TestClient(app)
T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)
HOST = "10.0.0.5"
USER = "jdoe"

EXTERNAL = {
    "network_traffic": "ddos flood detected on the edge",
    "access_log": "ddos flood corroborated by the flow counts",
    "endpoint_behavior": "ddos flood, no logon anomaly",
}
INSIDER = {
    "network_traffic": "benign normal activity",
    "access_log": "unusual data exfiltration of finance files",
    "endpoint_behavior": "unusual data exfiltration after off-hours logons",
}
BENIGN = {agent: "benign normal activity" for agent in EXTERNAL}
AMBIGUOUS = {
    "network_traffic": "ddos flood detected",
    "access_log": "port scan reconnaissance",
    "endpoint_behavior": "benign normal activity",
}


def _seed(db_session, theories: dict[str, str], *, status: str = "verdict_reached") -> uuid.UUID:
    """One investigation with three rounds of transcripts. Round 3 carries the final theories."""
    row = RawLog(
        timestamp=T0,
        source="cicids2017",
        event_type="network_flow",
        user_id=USER,
        host_id=HOST,
        raw_fields={"Destination Port": 445},
        ground_truth_label="DDoS",
    )
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    session = SessionLocal()
    try:
        inv = Investigation(trigger_type="manual", status=status)
        session.add(inv)
        session.commit()
        session.refresh(inv)
        investigation_id = inv.investigation_id
    finally:
        session.close()
    session = SessionLocal()
    try:
        for round_no in (1, 2, 3):
            for agent, theory in theories.items():
                session.add(
                    DebateTranscript(
                        investigation_id=investigation_id,
                        round=round_no,
                        agent_id=agent,
                        theory=theory,
                        confidence=0.9,
                        cited_evidence=[{"row_id": str(row.row_id), "field": "host_id", "value": HOST}],
                        provider="groq",
                    )
                )
        session.commit()
    finally:
        session.close()
    return investigation_id


def _contain(investigation_id, headers):
    return client.post(
        f"/investigations/{investigation_id}/emergency-containment", json={"confirm": True}, headers=headers
    )


def _release(investigation_id, headers):
    return client.post(f"/investigations/{investigation_id}/release-containment", headers=headers)


def _response_actions(investigation_id) -> list[ResponseAction]:
    session = SessionLocal()
    try:
        return list(
            session.execute(
                select(ResponseAction)
                .where(ResponseAction.investigation_id == investigation_id)
                .order_by(ResponseAction.created_at, ResponseAction.id)
            ).scalars()
        )
    finally:
        session.close()


def _audit(investigation_id, action: str | None = None) -> list[AuditTrail]:
    session = SessionLocal()
    try:
        query = (
            select(AuditTrail).where(AuditTrail.investigation_id == investigation_id).order_by(AuditTrail.seq)
        )
        if action is not None:
            query = query.where(AuditTrail.action == action)
        return list(session.execute(query).scalars())
    finally:
        session.close()


def _investigation_status(investigation_id) -> str:
    session = SessionLocal()
    try:
        return session.get(Investigation, investigation_id).status
    finally:
        session.close()


def test_emergency_containment_requires_the_capability(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    resp = _contain(investigation_id, auth_headers("forensic_analyst"))
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Missing capability: trigger_emergency_containment"
    assert _response_actions(investigation_id) == []


def test_release_requires_the_capability(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    resp = _release(investigation_id, auth_headers("forensic_analyst"))
    assert resp.status_code == 403


@pytest.mark.parametrize("body", [{}, {"confirm": False}, {"confirm": True, "is_simulated": False}])
def test_confirm_true_is_required_and_extra_fields_are_refused(db_session, body):
    investigation_id = _seed(db_session, EXTERNAL)
    resp = client.post(
        f"/investigations/{investigation_id}/emergency-containment",
        json=body,
        headers=auth_headers("secops_lead"),
    )
    assert resp.status_code == 422
    assert _response_actions(investigation_id) == []


def test_an_unknown_investigation_is_404(db_session):
    resp = _contain(uuid.uuid4(), auth_headers("secops_lead"))
    assert resp.status_code == 404


def test_an_external_verdict_is_contained_with_simulated_actions_and_audit(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    headers = auth_headers("secops_lead")
    resp = _contain(investigation_id, headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "contained"
    assert body["verdict_class"] == "ddos"
    assert [a["action_type"] for a in body["actions"]] == [
        "block_ip_range",
        "trigger_rate_limiting",
        "trigger_audit",
    ]
    assert {a["target"] for a in body["actions"]} == {HOST}

    actions = _response_actions(investigation_id)
    assert len(actions) == 3
    assert all(a.is_simulated is True for a in actions)
    assert _investigation_status(investigation_id) == "contained"

    per_action = _audit(investigation_id)
    trigger_entries = [e for e in per_action if e.action != "emergency_containment"]
    assert [e.action for e in trigger_entries] == ["block_ip_range", "trigger_rate_limiting", "trigger_audit"]
    assert all(e.detail["trigger"] == "manual_override" for e in trigger_entries)
    assert all(e.detail["is_simulated"] is True for e in trigger_entries)
    summary = _audit(investigation_id, "emergency_containment")
    assert len(summary) == 1
    assert summary[0].actor.startswith("secops_lead_")  # the human who asked, not the sandbox

    session = SessionLocal()
    try:
        chain = list(session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars())
        assert verify_chain(chain)
    finally:
        session.close()

    assert HOST in sandbox._firewall.blocked_ranges


def test_an_insider_verdict_locks_the_account_and_is_audited(db_session):
    investigation_id = _seed(db_session, INSIDER)
    resp = _contain(investigation_id, auth_headers("secops_lead"))
    assert resp.status_code == 200
    assert resp.json()["verdict_class"] == "insider_file_exfiltration"
    actions = {(a.action_type, a.target) for a in _response_actions(investigation_id)}
    assert actions == {("lock_account", USER), ("trigger_audit", USER)}
    assert USER in sandbox._directory_service.locked_accounts


def test_a_supervisor_may_contain(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    assert _contain(investigation_id, auth_headers("watchdog_supervisor")).status_code == 200


def test_a_contained_investigation_cannot_be_contained_again(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    headers = auth_headers("secops_lead")
    assert _contain(investigation_id, headers).status_code == 200
    second = _contain(investigation_id, headers)
    assert second.status_code == 409
    assert "already contained" in second.json()["detail"]
    assert len(_response_actions(investigation_id)) == 3  # nothing written by the refused call


@pytest.mark.parametrize("theories", [BENIGN, AMBIGUOUS], ids=["benign", "ambiguous"])
def test_benign_and_ambiguous_verdicts_have_no_plan(db_session, theories):
    investigation_id = _seed(db_session, theories)
    resp = _contain(investigation_id, auth_headers("secops_lead"))
    assert resp.status_code == 409
    assert "No containment plan" in resp.json()["detail"]
    assert _response_actions(investigation_id) == []


def test_a_verdict_not_yet_reached_is_409(db_session):
    investigation_id = _seed(db_session, EXTERNAL, status="investigating")
    session = SessionLocal()
    try:
        session.query(DebateTranscript).filter(DebateTranscript.round == 3).delete()
        session.commit()
    finally:
        session.close()
    resp = _contain(investigation_id, auth_headers("secops_lead"))
    assert resp.status_code == 409
    assert "not been reached" in resp.json()["detail"]


def test_a_quarantined_contributor_blocks_containment(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    session = SessionLocal()
    try:
        session.get(AgentQuarantine, "access_log").active = True
        session.commit()
    finally:
        session.close()
    resp = _contain(investigation_id, auth_headers("secops_lead"))
    assert resp.status_code == 409
    assert "quarantined: access_log" in resp.json()["detail"]
    assert _response_actions(investigation_id) == []


def test_the_manual_path_never_calls_an_llm(db_session):
    """The provider clients and httpx are patched to fail. Containment and release still succeed, and the
    reasons are the fixed templates.
    """
    investigation_id = _seed(db_session, EXTERNAL)

    def _no_http(*args, **kwargs):
        raise AssertionError("httpx called on the manual path")

    failing_httpx = types.SimpleNamespace(post=_no_http, Response=httpx.Response)
    headers = auth_headers("secops_lead")
    with (
        patch.object(llm_clients, "httpx", failing_httpx),
        patch.object(
            llm_clients.GeminiClient, "complete", side_effect=AssertionError("Gemini called")
        ) as gemini,
        patch.object(llm_clients.GroqClient, "complete", side_effect=AssertionError("Groq called")) as groq,
    ):
        assert _contain(investigation_id, headers).status_code == 200
        assert _release(investigation_id, headers).status_code == 200
    gemini.assert_not_called()
    groq.assert_not_called()
    reasons = [a.reason for a in _response_actions(investigation_id)]
    assert reasons and all(
        r.startswith("Manual containment by") or r.startswith("Containment released by") for r in reasons
    )


def test_every_response_action_is_simulated(db_session):
    investigation_id = _seed(db_session, INSIDER)
    headers = auth_headers("secops_lead")
    _contain(investigation_id, headers)
    _release(investigation_id, headers)
    actions = _response_actions(investigation_id)
    # Containment: lock_account + trigger_audit. Release: release:lock_account (trigger_audit has no inverse).
    assert sorted(a.action_type for a in actions) == ["lock_account", "release:lock_account", "trigger_audit"]
    assert all(a.is_simulated is True for a in actions)


def test_release_reverses_the_containment_and_is_audited(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    headers = auth_headers("secops_lead")
    _contain(investigation_id, headers)
    resp = _release(investigation_id, headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "verdict_reached"
    # trigger_audit records an event and has no inverse, so only the two reversible actions are released.
    assert sorted(a["action_type"] for a in body["released"]) == [
        "release:block_ip_range",
        "release:trigger_rate_limiting",
    ]
    assert _investigation_status(investigation_id) == "verdict_reached"
    assert HOST not in sandbox._firewall.blocked_ranges
    assert HOST not in sandbox._firewall.rate_limited_targets
    assert len(_audit(investigation_id, "containment_released")) == 1


def test_release_when_not_contained_is_409(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    resp = _release(investigation_id, auth_headers("secops_lead"))
    assert resp.status_code == 409


def test_containment_can_run_again_after_a_release(db_session):
    investigation_id = _seed(db_session, EXTERNAL)
    headers = auth_headers("secops_lead")
    assert _contain(investigation_id, headers).status_code == 200
    assert _release(investigation_id, headers).status_code == 200
    again = _contain(investigation_id, headers)
    assert again.status_code == 200
    assert _investigation_status(investigation_id) == "contained"
    assert _release(investigation_id, headers).status_code == 200


def test_the_containment_state_is_derived_from_response_actions(db_session):
    """Removing the investigation's status does not change the answer: response_actions is the record."""
    investigation_id = _seed(db_session, EXTERNAL)
    headers = auth_headers("secops_lead")
    _contain(investigation_id, headers)
    session = SessionLocal()
    try:
        session.get(Investigation, investigation_id).status = "verdict_reached"
        session.commit()
    finally:
        session.close()
    assert _contain(investigation_id, headers).status_code == 409
    assert _release(investigation_id, headers).status_code == 200  # release works from the rows alone
