"""The OpenAI client, the project's only LLM provider: the request it sends, what it refuses, how it counts
and limits tokens. No test reaches the network: httpx.post is replaced by a function that returns a canned
response."""

import httpx
import pytest
import redis

from backend.agents import llm_clients, openai_usage
from backend.agents.llm_clients import (
    OPENAI_URL,
    OpenAIClient,
    OpenAIError,
    OpenAIUnavailable,
    ProviderRateLimited,
)
from backend.agents.openai_usage import OpenAIBudgetExceeded
from backend.config import settings

SECRET = "sk-test-secret-0123456789"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.setattr(settings, "openai_daily_token_limit", 10_000)
    monkeypatch.setattr(llm_clients, "_throttle", lambda: None)
    llm_clients._refused.clear()
    monkeypatch.setattr(llm_clients, "_exhausted_until", 0.0)
    openai_usage.reset()
    yield
    openai_usage.reset()
    llm_clients._refused.clear()


class FakeHttp:
    """Replaces httpx.post: records every request and answers from a list of canned responses."""

    def __init__(self, monkeypatch, *responses, error=None):
        self.requests: list[dict] = []
        self.responses = list(responses) or [(200, _completion("{}"), {})]
        self.error = error
        monkeypatch.setattr(httpx, "post", self)

    def __call__(self, url, **kwargs):
        self.requests.append({"url": url, **kwargs})
        if self.error is not None:
            raise self.error
        status, body, headers = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        return httpx.Response(status, json=body, headers=headers, request=httpx.Request("POST", url))


def _completion(content, prompt_tokens=120, completion_tokens=30, finish="stop"):
    usage = {"prompt_tokens": prompt_tokens, "completion_tokens": completion_tokens}
    return {"choices": [{"message": {"content": content}, "finish_reason": finish}], "usage": usage}


def _refusal(param, code="unsupported_value"):
    return (
        400,
        {"error": {"message": "nope", "type": "invalid_request_error", "param": param, "code": code}},
        {},
    )


def _client(**kwargs):
    return OpenAIClient(
        api_key=kwargs.pop("api_key", SECRET), model=kwargs.pop("model", "gpt-4.1-mini"), **kwargs
    )


def test_the_json_request_has_the_documented_shape(monkeypatch):
    http = FakeHttp(monkeypatch, (200, _completion('{"theory": "x"}'), {}))

    answer = _client(max_output_tokens=500).complete("system", "user")

    sent = http.requests[0]
    assert answer == '{"theory": "x"}'
    assert sent["url"] == OPENAI_URL
    assert sent["headers"] == {"Authorization": f"Bearer {SECRET}"}
    body = sent["json"]
    assert body["model"] == "gpt-4.1-mini" and body["max_completion_tokens"] == 500
    assert body["messages"] == [{"role": "system", "content": "system"}, {"role": "user", "content": "user"}]
    assert body["response_format"] == {"type": "json_object"} and body["temperature"] == 0.2


def test_a_reasoning_model_gets_no_temperature_and_text_mode_has_no_json_format(monkeypatch):
    http = FakeHttp(monkeypatch, (200, _completion("One sentence."), {}))

    assert _client(model="gpt-5-mini").complete_text("system", "user") == "One sentence."

    body = http.requests[0]["json"]
    assert (
        "temperature" not in body and "response_format" not in body and body["max_completion_tokens"] == 200
    )


def test_a_newer_model_that_refuses_the_temperature_is_asked_again_without_it_and_remembered(monkeypatch):
    http = FakeHttp(monkeypatch, _refusal("temperature"), (200, _completion("{}"), {}))
    client = _client(model="gpt-6-luna")

    assert client.complete("s", "u") == "{}"
    assert "temperature" in http.requests[0]["json"] and "temperature" not in http.requests[1]["json"]

    http.requests.clear()
    http.responses = [(200, _completion("{}"), {})]
    client.complete("s", "u")
    assert len(http.requests) == 1 and "temperature" not in http.requests[0]["json"]  # not tried again


