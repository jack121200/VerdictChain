"""Call time and quota errors per model provider, for /system/status (checklist SD7).

The debate engine times every investigator call and records a failure when one ends a debate. The numbers
are kept in Redis for 24 hours (a capped list per provider), so they survive an API restart and are shared by
workers. A call time includes the client's own spacing between calls and any fallback to the other provider,
so it is the time an investigator waited for its answer, not the provider's network latency.
"""

import time

import redis

from backend.config import settings
from backend.debate.failure import Failure

WINDOW_SECONDS = 86400
KEPT = 500

_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def _key(kind: str, provider: str) -> str:
    return f"verdictchain:provider:{kind}:{provider}"


def _push(key: str, value: str) -> None:
    try:
        pipe = _redis().pipeline()
        pipe.lpush(key, f"{time.time():.3f}:{value}")
        pipe.ltrim(key, 0, KEPT - 1)
        pipe.execute()
    except redis.RedisError:  # a lost sample must never fail a debate
        pass


def record_call(provider: str, elapsed_ms: float) -> None:
    _push(_key("calls", provider), f"{elapsed_ms:.1f}")


def record_failure(failure: Failure) -> None:
    """Counted per provider when it is known, else under 'unknown'."""
    if failure.kind in ("daily_quota", "rate_limited"):
        _push(_key("quota", failure.provider or "unknown"), failure.kind)


def _recent(key: str, now: float) -> list[str]:
    values = []
    for raw in _redis().lrange(key, 0, -1):
        stamp, _, value = raw.partition(":")
        if now - float(stamp) <= WINDOW_SECONDS:
            values.append(value)
    return values


def latency_ms(provider: str, now: float | None = None) -> tuple[float | None, int]:
    """(mean call time in ms, calls) over the last 24 hours. The mean is None with no calls."""
    values = [
        float(value) for value in _recent(_key("calls", provider), now if now is not None else time.time())
    ]
    return (sum(values) / len(values) if values else None), len(values)


def quota_errors(provider: str, now: float | None = None) -> int:
    """Debates this provider's quota or rate limit ended in the last 24 hours."""
    return len(_recent(_key("quota", provider), now if now is not None else time.time()))
