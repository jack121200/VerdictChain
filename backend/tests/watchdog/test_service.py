import uuid

from sqlalchemy import select

from backend.agents.schemas import AgentResponse
from backend.db.models import CredibilityLog, Investigation, RawLog
from backend.watchdog.service import score_agent_round


def test_score_agent_round_persists_credibility_log(db_session):
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

    agent_id = f"test_agent_{uuid.uuid4().hex[:8]}"
    response = AgentResponse(
        agent_id="network_traffic",
        theory="Test theory.",
        confidence=0.7,
        cited_evidence=[{"row_id": str(row.row_id), "field": "Destination Port", "value": "445"}],
        round=1,
    )
    # score_agent_round uses response.agent_id for the Redis key - patch it to
    # a unique test id so Redis state can't leak between test runs
    response.agent_id = agent_id

    result = score_agent_round(investigation.investigation_id, round_no=1, response=response)

    assert result["verification_match_rate"] == 1.0
    assert result["isolated"] is False

    log = db_session.execute(
        select(CredibilityLog).where(CredibilityLog.agent_id == agent_id)
    ).scalar_one()
    assert log.round == 1
    assert log.verification_match_rate == 1.0
    assert log.isolated is False