def test_a_refusal_that_another_call_already_learned_still_gets_its_own_second_try(monkeypatch):
    """The three investigators of a round are asked at the same moment, so the first refusal of the
    temperature can be recorded by one call while another call's request (which still carried it) is in
    flight. That call must be asked again without the parameter, not fail."""
    http = FakeHttp(monkeypatch, _refusal("temperature"), (200, _completion("{}"), {}))
    original = http.__call__

    def another_call_learns_it_first(url, **kwargs):
        answer = original(url, **kwargs)
        llm_clients._refused.setdefault("gpt-6-luna", set()).add(
            "temperature"
        )  # recorded while this was in flight
        return answer

    monkeypatch.setattr(httpx, "post", another_call_learns_it_first)

    assert _client(model="gpt-6-luna").complete("s", "u") == "{}"
    assert len(http.requests) == 2 and "temperature" not in http.requests[1]["json"]


def test_a_refusal_of_a_parameter_that_was_not_sent_is_an_error_not_a_loop(monkeypatch):
    http = FakeHttp(monkeypatch, _refusal("temperature"))
    llm_clients._refused["gpt-6-luna"] = {"temperature"}  # already learned, so it is not in the request

    with pytest.raises(OpenAIError, match="HTTP 400"):
        _client(model="gpt-6-luna").complete("s", "u")

    assert len(http.requests) == 1


def test_a_model_that_refuses_the_json_format_is_asked_again_without_it(monkeypatch):
    http = FakeHttp(
        monkeypatch, _refusal("response_format", "unsupported_parameter"), (200, _completion("{}"), {})
    )

    _client().complete("s", "u")

    assert "response_format" in http.requests[0]["json"] and "response_format" not in http.requests[1]["json"]


def test_a_refusal_of_anything_else_is_not_retried(monkeypatch):
    http = FakeHttp(monkeypatch, _refusal("messages", "invalid_value"))

    with pytest.raises(OpenAIError, match="HTTP 400"):
        _client().complete("s", "u")

    assert len(http.requests) == 1


def test_the_tokens_the_api_reports_are_counted(monkeypatch):
    FakeHttp(monkeypatch, (200, _completion("{}", prompt_tokens=700, completion_tokens=90), {}))

    _client().complete("s", "u")
    _client().complete("s", "u")

    assert openai_usage.usage_24h().tokens == 2 * 790 and openai_usage.usage_24h().calls == 2


def test_without_usage_the_tokens_are_estimated_from_the_text(monkeypatch):
    body = _completion("a" * 300)
    del body["usage"]
    FakeHttp(monkeypatch, (200, body, {}))

    _client().complete("system", "user")

    assert openai_usage.usage_24h().tokens == openai_usage.estimate_tokens("system", "user") + 100


def test_a_spent_budget_stops_the_next_call_before_it_is_sent(monkeypatch):
    http = FakeHttp(monkeypatch, (200, _completion("{}", prompt_tokens=9_000, completion_tokens=1_500), {}))
    _client().complete("s", "u")  # 10,500 tokens against a limit of 10,000

    with pytest.raises(OpenAIBudgetExceeded, match=r"10,500 of 10,000"):
        _client().complete("s", "u")

    assert len(http.requests) == 1


def test_a_budget_that_cannot_be_checked_is_treated_as_spent(monkeypatch):
    http = FakeHttp(monkeypatch)

    def broken():
        raise redis.ConnectionError("down")

    with monkeypatch.context() as patch:  # scoped, so the fixture can still clean Redis afterwards
        patch.setattr(openai_usage, "_redis", broken)
        with pytest.raises(OpenAIBudgetExceeded, match="cannot be checked"):
            _client().complete("s", "u")

    assert http.requests == []


def test_a_missing_key_is_reported_in_words_and_sends_nothing(monkeypatch):
    http = FakeHttp(monkeypatch)

    with pytest.raises(OpenAIError, match="OPENAI_API_KEY is not set"):
        _client(api_key="  ").complete("s", "u")

    assert http.requests == []


@pytest.mark.parametrize(
    ("status", "fragment"),
    [(401, "rejected the API key"), (403, "rejected the API key"), (404, "no model 'gpt-4.1-mini'")],
)
def test_errors_that_waiting_cannot_fix_are_plain_and_never_carry_the_key(monkeypatch, status, fragment):
    FakeHttp(monkeypatch, (status, {"error": {"message": f"Incorrect API key: {SECRET}"}}, {}))

    with pytest.raises(OpenAIError, match=fragment) as raised:
        _client().complete("s", "u")

    assert SECRET not in str(raised.value)


def test_a_rate_limit_carries_the_retry_hint(monkeypatch):
    FakeHttp(monkeypatch, (429, {"error": {"code": "rate_limit_exceeded"}}, {"retry-after": "7"}))

    with pytest.raises(ProviderRateLimited) as limited:
        _client().complete("s", "u")

    assert limited.value.retry_after == 7.0 and limited.value.daily is False


