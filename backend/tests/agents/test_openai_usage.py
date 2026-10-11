"""What OpenAI itself allows this key: the headers it sends, and the sentence when the next debate would be
refused (backend/agents/openai_usage.py). Nothing here reaches OpenAI."""

import pytest

from backend.agents import openai_usage
from backend.agents.openai_usage import (
    Allowance,
    allowance_block,
    format_wait,
    parse_duration,
    read_limits,
    record_limits,
)

# What the account of this project really sent: 50 requests and 100 000 tokens.
HEADERS = {
    "x-ratelimit-limit-requests": "50",
    "x-ratelimit-limit-tokens": "100000",
    "x-ratelimit-remaining-requests": "7",
    "x-ratelimit-remaining-tokens": "81000",
    "x-ratelimit-reset-requests": "23h52m13.7s",
    "x-ratelimit-reset-tokens": "729h44m3.84s",
}
T0 = 1_800_000_000.0


@pytest.fixture(autouse=True)
def _clean():
    openai_usage.reset()
    yield
    openai_usage.reset()


@pytest.mark.parametrize(
    ("text", "seconds"),
    [
        ("1m30s", 90.0),
        ("28m48s", 1728.0),
        ("6ms", 0.006),
        ("0s", 0.0),
        ("729h44m3.84s", 729 * 3600 + 44 * 60 + 3.84),
        ("23h52m13.7s", 23 * 3600 + 52 * 60 + 13.7),
    ],
)
def test_openai_durations_are_read_in_seconds(text, seconds):
    assert parse_duration(text) == pytest.approx(seconds)


@pytest.mark.parametrize("text", [None, "", "  ", "soon", "5 minutes", "1d", "m30s", "1m30"])
def test_text_that_is_not_a_duration_is_not_guessed(text):
    assert parse_duration(text) is None


@pytest.mark.parametrize(
    ("seconds", "words"),
    [
        (0.2, "1 second"),
        (40, "40 seconds"),
        (89, "89 seconds"),
        (90, "2 minutes"),
        (1728, "29 minutes"),
        (5400, "1 hour 30 minutes"),
        (7200, "2 hours"),
        (3 * 86400, "3 days"),
    ],
)
def test_a_wait_is_said_in_words_and_rounded_up(seconds, words):
    assert format_wait(seconds) == words


def test_the_reading_of_an_answer_is_kept_and_read_back():
    record_limits(HEADERS, now=T0)

    assert read_limits() == Allowance(
        limit_requests=50,
        remaining_requests=7,
        limit_tokens=100_000,
        remaining_tokens=81_000,
        reset_requests_s=pytest.approx(23 * 3600 + 52 * 60 + 13.7),
        reset_tokens_s=pytest.approx(729 * 3600 + 44 * 60 + 3.84),
        blocked_until=None,
        at=T0,
    )


def test_header_names_are_matched_without_regard_to_case():
    record_limits({name.upper(): value for name, value in HEADERS.items()}, now=T0)

    assert read_limits().remaining_requests == 7


def test_an_answer_without_limit_headers_leaves_the_last_reading_alone():
    record_limits(HEADERS, now=T0)

    record_limits({"content-type": "application/json"}, now=T0 + 5)

    assert read_limits().remaining_requests == 7 and read_limits().at == T0


def test_nothing_is_read_before_openai_has_answered():
    assert read_limits() is None
    assert allowance_block() is None


