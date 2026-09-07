from backend.agents.schemas import AgentResponse
from backend.debate.verdict import aggregate_verdict, classify_theory


def _resp(agent_id: str, theory: str, confidence: float) -> AgentResponse:
    return AgentResponse(
        agent_id=agent_id,
        theory=theory,
        confidence=confidence,
        cited_evidence=[{"row_id": "r1", "field": "f", "value": "v"}],
        round=3,
    )


def test_classify_theory_ddos():
    assert classify_theory("Traffic spike suggests a DDoS flood.") == "ddos"


def test_classify_theory_benign():
    assert classify_theory("No anomaly, normal traffic.") == "benign"


def test_classify_theory_unclassified_when_no_keywords_match():
    assert classify_theory("xyz qwerty unrelated text") == "unclassified"


def test_aggregate_verdict_majority_class():
    responses = [
        _resp("network_traffic", "Clear DDoS flood pattern.", 0.9),
        _resp("access_log", "DDoS-like volumetric spike observed too.", 0.6),
        _resp("endpoint_behavior", "No anomaly, normal login.", 0.95),
    ]
    verdict = aggregate_verdict(responses)
    assert verdict["verdict_class"] == "ddos"
    assert verdict["status"] == "verdict_reached"
    assert 0.6 <= verdict["verdict_confidence"] <= 0.9
    assert len(verdict["supporting_evidence"]) == 2  # only the 2 ddos-voting agents


def test_aggregate_verdict_all_benign():
    responses = [
        _resp("network_traffic", "No anomaly, normal traffic.", 0.9),
        _resp("access_log", "Normal typical activity.", 0.8),
        _resp("endpoint_behavior", "No evidence of misuse.", 0.85),
    ]
    verdict = aggregate_verdict(responses)
    assert verdict["verdict_class"] == "benign"
    assert verdict["status"] == "verdict_reached"


def test_aggregate_verdict_tie_is_ambiguous():
    responses = [
        _resp("network_traffic", "Port scan reconnaissance detected.", 0.7),
        _resp("access_log", "Brute force credential guessing pattern.", 0.7),
        _resp("endpoint_behavior", "No evidence of misuse.", 0.5),
    ]
    verdict = aggregate_verdict(responses)
    assert verdict["verdict_class"] == "ambiguous"
    assert verdict["status"] == "ambiguous"
