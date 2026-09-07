import json

import pytest

from backend.agents.base_agent import InvalidAgentResponse, call_with_fallback, parse_and_validate

VALID_PAYLOAD = {
    "agent_id": "network_traffic",
    "theory": "Traffic spike suggests DDoS.",
    "confidence": 0.8,
    "cited_evidence": [{"row_id": "row-1", "field": "Flow Bytes/s", "value": "999999"}],
    "round": 1,
}


class FakeProvider:
    name = "fake"

    def __init__(self, response: str | None = None, error: Exception | None = None):
        self._response = response
        self._error = error

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        if self._error:
            raise self._error
        return self._response


def test_call_with_fallback_uses_primary_on_success():
    primary = FakeProvider(response="primary text")
    fallback = FakeProvider(response="fallback text")
    text, provider = call_with_fallback(primary, fallback, "sys", "user")
    assert text == "primary text"
    assert provider == "fake"


def test_call_with_fallback_falls_back_on_primary_error():
    primary = FakeProvider(error=RuntimeError("rate limited"))
    fallback = FakeProvider(response="fallback text")
    text, provider = call_with_fallback(primary, fallback, "sys", "user")
    assert text == "fallback text"


def test_parse_and_validate_accepts_valid_response():
    resp = parse_and_validate(
        json.dumps(VALID_PAYLOAD),
        expected_agent_id="network_traffic",
        expected_round=1,
        valid_row_ids={"row-1"},
    )
    assert resp.theory == "Traffic spike suggests DDoS."


def test_parse_and_validate_strips_markdown_fence():
    fenced = "```json\n" + json.dumps(VALID_PAYLOAD) + "\n```"
    resp = parse_and_validate(fenced, "network_traffic", 1, {"row-1"})
    assert resp.agent_id == "network_traffic"


def test_parse_and_validate_rejects_malformed_json():
    with pytest.raises(InvalidAgentResponse):
        parse_and_validate("not json at all", "network_traffic", 1, {"row-1"})


def test_parse_and_validate_rejects_fabricated_citation():
    payload = dict(VALID_PAYLOAD, cited_evidence=[{"row_id": "row-999", "field": "x", "value": "y"}])
    with pytest.raises(InvalidAgentResponse, match="not present in this agent's own data slice"):
        parse_and_validate(json.dumps(payload), "network_traffic", 1, valid_row_ids={"row-1"})


def test_parse_and_validate_rejects_wrong_round():
    with pytest.raises(InvalidAgentResponse):
        parse_and_validate(json.dumps(VALID_PAYLOAD), "network_traffic", expected_round=2, valid_row_ids={"row-1"})


def test_parse_and_validate_rejects_empty_cited_evidence():
    payload = dict(VALID_PAYLOAD, cited_evidence=[])
    with pytest.raises(InvalidAgentResponse):
        parse_and_validate(json.dumps(payload), "network_traffic", 1, {"row-1"})