DAILY_429 = (
    429,
    {
        "error": {
            "message": (
                "Rate limit reached for gpt-6-luna in organization org-SECRETORG on requests per day (RPD): "
                "Limit 50, Used 50, Requested 1. Please try again in 28m48s."
            ),
            "type": "requests",
            "code": "rate_limit_exceeded",
        }
    },
    {"retry-after": "1728", "x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "0"},
)


def test_a_limit_that_asks_for_a_long_wait_is_not_retried_and_says_when_it_frees_up(monkeypatch):
    """Observed live: the key allows 50 requests a day. The old client treated that 429 as a burst and
    retried for three minutes before failing with 'try again in a minute'."""
    http = FakeHttp(monkeypatch, DAILY_429)

    with pytest.raises(ProviderRateLimited) as limited:
        _client().complete("s", "u")

    assert limited.value.daily is True and limited.value.retry_after == 1728.0
    assert limited.value.detail == (
        "OpenAI's limit on requests per day (RPD) for this key is reached: 50 allowed. "
        "It frees up in about 29 minutes."
    )
    assert "org-SECRETORG" not in limited.value.detail and SECRET not in limited.value.detail
    assert len(http.requests) == 1
    assert openai_usage.read_limits().blocked_until is not None  # remembered, so other processes see it too


def test_while_openai_asks_for_a_wait_the_next_call_sends_nothing(monkeypatch):
    http = FakeHttp(monkeypatch, DAILY_429)
    with pytest.raises(ProviderRateLimited):
        _client().complete("s", "u")

    # A different client object stands for another process: the wait is in Redis, not in this object.
    monkeypatch.setattr(llm_clients, "_exhausted_until", 0.0)
    with pytest.raises(ProviderRateLimited) as again:
        _client().complete("s", "u")

    assert len(http.requests) == 1  # the second call made no request
    assert again.value.daily is True and "frees up in about" in again.value.detail


TOKENS_SPENT_429 = (
    429,
    {
        "error": {
            "message": (
                "Rate limit reached for gpt-6-luna in organization org-SECRETORG on tokens per min (TPM): "
                "Limit 100000, Used 100000, Requested 17. Please try again in 7m20.64s."
            ),
            "type": "tokens",
            "code": "rate_limit_exceeded",
        }
    },
    {
        "retry-after": "441",
        "x-ratelimit-limit-tokens": "100000",
        "x-ratelimit-remaining-tokens": "0",
        "x-ratelimit-reset-tokens": "729h44m3.84s",
    },
)


def test_a_token_allowance_that_resets_in_weeks_is_said_so_and_not_retried_in_minutes(monkeypatch):
    """Observed live: the key's 100 000 tokens were spent. OpenAI's retry-after said 7 minutes, and so did its
    message, but the bucket resets in 729 hours: every retry after 7 minutes fails the same way."""
    http = FakeHttp(monkeypatch, TOKENS_SPENT_429)

    with pytest.raises(ProviderRateLimited) as limited:
        _client().complete("s", "u")

    assert limited.value.daily is True
    assert limited.value.detail == (
        "OpenAI's token allowance for this key (100,000 tokens) is used up. It frees up in about 30 days; "
        "OpenAI says adding a payment method to the account raises the limit."
    )
    assert "org-SECRETORG" not in limited.value.detail
    held_for = openai_usage.read_limits().blocked_until - openai_usage.read_limits().at
    assert held_for == pytest.approx(729 * 3600 + 44 * 60 + 3.84)
    monkeypatch.setattr(llm_clients, "_exhausted_until", 0.0)
    with pytest.raises(ProviderRateLimited) as again:
        _client().complete("s", "u")
    assert len(http.requests) == 1 and "30 days" in again.value.detail  # the second call sent nothing


def test_a_spent_allowance_is_asked_about_again_after_a_few_minutes_and_credit_clears_it(monkeypatch):
    """The owner adds a payment method after the 429: no restart and no Redis cleaning may be needed."""
    http = FakeHttp(
        monkeypatch,
        TOKENS_SPENT_429,
        (200, _completion('{"ok": true}'), {"x-ratelimit-remaining-tokens": "480000"}),
    )
    with pytest.raises(ProviderRateLimited):
        _client().complete("s", "u")
    held_for = llm_clients._exhausted_until - llm_clients.time.monotonic()
    assert 0 < held_for <= openai_usage.RECHECK_S  # not the 30 days OpenAI named

    # The reading is now older than the recheck time, as it would be a few minutes on.
    older = llm_clients.time.time() - openai_usage.RECHECK_S - 60
    openai_usage.record_limits(TOKENS_SPENT_429[2], blocked_for_s=729 * 3600, now=older)
    monkeypatch.setattr(llm_clients, "_exhausted_until", 0.0)

    assert _client().complete("s", "u") == '{"ok": true}'
    assert len(http.requests) == 2  # the second call really went out
    assert openai_usage.read_limits().blocked_until is None  # and its answer cleared the wait


def test_a_real_per_minute_token_limit_is_still_a_burst_worth_retrying(monkeypatch):
    burst = (
        429,
        {"error": {"message": "slow down", "type": "tokens", "code": "rate_limit_exceeded"}},
        {"retry-after": "6", "x-ratelimit-reset-tokens": "6s", "x-ratelimit-remaining-tokens": "0"},
    )
    FakeHttp(monkeypatch, burst)

    with pytest.raises(ProviderRateLimited) as limited:
        _client().complete("s", "u")

    assert limited.value.daily is False and limited.value.detail is None
    assert openai_usage.allowance_block() is None


def test_a_burst_limit_with_a_short_wait_is_still_worth_retrying(monkeypatch):
    FakeHttp(monkeypatch, (429, {"error": {"code": "rate_limit_exceeded"}}, {"retry-after": "6"}))

    with pytest.raises(ProviderRateLimited) as burst:
        _client().complete("s", "u")

    assert burst.value.daily is False and burst.value.detail is None
    assert openai_usage.allowance_block() is None  # nothing is held: the next call goes out


def test_a_429_whose_message_is_not_the_usual_one_still_gets_a_sentence_without_guessing(monkeypatch):
    FakeHttp(monkeypatch, (429, {"error": {"message": "slow down", "code": "x"}}, {"retry-after": "3600"}))

    with pytest.raises(ProviderRateLimited) as limited:
        _client().complete("s", "u")

    assert (
        limited.value.detail
        == "OpenAI's rate limit for this key is reached. It frees up in about 60 minutes."
    )


def test_every_answer_leaves_its_limit_reading_behind(monkeypatch):
    headers = {"x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "7"}
    FakeHttp(monkeypatch, (200, _completion("{}"), headers))

    _client().complete("s", "u")

    seen = openai_usage.read_limits()
    assert (seen.limit_requests, seen.remaining_requests, seen.blocked_until) == (50, 7, None)


def test_a_key_that_openai_says_has_no_requests_left_is_not_asked(monkeypatch):
    http = FakeHttp(monkeypatch)
    openai_usage.record_limits(
        {"x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "0"},
        now=llm_clients.time.time(),
    )

    with pytest.raises(ProviderRateLimited) as limited:
        _client().complete("s", "u")

    assert limited.value.daily is True and "only 0 of 50 more requests" in limited.value.detail
    assert http.requests == []


def test_a_spent_account_is_a_daily_quota_and_the_next_call_fails_fast(monkeypatch):
    http = FakeHttp(monkeypatch, (429, {"error": {"code": "insufficient_quota"}}, {}))

    with pytest.raises(ProviderRateLimited) as spent:
        _client().complete("s", "u")
    with pytest.raises(ProviderRateLimited):
        _client().complete("s", "u")

    assert spent.value.daily is True and len(http.requests) == 1  # the second call made no request


NO_CREDIT_429 = (
    429,
    {
        "error": {
            "message": "You have no credits remaining. Add credits to continue using the API.",
            "type": "insufficient_quota",
            "param": None,
            "code": "credit_balance_exhausted",
        }
    },
    {},
)


def test_the_no_credit_answer_openai_really_sends_is_a_spent_account_not_a_burst(monkeypatch):
    """Observed live on gpt-5.4-mini and gpt-5.6-luna: type insufficient_quota, code
    credit_balance_exhausted. Read as a burst it was retried for 35 seconds and then reported as 'rate
    limiting, try again in a minute'."""
    http = FakeHttp(monkeypatch, NO_CREDIT_429)

    with pytest.raises(ProviderRateLimited) as spent:
        _client().complete("s", "u")
    with pytest.raises(ProviderRateLimited):
        _client().complete("s", "u")

    assert spent.value.daily is True
    assert len(http.requests) == 1  # no retry, and the second call made no request


def test_a_spent_account_is_asked_again_after_the_short_hold_so_a_top_up_works_at_once(monkeypatch):
    http = FakeHttp(monkeypatch, NO_CREDIT_429, (200, _completion("{}"), {}))
    with pytest.raises(ProviderRateLimited):
        _client().complete("s", "u")
    assert 0 < llm_clients._exhausted_until - llm_clients.time.monotonic() <= 60

    monkeypatch.setattr(llm_clients, "_exhausted_until", 0.0)  # the hold has passed

    assert _client().complete("s", "u") == "{}"
    assert len(http.requests) == 2


def test_a_server_error_or_a_timeout_is_worth_retrying_and_leaks_no_url(monkeypatch):
    FakeHttp(monkeypatch, (503, {}, {}))
    with pytest.raises(OpenAIUnavailable, match="HTTP 503"):
        _client().complete("s", "u")

    FakeHttp(monkeypatch, error=httpx.ReadTimeout(f"timed out calling {OPENAI_URL} with {SECRET}"))
    with pytest.raises(OpenAIUnavailable) as timed_out:
        _client().complete("s", "u")
    assert "ReadTimeout" in str(timed_out.value) and SECRET not in str(timed_out.value)


def test_an_empty_answer_that_was_not_cut_off_says_so(monkeypatch):
    FakeHttp(monkeypatch, (200, _completion("  ", finish="stop"), {}))

    with pytest.raises(OpenAIError, match="empty answer.*finish reason 'stop'"):
        _client().complete("s", "u")


def test_a_json_answer_cut_off_at_the_limit_is_asked_again_with_twice_the_room(monkeypatch):
    http = FakeHttp(
        monkeypatch,
        (200, _completion('{"theory": "cut in the mid', finish="length", completion_tokens=500), {}),
        (200, _completion('{"theory": "whole"}'), {}),
    )

    assert _client(max_output_tokens=500).complete("s", "u") == '{"theory": "whole"}'

    assert [r["json"]["max_completion_tokens"] for r in http.requests] == [500, 1000]
    assert openai_usage.usage_24h().calls == 2  # the cut-off attempt was paid for, so it is counted


def test_a_thinking_model_that_spent_every_token_thinking_is_asked_again_for_text_too(monkeypatch):
    http = FakeHttp(
        monkeypatch,
        (200, _completion("", finish="length"), {}),
        (200, _completion("A sentence."), {}),
    )

    assert _client().complete_text("s", "u") == "A sentence."

    assert [r["json"]["max_completion_tokens"] for r in http.requests] == [200, 400]


def test_a_text_answer_that_stopped_mid_sentence_is_still_an_answer(monkeypatch):
    http = FakeHttp(monkeypatch, (200, _completion("Blocked because the flood was", finish="length"), {}))

    assert _client().complete_text("s", "u") == "Blocked because the flood was"
    assert len(http.requests) == 1


def test_cut_off_retries_are_bounded_and_the_error_says_what_to_raise(monkeypatch):
    http = FakeHttp(
        monkeypatch, (200, _completion("", finish="length", prompt_tokens=100, completion_tokens=500), {})
    )

    with pytest.raises(OpenAIError, match="cut the answer off at 12000 tokens.*OPENAI_MAX_OUTPUT_TOKENS"):
        _client(max_output_tokens=3000).complete("s", "u")

    assert [r["json"]["max_completion_tokens"] for r in http.requests] == [3000, 6000, 12000]
    assert openai_usage.usage_24h().tokens == 3 * 600  # every attempt was paid for, thinking included


def test_throttle_spaces_consecutive_calls(monkeypatch):
    sleeps: list[float] = []
    monkeypatch.undo()  # this test needs the real _throttle
    monkeypatch.setattr(llm_clients.time, "sleep", sleeps.append)
    monkeypatch.setattr(llm_clients, "_last_call_at", 0.0)
    llm_clients._throttle()
    llm_clients._throttle()
    assert len(sleeps) == 1 and 0 < sleeps[0] <= llm_clients.MIN_INTERVAL_S


def test_the_model_comes_from_the_settings_with_a_default(monkeypatch):
    monkeypatch.setattr(settings, "openai_model", " gpt-6-luna ")
    assert llm_clients.model_name() == "gpt-6-luna"
    monkeypatch.setattr(settings, "openai_model", "")
    assert llm_clients.model_name() == llm_clients.DEFAULT_MODEL
