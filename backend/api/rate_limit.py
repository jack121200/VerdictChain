"""Rate limiting, the single debate slot and the daily debate caps (plan sections 2 and 3.5).

Fixed-window INCR+EXPIRE counters back the abuse-prone endpoints (login, simulate, fault injection).
The debate slot is one Redis key that allows one debate at a time. The daily caps count accepted
runs per analyst and across all analysts, over a 24 hour window.
"""

import uuid

import redis
from fastapi import HTTPException, Request, status

from backend.config import settings

DEBATE_SLOT_KEY = "verdictchain:debate:slot"
DEBATE_SLOT_TTL_SECONDS = 1800
DAILY_WINDOW_SECONDS = 86400
GLOBAL_CAP_IDENTIFIER = "all"

# Compare-and-set and compare-and-delete, so a holder never changes or deletes a slot it does not own.
_CAS_SCRIPT = (
    "if redis.call('GET', KEYS[1]) == ARGV[1] then "
    "redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL') return 1 end return 0"
)
_CAD_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0"

_redis_client: redis.Redis | None = None


def _client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def get_redis() -> redis.Redis:
    """The shared Redis client, for the other Redis-backed modules (ws tickets)."""
    return _client()


def enforce_rate_limit(key_prefix: str, identifier: str, limit: int, window_seconds: int) -> None:
    """Raises HTTP 429 if `identifier` has exceeded `limit` calls to
    `key_prefix` within the current `window_seconds` window.
    """
    key = f"verdictchain:ratelimit:{key_prefix}:{identifier}"
    client = _client()
    count = client.incr(key)
    if count == 1:
        client.expire(key, window_seconds)
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded for {key_prefix}. Try again shortly.",
        )


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def slot_holder() -> str | None:
    """The current holder of the debate slot: a pending token, or an investigation id. None if free."""
    return _client().get(DEBATE_SLOT_KEY)


class DebateSlot:
    """The single in-flight debate. The key holds this holder's value: a pending token until
    start_investigation returns, then the investigation id (bind). release() deletes the key only
    while it still holds this holder's value, so a late release never frees someone else's slot.
    """

    def __init__(self, label: str = "debate") -> None:
        self._value = f"{label}:pending:{uuid.uuid4()}"

    def acquire(self) -> bool:
        return bool(_client().set(DEBATE_SLOT_KEY, self._value, nx=True, ex=DEBATE_SLOT_TTL_SECONDS))

    def bind(self, investigation_id: str) -> None:
        _client().eval(_CAS_SCRIPT, 1, DEBATE_SLOT_KEY, self._value, investigation_id)
        self._value = investigation_id

    def release(self) -> None:
        _client().eval(_CAD_SCRIPT, 1, DEBATE_SLOT_KEY, self._value)


IDEMPOTENCY_TTL_SECONDS = 900
IDEMPOTENCY_PENDING = "pending"


def _idempotency_redis_key(username: str, key: str) -> str:
    return f"verdictchain:idem:{username}:{key}"


def claim_idempotency(username: str, key: str) -> str | None:
    """None when this request now owns the key. Otherwise what is stored: IDEMPOTENCY_PENDING while the first
    request is still being accepted, then the id of the investigation it started."""
    redis_key = _idempotency_redis_key(username, key)
    if _client().set(redis_key, IDEMPOTENCY_PENDING, nx=True, ex=IDEMPOTENCY_TTL_SECONDS):
        return None
    return _client().get(redis_key) or IDEMPOTENCY_PENDING


def finish_idempotency(username: str, key: str, investigation_id: str) -> None:
    _client().set(_idempotency_redis_key(username, key), investigation_id, ex=IDEMPOTENCY_TTL_SECONDS)


def release_idempotency(username: str, key: str) -> None:
    """Called when the request was refused, so the same key can be used for a corrected retry."""
    _client().delete(_idempotency_redis_key(username, key))


def _cap_key(scope: str, identifier: str) -> str:
    return f"verdictchain:cap:{scope}:{identifier}"


def enforce_daily_cap(scope: str, identifier: str, limit: int, detail: str) -> None:
    """Raises HTTP 429 once `limit` runs are recorded for `identifier` in the current 24 hour window."""
    used = _client().get(_cap_key(scope, identifier))
    if int(used or 0) >= limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=detail)


def record_daily_run(scope: str, identifier: str) -> None:
    """Counts one accepted run. The window starts at the first run and lasts 24 hours."""
    key = _cap_key(scope, identifier)
    client = _client()
    if client.incr(key) == 1:
        client.expire(key, DAILY_WINDOW_SECONDS)
