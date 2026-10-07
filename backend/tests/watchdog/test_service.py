import uuid

import pytest
from sqlalchemy import select

from backend.agents.schemas import AgentResponse
from backend.db.audit import verify_chain
from backend.db.models import AuditTrail, CredibilityLog, Investigation, RawLog
from backend.watchdog.service import score_agent_round


def _setup(db_session) -> tuple[uuid.UUID, AgentResponse]:
    row = RawLog(
        timestamp="2020-01-01T00:00:00+00:00",
        source="x",
        event_type="network_flow",
        raw_fields={"Destination Port": 445},
        ground_truth_label="benign",
    )
    db_session.add(row)
    db_session.flush()

    investigation = Investigation(trigger_type="manual")
    db_session.add(investigation)
    db_session.flush()
    db_session.commit()

    response = AgentResponse(
        agent_id="network_traffic",
        theory="Test theory.",
        confidence=0.7,
        cited_evidence=[{"row_id": str(row.row_id), "field": "Destination Port", "value": "445"}],
        round=1,
    )
    # score_agent_round uses response.agent_id for the Redis key - patch it to
    # a unique test id so Redis state can't leak between test runs
    response.agent_id = f"test_agent_{uuid.uuid4().hex[:8]}"
    return investigation.investigation_id, response


def test_score_agent_round_persists_credibility_log(db_session):
    investigation_id, response = _setup(db_session)

    result = score_agent_round(investigation_id, round_no=1, response=response)

    assert result["verification_match_rate"] == 1.0
    assert result["isolated"] is False

    log = db_session.execute(
        select(CredibilityLog).where(CredibilityLog.agent_id == response.agent_id)
    ).scalar_one()
    assert log.round == 1
    assert log.verification_match_rate == 1.0
    assert log.isolated is False


def test_score_agent_round_writes_credibility_update_audit_entry(db_session):
    investigation_id, response = _setup(db_session)

    result = score_agent_round(investigation_id, round_no=2, response=response)

    entries = db_session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all()
    assert [e.action for e in entries] == ["credibility_update"]
    entry = entries[0]
    assert entry.actor == "watchdog"
    assert entry.investigation_id == investigation_id
    assert entry.detail["agent_id"] == response.agent_id
    assert entry.detail["round"] == 2
    assert entry.detail["verification_match_rate"] == 1.0
    assert entry.detail["crs_after"] == pytest.approx(result["crs_after"], abs=1e-6)
    assert verify_chain(entries) is True


def test_score_agent_round_passes_eta_and_isolation_threshold_through(db_session):
    investigation_id, response = _setup(db_session)

    # rate 1.0 with eta 0.5: 0.5 * (1 + 0.5) = 0.75, which is below an isolation threshold of 0.9
    result = score_agent_round(
        investigation_id, round_no=1, response=response, eta=0.5, isolation_threshold=0.9
    )

    assert result["crs_after"] == pytest.approx(0.75)
    assert result["isolated"] is True
