"""What the project has asked OpenAI for in the last 24 hours, the hard budget, and what OpenAI itself allows.

Every OpenAI call records its input and output tokens in Redis for 24 hours: the numbers the API reports, or
an estimate from the text length when it reports none. A call is refused BEFORE it is sent when the last 24
hours already used the budget (settings.openai_daily_token_limit), and when the counter cannot be read (a
budget that cannot be checked is not a budget). Calls already in flight may overshoot the budget by a few
thousand tokens, which is the price of not holding a lock across a network call.

The key has limits of its own that the project does not choose (for example 50 requests a day and 100 000
tokens). OpenAI reports them in the x-ratelimit-* headers of every answer; record_limits() keeps the latest
reading, and allowance_block() says in words when the next debate would be refused, so a doomed debate is
declined with a reason instead of retried for minutes.
"""

import re
import time
from collections.abc import Mapping
from dataclasses import dataclass

import redis

from backend.config import settings

WINDOW_SECONDS = 86400
KEPT_CALLS = 2000
USAGE_KEY = "verdictchain:openai:usage"  # list, newest first: "epoch:prompt_tokens:completion_tokens"
LIMITS_KEY = "verdictchain:openai:limits"  # hash: the latest x-ratelimit-* reading and any "wait until"
LIMITS_TTL_S = 35 * 86400
FRESH_S = 1800  # a "too few requests left" reading is trusted this long without a newer answer
# A wait longer than this is a spent allowance (days or weeks), not a burst. The owner of the account can
# raise it at any minute (a payment method, a new plan), so such a wait is believed for RECHECK_S only:
# after that the next call goes to OpenAI, whose answer decides. A refused call costs no tokens.
SPENT_ALLOWANCE_S = 3600.0
RECHECK_S = 300.0
CHARS_PER_TOKEN = 3  # a rough estimate for numeric JSON; only used when the API reports no usage

_client: redis.Redis | None = None


class OpenAIBudgetExceeded(Exception):
    """The token budget of the last 24 hours is used up, or cannot be checked."""


@dataclass(frozen=True)
class Usage:
    tokens: int  # input + output tokens in the window
    calls: int


@dataclass(frozen=True)
class Allowance:
    """The latest reading of what OpenAI allows this key (all None when a header was missing)."""

    limit_requests: int | None
    remaining_requests: int | None
    limit_tokens: int | None
    remaining_tokens: int | None
    reset_requests_s: float | None
    reset_tokens_s: float | None
    blocked_until: float | None  # epoch seconds: OpenAI said to wait until then
    at: float  # epoch seconds of the answer this reading comes from


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            settings.redis_url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2
        )
    return _client


def configured() -> bool:
    """True when OPENAI_API_KEY is set. Only the fact is ever reported, never the key."""
    return bool(settings.openai_api_key.strip())