def test_a_wait_openai_asked_for_blocks_until_it_has_passed_and_says_how_long():
    record_limits(
        {"x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "0"},
        blocked_for_s=1728,
        now=T0,
    )

    assert allowance_block(now=T0 + 10) == (
        "OpenAI's limit for this key is reached; it frees up in about 29 minutes."
    )
    assert allowance_block(now=T0 + 1727) is not None
    assert allowance_block(now=T0 + 1729) is None  # the wait is over; the real answer decides from here


SPENT_HEADERS = {
    "x-ratelimit-limit-tokens": "100000",
    "x-ratelimit-remaining-tokens": "0",
    "x-ratelimit-reset-tokens": "729h44m3.84s",
}
WEEKS_S = 729 * 3600 + 44 * 60 + 3.84


def test_a_spent_allowance_is_believed_for_a_few_minutes_only_because_credit_lifts_it_at_once():
    """Observed live: the key's tokens were spent and OpenAI said 'about 30 days'. The owner then adds a
    payment method: the very next call must be allowed to find that out, not wait out a month in Redis."""
    assert openai_usage.RECHECK_S <= 600  # minutes, not hours: what a person waits after adding credit
    record_limits(SPENT_HEADERS, blocked_for_s=WEEKS_S, now=T0)

    assert allowance_block(needed_requests=9, needed_tokens=30_000, now=T0 + 10) == (
        "OpenAI's limit for this key is reached; it frees up in about 30 days."
    )
    assert allowance_block(now=T0 + openai_usage.RECHECK_S) is not None
    due = T0 + openai_usage.RECHECK_S + 1
    assert allowance_block(now=due) is None
    assert allowance_block(needed_requests=9, needed_tokens=30_000, now=due) is None  # 0 left holds nothing


def test_a_wait_of_an_hour_or_less_is_believed_for_its_whole_length():
    record_limits(SPENT_HEADERS, blocked_for_s=openai_usage.SPENT_ALLOWANCE_S, now=T0)

    assert allowance_block(now=T0 + openai_usage.RECHECK_S + 1) is not None
    assert allowance_block(now=T0 + openai_usage.SPENT_ALLOWANCE_S - 1) is not None
    assert allowance_block(now=T0 + openai_usage.SPENT_ALLOWANCE_S + 1) is None


def test_a_later_answer_clears_the_wait():
    record_limits(HEADERS, blocked_for_s=1728, now=T0)
    assert allowance_block(now=T0 + 5) is not None

    record_limits(HEADERS, now=T0 + 20)  # an answer that carried no wait

    assert read_limits().blocked_until is None
    assert allowance_block(now=T0 + 25) is None


def test_too_few_requests_left_for_a_debate_blocks_while_the_reading_is_fresh():
    record_limits({**HEADERS, "x-ratelimit-remaining-requests": "3"}, now=T0)

    assert allowance_block(needed_requests=9, now=T0 + 60) == (
        "OpenAI allows this key only 3 of 50 more requests for now and this needs about 9."
    )
    assert allowance_block(needed_requests=3, now=T0 + 60) is None  # three is enough for three
    assert allowance_block(needed_requests=9, now=T0 + openai_usage.FRESH_S + 1) is None  # stale: ask again


def test_too_few_tokens_left_for_a_debate_blocks_while_the_reading_is_fresh():
    record_limits(
        {**HEADERS, "x-ratelimit-remaining-requests": "40", "x-ratelimit-remaining-tokens": "12000"}, now=T0
    )

    assert allowance_block(needed_requests=9, needed_tokens=30_000, now=T0 + 60) == (
        "OpenAI allows this key only 12,000 of 100,000 more tokens for now and this needs about 30,000."
    )
    assert allowance_block(needed_requests=9, needed_tokens=10_000, now=T0 + 60) is None
    assert allowance_block(needed_requests=9, now=T0 + 60) is None  # a caller that names no token need
    assert allowance_block(needed_requests=9, needed_tokens=30_000, now=T0 + openai_usage.FRESH_S + 1) is None


def test_enough_requests_left_blocks_nothing():
    record_limits({**HEADERS, "x-ratelimit-remaining-requests": "12"}, now=T0)

    assert allowance_block(needed_requests=9, now=T0 + 1) is None


def test_no_requests_left_blocks_even_a_single_call():
    record_limits({**HEADERS, "x-ratelimit-remaining-requests": "0"}, now=T0)

    assert allowance_block(now=T0 + 1) is not None
