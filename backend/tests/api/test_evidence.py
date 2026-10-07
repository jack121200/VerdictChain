"""Evidence bundle and sign-off (plan section 3.4): canonical hash, no labels, RBAC, status gate, audit append
and signature staleness.
"""

import hashlib
import json
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from backend.api.main import app
from backend.api.routes.evidence import SIGN_NOTICE, bundle_sha256, canonical_bytes
from backend.db.audit import find_first_break
from backend.db.models import AuditTrail
from backend.db.session import SessionLocal
from backend.tests.fixtures.read_seed import (
    add_action,
    add_credibility,
    add_investigation,
    add_raw,
    add_transcript,
    audit,
    bearer_for,
    cite,
)

client = TestClient(app)
SECRET_LABEL = "insider_scenario_3"


def _verdict_with_evidence(db_session, status="verdict_reached"):
    inv = add_investigation(
        db_session,
        status=status,
        verdict_class="insider_logon_anomaly",
        confidence=0.85,
        scenario_label=SECRET_LABEL,
        primary_agent="endpoint_behavior",
    )
    row = add_raw(
        db_session, source="cert_r4.2_logon", event_type="logon", user_id="U7", raw_fields={"off_hours": 1}
    )
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="endpoint_behavior",
        theory="CHALLENGE: off-hours logon anomaly",
        cited=[cite(row, "off_hours", "1")],
        provider="gemini",
    )
    add_credibility(
        db_session,
        inv.investigation_id,
        agent_id="endpoint_behavior",
        round_no=1,
        before=0.5,
        after=0.575,
        rate=1.0,
    )
    add_action(db_session, inv.investigation_id, action_type="lock_account", target="U7")
    db_session.commit()
    return inv


def _audit_head():
    session = SessionLocal()
    try:
        return session.execute(select(func.max(AuditTrail.seq))).scalar_one()
    finally:
        session.close()