def estimate_tokens(*texts: str) -> int:
    return max(1, sum(len(text) for text in texts) // CHARS_PER_TOKEN)


def record(prompt_tokens: int, completion_tokens: int) -> None:
    """Counts one call. A Redis failure is raised: the caller has already spent the tokens and must know."""
    pipe = _redis().pipeline()
    pipe.lpush(USAGE_KEY, f"{time.time():.3f}:{max(prompt_tokens, 0)}:{max(completion_tokens, 0)}")
    pipe.ltrim(USAGE_KEY, 0, KEPT_CALLS - 1)
    pipe.execute()


def usage_24h(now: float | None = None) -> Usage:
    """Tokens and calls in the last 24 hours. Raises redis.RedisError when Redis cannot be read."""
    current = now if now is not None else time.time()
    tokens = 0
    calls = 0
    for raw in _redis().lrange(USAGE_KEY, 0, -1):
        stamp, prompt, completion = raw.split(":")
        if current - float(stamp) <= WINDOW_SECONDS:
            tokens += int(prompt) + int(completion)
            calls += 1
    return Usage(tokens=tokens, calls=calls)


def token_limit() -> int:
    return settings.openai_daily_token_limit


def check_budget() -> None:
    """Raises OpenAIBudgetExceeded when no further call may start."""
    try:
        used = usage_24h()
    except redis.RedisError as exc:
        raise OpenAIBudgetExceeded(
            "The OpenAI token budget cannot be checked (Redis is not reachable), so no OpenAI call is made."
        ) from exc
    limit = token_limit()
    if used.tokens >= limit:
        raise OpenAIBudgetExceeded(
            "The OpenAI token budget for the last 24 hours is used up "
            f"({used.tokens:,} of {limit:,} tokens). It frees up as old calls age out, "
            "or raise OPENAI_DAILY_TOKEN_LIMIT."
        )


# ---- what OpenAI allows this key --------------------------------------------------------------------------

_DURATION_PART = re.compile(r"(\d+(?:\.\d+)?)(ms|h|m|s)")
_UNIT_SECONDS = {"h": 3600.0, "m": 60.0, "s": 1.0, "ms": 0.001}


def parse_duration(text: str | None) -> float | None:
    """OpenAI's duration text ("1m30s", "6ms", "729h44m3.84s") in seconds, or None when it is not one."""
    if not isinstance(text, str) or not text.strip():
        return None
    text = text.strip()
    parts = _DURATION_PART.findall(text)
    if not parts or "".join(number + unit for number, unit in parts) != text:
        return None
    return sum(float(number) * _UNIT_SECONDS[unit] for number, unit in parts)


def format_wait(seconds: float) -> str:
    """ "29 minutes", "1 hour 5 minutes", "40 seconds": a wait in words, rounded up."""
    seconds = max(1, int(seconds + 0.999))
    if seconds < 90:
        return f"{seconds} second{'s' if seconds != 1 else ''}"
    minutes = -(-seconds // 60)
    if minutes < 90:
        return f"{minutes} minutes"
    hours, rest = divmod(minutes, 60)
    if hours >= 48:
        return f"{hours // 24} days"
    return f"{hours} hour{'s' if hours != 1 else ''}" + (f" {rest} minutes" if rest else "")


def _int_header(headers: Mapping[str, str], name: str) -> int | None:
    try:
        return int(headers[name])
    except (KeyError, ValueError, TypeError):
        return None


def record_limits(
    headers: Mapping[str, str], blocked_for_s: float | None = None, now: float | None = None
) -> None:
    """Keeps the x-ratelimit-* reading of an OpenAI answer. blocked_for_s is the wait OpenAI asked for when it
    refused (a 429 whose retry-after is long). Does nothing when the answer carried no such headers and no
    wait. Never raises: losing a reading must not fail a call that already got its answer."""
    seen = {name.lower(): value for name, value in headers.items()}
    reading = {
        "limit_requests": _int_header(seen, "x-ratelimit-limit-requests"),
        "remaining_requests": _int_header(seen, "x-ratelimit-remaining-requests"),
        "limit_tokens": _int_header(seen, "x-ratelimit-limit-tokens"),
        "remaining_tokens": _int_header(seen, "x-ratelimit-remaining-tokens"),
        "reset_requests_s": parse_duration(seen.get("x-ratelimit-reset-requests")),
        "reset_tokens_s": parse_duration(seen.get("x-ratelimit-reset-tokens")),
    }
    if all(value is None for value in reading.values()) and blocked_for_s is None:
        return
    moment = now if now is not None else time.time()
    stored = {key: ("" if value is None else str(value)) for key, value in reading.items()}
    stored["at"] = str(moment)
    stored["blocked_until"] = "" if blocked_for_s is None else str(moment + blocked_for_s)
    try:
        pipe = _redis().pipeline()
        pipe.hset(LIMITS_KEY, mapping=stored)
        pipe.expire(LIMITS_KEY, LIMITS_TTL_S)
        pipe.execute()
    except redis.RedisError:
        pass


def _float_or_none(value: str | None) -> float | None:
    try:
        return float(value) if value not in (None, "") else None
    except ValueError:
        return None


def read_limits() -> Allowance | None:
    """The latest reading, or None when OpenAI has not answered yet (or Redis cannot be read)."""
    try:
        stored = _redis().hgetall(LIMITS_KEY)
    except redis.RedisError:
        return None
    if not stored or _float_or_none(stored.get("at")) is None:
        return None

    def whole(name: str) -> int | None:
        value = _float_or_none(stored.get(name))
        return None if value is None else int(value)

    return Allowance(
        limit_requests=whole("limit_requests"),
        remaining_requests=whole("remaining_requests"),
        limit_tokens=whole("limit_tokens"),
        remaining_tokens=whole("remaining_tokens"),
        reset_requests_s=_float_or_none(stored.get("reset_requests_s")),
        reset_tokens_s=_float_or_none(stored.get("reset_tokens_s")),
        blocked_until=_float_or_none(stored.get("blocked_until")),
        at=float(stored["at"]),
    )


def hold_in_force(allowance: Allowance, now: float) -> float | None:
    """When the wait OpenAI asked for ends, or None when no wait applies: none was asked, it is over, or it is
    a spent allowance (see SPENT_ALLOWANCE_S) that was last seen more than RECHECK_S ago and is due again."""
    until = allowance.blocked_until
    if until is None or now >= until:
        return None
    if until - allowance.at > SPENT_ALLOWANCE_S and now - allowance.at > RECHECK_S:
        return None
    return until


def allowance_block(needed_requests: int = 1, needed_tokens: int = 0, now: float | None = None) -> str | None:
    """A sentence when OpenAI would refuse what is about to be asked, from its own latest answer; else None.

    Two cases: OpenAI told us to wait (a 429 with a long retry-after) and that time has not passed, or its
    latest answer, less than FRESH_S ago, showed fewer requests (or tokens) left than the debate needs.
    Anything older or unknown lets the call go: the real answer is the better source."""
    allowance = read_limits()
    if allowance is None:
        return None
    moment = now if now is not None else time.time()
    if allowance.blocked_until is not None:
        until = hold_in_force(allowance, moment)
        if until is None:
            return None  # the wait is over, or a spent allowance is due for a new question: OpenAI decides
        return f"OpenAI's limit for this key is reached; it frees up in about {format_wait(until - moment)}."
    fresh = moment - allowance.at <= FRESH_S
    if fresh and allowance.remaining_requests is not None and allowance.remaining_requests < needed_requests:
        limit = f" of {allowance.limit_requests:,}" if allowance.limit_requests is not None else ""
        return (
            f"OpenAI allows this key only {allowance.remaining_requests:,}{limit} more requests for now "
            f"and this needs about {needed_requests}."
        )
    if (
        fresh
        and needed_tokens
        and allowance.remaining_tokens is not None
        and allowance.remaining_tokens < needed_tokens
    ):
        limit = f" of {allowance.limit_tokens:,}" if allowance.limit_tokens is not None else ""
        return (
            f"OpenAI allows this key only {allowance.remaining_tokens:,}{limit} more tokens for now "
            f"and this needs about {needed_tokens:,}."
        )
    return None


def reset() -> None:
    """Forgets the recorded calls and the allowance reading (tests, and a deliberate fresh start)."""
    _redis().delete(USAGE_KEY, LIMITS_KEY)
