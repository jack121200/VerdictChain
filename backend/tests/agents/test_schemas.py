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


def _payload(**extra) -> dict:
    return {
        "agent_id": "access_log",
        "theory": "SUPPORT: the same user shows both.",
        "confidence": 0.6,
        "cited_evidence": [{"row_id": "a", "field": "b", "value": "c"}],
        "round": 2,
        **extra,
    }


def test_the_two_stated_fields_are_optional_and_default_to_none():
    resp = AgentResponse.model_validate(_payload())

    assert resp.stance is None and resp.vote_class is None


@pytest.mark.parametrize(
    ("written", "read"),
    [
        ("insider_file_exfiltration", "insider_file_exfiltration"),
        ("DDoS", "ddos"),
        ("  Port Scan ", "port_scan"),
        ("brute-force", "brute_force"),
        ("botnet C2", "botnet_c2"),
        ("benign", "benign"),
        ("ambiguous", "ambiguous"),
    ],
)
def test_a_stated_class_is_read_leniently(written, read):
    assert AgentResponse.model_validate(_payload(vote_class=written)).vote_class == read


@pytest.mark.parametrize(
    "written", ["", "attack", "benign activity", "<one class from the list>", 3, ["ddos"], None]
)
def test_a_class_that_is_not_on_the_list_is_dropped_not_rejected(written):
    """A model's slip here must never cost a debate: the server then reads the theory text instead."""
    assert AgentResponse.model_validate(_payload(vote_class=written)).vote_class is None


@pytest.mark.parametrize(
    ("written", "read"),
    [
        ("CHALLENGE", "CHALLENGE"),
        ("support", "SUPPORT"),
        (" Revise ", "REVISE"),
        (None, None),
        ("AGREE", None),
        (1, None),
    ],
)
def test_a_stated_stance_is_read_leniently(written, read):
    assert AgentResponse.model_validate(_payload(stance=written)).stance == read


def test_the_eight_classes_are_the_eight_verdict_classes_of_the_project():
    from backend.agents.schemas import VOTE_CLASSES

    assert set(VOTE_CLASSES) == {
        "ddos",
        "port_scan",
        "brute_force",
        "botnet_c2",
        "insider_file_exfiltration",
        "insider_logon_anomaly",
        "benign",
        "ambiguous",
    }


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