def test_bundle_hash_matches_the_canonical_form(db_session):
    inv = _verdict_with_evidence(db_session)

    resp = client.get(
        f"/investigations/{inv.investigation_id}/evidence-bundle", headers=bearer_for("forensic_analyst")
    )

    assert resp.status_code == 200
    body = resp.json()
    expected = hashlib.sha256(
        json.dumps(body["bundle"], sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
    assert body["bundle_sha256"] == expected
    assert bundle_sha256(body["bundle"]) == body["bundle_sha256"]
    assert canonical_bytes(body["bundle"]).startswith(b"{")


def test_bundle_has_the_expected_sections_and_no_labels(db_session):
    inv = _verdict_with_evidence(db_session)

    body = client.get(
        f"/investigations/{inv.investigation_id}/evidence-bundle", headers=bearer_for("forensic_analyst")
    ).json()

    bundle = body["bundle"]
    assert set(bundle) == {"investigation_id", "verdict", "transcript", "credibility", "actions", "citations"}
    assert bundle["verdict"]["verdict_class"] == "insider_logon_anomaly"
    assert bundle["transcript"][0]["provider"] == "gemini"
    assert bundle["citations"]["verified"] == 1
    assert bundle["actions"][0]["is_simulated"] is True
    text = str(body)
    assert SECRET_LABEL not in text
    assert "scenario_label" not in text
    assert "ground_truth_label" not in text


def test_bundle_is_deterministic_across_reads(db_session):
    inv = _verdict_with_evidence(db_session)
    headers = bearer_for("forensic_analyst")

    first = client.get(f"/investigations/{inv.investigation_id}/evidence-bundle", headers=headers).json()
    second = client.get(f"/investigations/{inv.investigation_id}/evidence-bundle", headers=headers).json()

    assert first["bundle_sha256"] == second["bundle_sha256"]


def test_sign_appends_an_audit_entry_last_and_returns_the_notice(db_session):
    inv = _verdict_with_evidence(db_session)
    headers = bearer_for("secops_lead")

    resp = client.post(f"/investigations/{inv.investigation_id}/sign", headers=headers)

    assert resp.status_code == 201
    body = resp.json()
    assert body["notice"] == SIGN_NOTICE
    assert body["notice"] == (
        "Audited acknowledgement in the hash-chained audit trail. "
        "This is not a cryptographic digital signature."
    )
    assert body["signed_by"]
    assert body["signed_at"]

    session = SessionLocal()
    try:
        entry = session.execute(select(AuditTrail).where(AuditTrail.seq == body["audit_seq"])).scalar_one()
        assert entry.action == "evidence_bundle_signed"
        assert entry.investigation_id == inv.investigation_id
        assert entry.entry_hash == body["entry_hash"]
        assert entry.detail["bundle_sha256"] == body["bundle_sha256"]
        assert entry.seq == session.execute(select(func.max(AuditTrail.seq))).scalar_one()
        everything = list(session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars())
        assert find_first_break(everything) is None
    finally:
        session.close()


def test_signature_is_listed_then_goes_stale_when_the_bundle_changes(db_session):
    inv = _verdict_with_evidence(db_session)
    headers = bearer_for("secops_lead")
    signed = client.post(f"/investigations/{inv.investigation_id}/sign", headers=headers).json()

    before = client.get(f"/investigations/{inv.investigation_id}/evidence-bundle", headers=headers).json()
    assert before["signatures"] == [
        {
            "signed_by": signed["signed_by"],
            "signed_at": signed["signed_at"],
            "bundle_sha256": signed["bundle_sha256"],
            "still_matches": True,
        }
    ]

    session = SessionLocal()
    try:
        add_action(session, inv.investigation_id, action_type="trigger_audit", target="U7")
        session.commit()
    finally:
        session.close()

    after = client.get(f"/investigations/{inv.investigation_id}/evidence-bundle", headers=headers).json()
    assert after["bundle_sha256"] != signed["bundle_sha256"]
    assert after["signatures"][0]["still_matches"] is False


def test_forensic_analyst_cannot_sign(db_session):
    inv = _verdict_with_evidence(db_session)
    head_before = _audit_head()

    resp = client.post(f"/investigations/{inv.investigation_id}/sign", headers=bearer_for("forensic_analyst"))

    assert resp.status_code == 403
    assert resp.json()["detail"] == "Missing capability: sign_evidence_bundle"
    assert _audit_head() == head_before


def test_supervisor_can_sign(db_session):
    inv = _verdict_with_evidence(db_session)

    resp = client.post(
        f"/investigations/{inv.investigation_id}/sign", headers=bearer_for("watchdog_supervisor")
    )

    assert resp.status_code == 201


def test_sign_requires_a_terminal_status(db_session):
    inv = _verdict_with_evidence(db_session, status="investigating")
    head_before = _audit_head()

    resp = client.post(f"/investigations/{inv.investigation_id}/sign", headers=bearer_for("secops_lead"))

    assert resp.status_code == 409
    assert _audit_head() == head_before


def test_sign_allows_contained_and_ambiguous(db_session):
    contained = _verdict_with_evidence(db_session, status="contained")
    ambiguous = add_investigation(db_session, status="ambiguous", verdict_class="ambiguous", confidence=0.5)
    db_session.commit()
    headers = bearer_for("secops_lead")

    assert (
        client.post(f"/investigations/{contained.investigation_id}/sign", headers=headers).status_code == 201
    )
    assert (
        client.post(f"/investigations/{ambiguous.investigation_id}/sign", headers=headers).status_code == 201
    )


def test_unknown_investigation_is_404(db_session):
    headers = bearer_for("secops_lead")

    assert client.get(f"/investigations/{uuid.uuid4()}/evidence-bundle", headers=headers).status_code == 404
    assert client.post(f"/investigations/{uuid.uuid4()}/sign", headers=headers).status_code == 404


def test_signature_history_comes_from_the_audit_chain(db_session):
    """A signature recorded directly in the audit trail (for example by an earlier run) is listed too."""
    inv = _verdict_with_evidence(db_session)
    headers = bearer_for("forensic_analyst")
    digest = client.get(f"/investigations/{inv.investigation_id}/evidence-bundle", headers=headers).json()[
        "bundle_sha256"
    ]
    audit(
        db_session,
        actor="lead_user",
        action="evidence_bundle_signed",
        detail={"bundle_sha256": digest, "signed_at": "2026-01-15T12:00:00+00:00"},
        investigation_id=inv.investigation_id,
    )
    db_session.commit()

    signatures = client.get(
        f"/investigations/{inv.investigation_id}/evidence-bundle", headers=headers
    ).json()["signatures"]

    assert signatures == [
        {
            "signed_by": "lead_user",
            "signed_at": "2026-01-15T12:00:00+00:00",
            "bundle_sha256": digest,
            "still_matches": True,
        }
    ]


def test_bundle_hash_writes_integral_floats_as_integers(db_session):
    """JavaScript writes 1.0 as 1, so the server must hash 1 as well (the browser recomputes the hash)."""
    inv = add_investigation(db_session, status="verdict_reached", verdict_class="ddos", confidence=1.0)
    row = add_raw(db_session, raw_fields={"Destination Port": 80})
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="network_traffic",
        theory="SUPPORT: ddos flood",
        confidence=1.0,
        cited=[cite(row, "Destination Port", "80")],
    )
    db_session.commit()

    body = client.get(
        f"/investigations/{inv.investigation_id}/evidence-bundle", headers=bearer_for("forensic_analyst")
    ).json()

    compact = json.dumps(body["bundle"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    assert body["bundle"]["verdict"]["verdict_confidence"] == 1
    assert '"verdict_confidence":1}' in compact
    assert "1.0" not in compact
    assert body["bundle_sha256"] == hashlib.sha256(compact.encode("utf-8")).hexdigest()
