import json

import httpx
import pytest

from backend.agents import base_agent
from backend.agents.base_agent import InvalidAgentResponse, call_with_retry, parse_and_validate
from backend.agents.llm_clients import OpenAIError, OpenAIUnavailable, ProviderRateLimited

VALID_PAYLOAD = {
    "agent_id": "network_traffic",
    "theory": "Traffic spike suggests DDoS.",
    "confidence": 0.8,
    "cited_evidence": [{"row_id": "row-1", "field": "Flow Bytes/s", "value": "999999"}],
    "round": 1,
}


class Provider:
    """Fails with the given errors in order, then answers."""

    name = "fake"

    def __init__(self, response: str = "ok", errors: list[Exception] | None = None):
        self._response = response
        self._errors = list(errors or [])
        self.calls = 0

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.calls += 1
        if self._errors:
            raise self._errors.pop(0)
        return self._response


def test_call_with_retry_returns_the_text_and_the_provider_name():
    provider = Provider(response="answer")

    assert call_with_retry(provider, "sys", "user") == ("answer", "fake")
    assert provider.calls == 1


def test_a_transient_failure_is_tried_again(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(base_agent.time, "sleep", sleeps.append)
    provider = Provider(response="recovered", errors=[OpenAIUnavailable("503"), httpx.ReadTimeout("slow")])

    text, name = call_with_retry(provider, "sys", "user")

    assert (text, name) == ("recovered", "fake") and provider.calls == 3
    assert sleeps == [5.0, 10.0]  # exponential: 5 s, then 10 s


def test_it_gives_up_after_the_last_round_and_raises_the_last_error(monkeypatch):
    monkeypatch.setattr(base_agent.time, "sleep", lambda seconds: None)
    provider = Provider(errors=[OpenAIUnavailable(f"down {n}") for n in range(10)])

    with pytest.raises(OpenAIUnavailable, match="down 3"):
        call_with_retry(provider, "sys", "user", max_rounds=4)

    assert provider.calls == 4


@pytest.mark.parametrize(
    "error",
    [
        OpenAIError("OpenAI rejected the API key"),
        ProviderRateLimited(
            "openai", 429, None, daily=True
        ),  # the account has no credit: waiting will not help
        RuntimeError("a bug"),
    ],
)
def test_what_waiting_cannot_fix_fails_at_once(monkeypatch, error):
    monkeypatch.setattr(base_agent.time, "sleep", lambda seconds: pytest.fail("must not wait"))
    provider = Provider(errors=[error, error])

    with pytest.raises(type(error)):
        call_with_retry(provider, "sys", "user")

    assert provider.calls == 1


def test_a_rate_limit_waits_for_the_servers_own_hint_when_it_is_longer(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.setattr(base_agent.time, "sleep", sleeps.append)
    provider = Provider(errors=[ProviderRateLimited("openai", 429, retry_after=30.0)])

    text, _ = call_with_retry(provider, "sys", "user")

    assert text == "ok"
    assert sleeps == [30.0]  # the hint (30 s) beats the 5 s base backoff


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


def test_parse_and_validate_backfills_missing_round_field():
    """A model sometimes omits "round" even though it is told what round it is. We know the correct value
    independently, so backfill rather than aborting the whole debate over a dropped field."""
    payload = {k: v for k, v in VALID_PAYLOAD.items() if k != "round"}
    resp = parse_and_validate(
        json.dumps(payload), "network_traffic", expected_round=2, valid_row_ids={"row-1"}
    )
    assert resp.round == 2


def test_the_round_and_agent_are_set_from_what_was_asked_not_from_what_the_model_echoed():
    """Observed live: in round 3 a model copied the example "round": 1 from the schema, and the whole debate
    failed over it. Both fields are bookkeeping the caller knows; the findings (theory, evidence) are kept."""
    payload = dict(VALID_PAYLOAD, round=1, agent_id="access_log")

    resp = parse_and_validate(
        json.dumps(payload), "network_traffic", expected_round=3, valid_row_ids={"row-1"}
    )

    assert (resp.round, resp.agent_id) == (3, "network_traffic")
    assert resp.theory == VALID_PAYLOAD["theory"] and resp.confidence == VALID_PAYLOAD["confidence"]
    assert resp.cited_evidence[0].row_id == "row-1"


def test_what_the_model_found_is_still_checked_whatever_it_echoed():
    wrong_round_and_fabricated = dict(
        VALID_PAYLOAD, round=99, cited_evidence=[{"row_id": "row-999", "field": "x", "value": "y"}]
    )
    with pytest.raises(InvalidAgentResponse, match="not present in this agent's own data slice"):
        parse_and_validate(
            json.dumps(wrong_round_and_fabricated),
            "network_traffic",
            expected_round=1,
            valid_row_ids={"row-1"},
        )


def test_parse_and_validate_rejects_empty_cited_evidence():
    payload = dict(VALID_PAYLOAD, cited_evidence=[])
    with pytest.raises(InvalidAgentResponse):
        parse_and_validate(json.dumps(payload), "network_traffic", 1, {"row-1"})


class Scripted:
    """Answers with the given texts in order and remembers every user prompt it was sent."""

    name = "openai"

    def __init__(self, *answers: str):
        self._answers = list(answers)
        self.prompts: list[str] = []

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.prompts.append(user_prompt)
        return self._answers.pop(0)


def _ask(provider: Scripted):
    return base_agent.ask(
        provider, "sys", "the data slice", agent_id="network_traffic", round_no=1, valid_row_ids={"row-1"}
    )


def test_ask_returns_a_valid_first_answer_with_a_single_call():
    provider = Scripted(json.dumps(VALID_PAYLOAD))

    response, name = _ask(provider)

    assert (response.theory, name) == ("Traffic spike suggests DDoS.", "openai")
    assert len(provider.prompts) == 1


def test_ask_asks_once_more_when_the_first_answer_cites_a_row_outside_the_slice():
    outside = dict(VALID_PAYLOAD, cited_evidence=[{"row_id": "row-999", "field": "x", "value": "y"}])
    provider = Scripted(json.dumps(outside), json.dumps(VALID_PAYLOAD))

    response, _ = _ask(provider)

    assert response.cited_evidence[0].row_id == "row-1"
    assert len(provider.prompts) == 2
    second = provider.prompts[1]
    assert second.startswith("the data slice")  # the same question,
    assert "rejected" in second and "row-999" in second  # plus what was wrong with the first answer


def test_ask_asks_once_more_when_the_first_answer_is_not_json():
    provider = Scripted("Sorry, here is my analysis in prose.", json.dumps(VALID_PAYLOAD))

    response, _ = _ask(provider)

    assert response.agent_id == "network_traffic" and len(provider.prompts) == 2
    assert "not valid JSON" in provider.prompts[1]


def test_ask_gives_up_after_the_second_bad_answer_and_says_what_was_wrong():
    outside = json.dumps(
        dict(VALID_PAYLOAD, cited_evidence=[{"row_id": "row-999", "field": "x", "value": "y"}])
    )
    provider = Scripted(outside, outside, json.dumps(VALID_PAYLOAD))

    with pytest.raises(InvalidAgentResponse, match="row-999"):
        _ask(provider)

    assert len(provider.prompts) == 2  # one re-ask, not a loop


def test_a_cited_value_written_as_a_number_keeps_its_value_and_gets_text_type():
    payload = dict(
        VALID_PAYLOAD,
        confidence="0.9",
        cited_evidence=[
            {"row_id": "row-1", "field": "Idle Max", "value": 0},
            {"row_id": "row-1", "field": "x", "value": 1.5},
        ],
    )

    resp = parse_and_validate(json.dumps(payload), "network_traffic", 1, {"row-1"})

    assert [e.value for e in resp.cited_evidence] == ["0", "1.5"] and resp.confidence == 0.9
