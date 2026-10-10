"""Plain-words reasons for a debate that could not finish (BE4) and the provider numbers (SD7)."""

import time
import uuid

import httpx

from backend.debate import engine, provider_stats
from backend.debate.failure import Failure, classify, explain_failure


class ProviderRateLimited(Exception):
    """Shaped like the client's exception: the message starts with the provider and a daily flag is set."""

    def __init__(self, provider: str, daily: bool):
        super().__init__(f"{provider} returned 429 (retry-after=None, daily_quota={daily})")
        self.daily = daily


class InvalidAgentResponse(Exception):
    pass


def _http_error(url: str, status: int, body: str = "") -> httpx.HTTPStatusError:
    request = httpx.Request("POST", url)
    return httpx.HTTPStatusError(
        "boom", request=request, response=httpx.Response(status, text=body, request=request)
    )


def test_a_spent_daily_quota_says_so_and_names_the_provider():
    failure = classify(ProviderRateLimited("gemini", daily=True))

    assert failure == Failure(
        "daily_quota",
        "gemini",
        "The gemini daily quota is used up. Try again after it resets, or set another provider key.",
    )


def test_a_rate_limit_that_is_not_the_daily_quota_asks_for_a_minute():
    failure = classify(ProviderRateLimited("groq", daily=False))

    assert failure.kind == "rate_limited" and failure.provider == "groq"
    assert failure.message == "The groq is rate limiting requests. Try again in a minute."


def test_a_plain_http_429_is_read_from_the_response_and_the_host():
    daily = classify(
        _http_error("https://generativelanguage.googleapis.com/v1beta/models/x", 429, "RequestsPerDay")
    )
    limited = classify(_http_error("https://api.groq.com/openai/v1/chat/completions", 503))

    assert (daily.kind, daily.provider) == ("daily_quota", "gemini")
    assert (limited.kind, limited.provider) == ("rate_limited", "groq")
    assert classify(_http_error("https://example.test/", 429)).message.startswith(
        "The model provider is rate limiting"
    )


def test_other_failures_keep_their_own_text():
    assert explain_failure(RuntimeError("access_log provider is down")) == "access_log provider is down"
    assert classify(InvalidAgentResponse("cited row_id not in slice")).kind == "invalid_answer"
    assert "failed validation: cited row_id not in slice" in explain_failure(
        InvalidAgentResponse("cited row_id not in slice")
    )
    assert explain_failure(ValueError()) == "ValueError"  # an empty message still says what it was
    assert len(explain_failure(RuntimeError("x" * 1000))) == 300


def test_call_times_are_averaged_over_the_last_24_hours_only():
    provider = f"test_provider_{uuid.uuid4().hex[:8]}"
    now = time.time()
    provider_stats.record_call(provider, 100.0)
    provider_stats.record_call(provider, 300.0)
    assert provider_stats.latency_ms(provider) == (200.0, 2)
    assert provider_stats.latency_ms(provider, now=now + 2 * 86400) == (
        None,
        0,
    )  # both are older than a day by then
    assert provider_stats.latency_ms(f"{provider}_none") == (None, 0)


def test_only_quota_failures_are_counted_per_provider():
    provider = f"test_provider_{uuid.uuid4().hex[:8]}"
    provider_stats.record_failure(Failure("daily_quota", provider, "m"))
    provider_stats.record_failure(Failure("rate_limited", provider, "m"))
    provider_stats.record_failure(Failure("invalid_answer", provider, "m"))
    provider_stats.record_failure(Failure("other", provider, "m"))

    assert provider_stats.quota_errors(provider) == 2


def test_every_investigator_call_is_timed_and_filed_under_the_provider_that_served_it():
    provider = f"test_provider_{uuid.uuid4().hex[:8]}"

    def investigator(rows, round_no, peripheral_digest=None, debate_context=None):
        time.sleep(0.05)
        return object(), provider

    response, served_by = engine._respond(
        {"network_traffic": investigator}, "network_traffic", [], 1, {}, None, None
    )

    assert served_by == provider and response is not None
    mean, calls = provider_stats.latency_ms(provider)
    assert calls == 1 and mean is not None and mean >= 45.0
