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


def _split_three_ways() -> list[AgentResponse]:
    return [
        _resp("network_traffic", "Volumetric flood pattern, a DDoS.", 0.88),
        _resp("access_log", "Unusual file access and exfiltration.", 0.86),
        _resp("endpoint_behavior", "Off-hours logon anomaly, an unusual login.", 0.90),
    ]


def test_three_way_split_is_ambiguous_without_a_primary_agent():
    verdict = aggregate_verdict(_split_three_ways())
    assert verdict["verdict_class"] == "ambiguous"
    assert verdict["status"] == "ambiguous"


def test_three_way_split_resolves_to_the_primary_agents_class():
    verdict = aggregate_verdict(_split_three_ways(), primary_agent_id="network_traffic")
    assert verdict["verdict_class"] == "ddos"
    assert verdict["status"] == "verdict_reached"
    assert verdict["contributing_agents"] == ["network_traffic"]
    assert verdict["verdict_confidence"] == 0.88


def test_primary_agent_does_not_override_a_clear_majority():
    responses = [
        _resp("network_traffic", "Clear DDoS flood pattern.", 0.9),
        _resp("access_log", "DDoS-like volumetric spike observed too.", 0.6),
        _resp("endpoint_behavior", "Off-hours logon anomaly, an unusual login.", 0.95),
    ]
    verdict = aggregate_verdict(responses, primary_agent_id="endpoint_behavior")
    assert verdict["verdict_class"] == "ddos"  # two agents agree; the primary does not outvote them


def test_primary_that_cast_no_real_vote_leaves_the_tie_ambiguous():
    responses = [
        _resp("network_traffic", "Port scan reconnaissance detected.", 0.7),
        _resp("access_log", "Brute force credential guessing pattern.", 0.7),
        _resp("endpoint_behavior", "No evidence of misuse.", 0.5),
    ]
    verdict = aggregate_verdict(responses, primary_agent_id="endpoint_behavior")
    assert verdict["verdict_class"] == "ambiguous"
