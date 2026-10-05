import uuid

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError

from backend.api.rbac import ROLES
from backend.db.models import (
    AgentQuarantine,
    Analyst,
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    RawLog,
    ResponseAction,
    RuntimeSettings,
)
from backend.db.session import engine

EXPECTED_TABLES = {
    "raw_logs",
    "investigations",
    "debate_transcripts",
    "credibility_log",
    "response_actions",
    "model_versions",
    "audit_trail",
    "analyst_feedback",
    "analysts",
    "runtime_settings",
    "agent_quarantine",
}


def test_all_tables_exist():
    inspector = inspect(engine)
    assert EXPECTED_TABLES.issubset(set(inspector.get_table_names()))


def test_raw_log_insert_and_query(db_session):
    log = RawLog(
        timestamp="2026-01-01T00:00:00+00:00",
        source="cicids2017",
        event_type="network_flow",
        raw_fields={"destination_port": 445},
    )
    db_session.add(log)
    db_session.commit()

    fetched = db_session.get(RawLog, log.row_id)
    assert fetched is not None
    assert fetched.raw_fields["destination_port"] == 445
    assert fetched.row_id is not None  # gen_random_uuid() populated it server-side


def test_investigation_default_status(db_session):
    inv = Investigation(trigger_type="continuous")
    db_session.add(inv)
    db_session.commit()
    db_session.refresh(inv)
    assert inv.status == "investigating"


def test_debate_transcript_fk_and_credibility_log(db_session):
    inv = Investigation(trigger_type="manual", scenario_label="ddos")
    db_session.add(inv)
    db_session.flush()

    dt = DebateTranscript(
        investigation_id=inv.investigation_id,
        round=1,
        agent_id="network_traffic",
        theory="Traffic spike suggests DDoS.",
        confidence=0.6,
        cited_evidence=[{"row_id": str(uuid.uuid4()), "field": "flow_bytes_s", "value": "9999"}],
    )
    cl = CredibilityLog(
        investigation_id=inv.investigation_id,
        agent_id="network_traffic",
        round=1,
        crs_before=0.5,
        crs_after=0.5575,
        verification_match_rate=1.0,
    )
    db_session.add_all([dt, cl])
    db_session.commit()

    assert dt.investigation_id == inv.investigation_id
    assert cl.isolated is False


def test_response_actions_is_simulated_cannot_be_false(db_session):
    inv = Investigation(trigger_type="manual")
    db_session.add(inv)
    db_session.flush()

    bad = ResponseAction(
        investigation_id=inv.investigation_id,
        action_type="lock_account",
        target="jdoe",
        is_simulated=False,
    )
    db_session.add(bad)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_response_actions_default_is_simulated_true(db_session):
    inv = Investigation(trigger_type="manual")
    db_session.add(inv)
    db_session.flush()

    action = ResponseAction(
        investigation_id=inv.investigation_id, action_type="trigger_audit", target="system"
    )
    db_session.add(action)
    db_session.commit()
    db_session.refresh(action)
    assert action.is_simulated is True


def test_audit_seq_is_a_database_assigned_unique_identity(db_session):
    db_session.add(AuditTrail(actor="system", action="login", entry_hash="x"))
    db_session.commit()
    entry = db_session.query(AuditTrail).one()
    assert isinstance(entry.seq, int) and entry.seq >= 1

    indexes = {ix["name"]: ix for ix in inspect(engine).get_indexes("audit_trail")}
    assert indexes["uq_audit_trail_seq"]["unique"] is True
    assert indexes["uq_audit_trail_seq"]["column_names"] == ["seq"]


def test_runtime_settings_is_seeded_with_the_defaults(db_session):
    row = db_session.get(RuntimeSettings, 1)
    assert row is not None
    assert (row.eta, row.isolation_threshold, row.verdict_confidence_threshold) == (0.15, 0.30, 0.80)
    assert row.intake_paused is False


def test_runtime_settings_rejects_out_of_range_eta(db_session):
    # The CHECK fires on the UPDATE itself, not at COMMIT.
    with pytest.raises(IntegrityError):
        db_session.execute(text("UPDATE runtime_settings SET eta = 0.9 WHERE id = 1"))
    db_session.rollback()


def test_runtime_settings_is_a_singleton(db_session):
    db_session.add(RuntimeSettings(id=2))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_agent_quarantine_is_seeded_with_three_inactive_agents(db_session):
    rows = db_session.query(AgentQuarantine).order_by(AgentQuarantine.agent_id).all()
    assert [(r.agent_id, r.active) for r in rows] == [
        ("access_log", False),
        ("endpoint_behavior", False),
        ("network_traffic", False),
    ]


def test_agent_quarantine_rejects_an_unknown_agent(db_session):
    db_session.add(AgentQuarantine(agent_id="rogue_agent"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_analyst_role_defaults_to_forensic_analyst(db_session):
    db_session.add(Analyst(username="role_default_user", password_hash="x"))
    db_session.commit()
    assert db_session.query(Analyst).one().role == "forensic_analyst"


def test_analyst_role_check_accepts_every_rbac_role_and_rejects_others(db_session):
    for index, role in enumerate(ROLES):
        db_session.add(Analyst(username=f"role_user_{index}", password_hash="x", role=role))
    db_session.commit()
    assert db_session.query(Analyst).count() == len(ROLES)

    db_session.add(Analyst(username="root_user", password_hash="x", role="root"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_investigation_meta_columns_and_noise_check(db_session):
    inv = Investigation(trigger_type="manual")
    db_session.add(inv)
    db_session.commit()
    db_session.refresh(inv)
    assert inv.noise_pct == 0
    assert inv.effective_noise_pct is None
    assert inv.primary_agent is None

    db_session.add(Investigation(trigger_type="manual", noise_pct=10))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_meta_and_query_indexes_exist():
    inspector = inspect(engine)
    names = {ix["name"] for ix in inspector.get_indexes("investigations")}
    assert {"idx_investigations_created_at", "idx_investigations_status"} <= names
    cred = {ix["name"]: ix["column_names"] for ix in inspector.get_indexes("credibility_log")}
    assert cred["idx_credibility_log_agent_created"] == ["agent_id", "created_at"]
