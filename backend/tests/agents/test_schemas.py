import pytest
from pydantic import ValidationError

from backend.agents.schemas import AgentResponse


def test_valid_response_parses():
    resp = AgentResponse.model_validate(
        {
            "agent_id": "network_traffic",
            "theory": "Traffic spike suggests DDoS.",
            "confidence": 0.8,
            "cited_evidence": [{"row_id": "abc", "field": "Flow Bytes/s", "value": "999999"}],
            "round": 1,
        }
    )
    assert resp.confidence == 0.8
    assert len(resp.cited_evidence) == 1


def test_empty_cited_evidence_rejected():
    with pytest.raises(ValidationError):
        AgentResponse.model_validate(
            {
                "agent_id": "network_traffic",
                "theory": "No evidence at all.",
                "confidence": 0.5,
                "cited_evidence": [],
                "round": 1,
            }
        )


def test_confidence_out_of_range_rejected():
    with pytest.raises(ValidationError):
        AgentResponse.model_validate(
            {
                "agent_id": "network_traffic",
                "theory": "x",
                "confidence": 1.5,
                "cited_evidence": [{"row_id": "a", "field": "b", "value": "c"}],
                "round": 1,
            }
        )
