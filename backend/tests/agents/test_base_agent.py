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
    text, provider = call_with_fallback(primary, fallback, "sys", "user", retry_delay_s=0)
    assert text == "fallback text"


class FlakyThenOkProvider:
    """Fails its first N calls, then succeeds - simulates a transient 429/503
    that clears up within a couple of retries, observed for real in this
    session (Gemini 503 and Groq 429 back to back on the same debate round).
    """

    def __init__(self, name: str, fail_times: int, response: str):
        self.name = name
        self._fail_times = fail_times
        self._response = response
        self.call_count = 0

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.call_count += 1
        if self.call_count <= self._fail_times:
            raise RuntimeError("transient failure")
        return self._response


def test_call_with_fallback_retries_both_providers_before_succeeding():
    """Both providers fail once (their first attempt each), then primary
    succeeds on its retry - exactly the scenario that broke the live debate
    smoke test before this fix.
    """
    primary = FlakyThenOkProvider("primary", fail_times=1, response="primary retried")
    fallback = FlakyThenOkProvider("fallback", fail_times=1, response="fallback retried")
    text, provider = call_with_fallback(primary, fallback, "sys", "user", retry_delay_s=0)
    assert text == "primary retried"
    assert provider == "primary"
    assert primary.call_count == 2
    assert fallback.call_count == 1


def test_call_with_fallback_raises_after_exhausting_all_retries():
    primary = FakeProvider(error=RuntimeError("primary down"))
    fallback = FakeProvider(error=RuntimeError("fallback down"))
    with pytest.raises(RuntimeError):
        call_with_fallback(primary, fallback, "sys", "user", retry_delay_s=0)


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


def test_parse_and_validate_backfills_missing_round_field():
    """Observed live: Groq's openai/gpt-oss-20b sometimes omits "round" even
    though it's told what round it is. We know the correct value independently,
    so backfill rather than aborting the whole debate over a dropped field.
    """
    payload = {k: v for k, v in VALID_PAYLOAD.items() if k != "round"}
    resp = parse_and_validate(json.dumps(payload), "network_traffic", expected_round=2, valid_row_ids={"row-1"})
    assert resp.round == 2


def test_parse_and_validate_still_rejects_a_wrong_round_value():
    """Backfill only fires when the field is ABSENT - a present-but-wrong value
    must still fail, since that indicates real model confusion, not omission.
    """
    payload = dict(VALID_PAYLOAD, round=99)
    with pytest.raises(InvalidAgentResponse):
        parse_and_validate(json.dumps(payload), "network_traffic", expected_round=1, valid_row_ids={"row-1"})


def test_parse_and_validate_rejects_empty_cited_evidence():
    payload = dict(VALID_PAYLOAD, cited_evidence=[])
    with pytest.raises(InvalidAgentResponse):
        parse_and_validate(json.dumps(payload), "network_traffic", 1, {"row-1"})
