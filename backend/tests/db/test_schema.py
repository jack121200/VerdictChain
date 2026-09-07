import uuid

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from backend.db.models import CredibilityLog, DebateTranscript, Investigation, RawLog, ResponseAction
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
