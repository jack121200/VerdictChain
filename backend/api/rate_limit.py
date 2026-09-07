"""Rate limiting for the login and 'Simulate scenario' endpoints specifically
(SKILL-security.md Section 2: "both are abuse-prone: brute-force login
attempts, and investigation-spamming"). Built on Redis (already a locked
dependency for Watchdog's CrS) via a simple fixed-window INCR+EXPIRE counter,
rather than adding a new rate-limiting library.
"""

import redis
from fastapi import HTTPException, Request, status

from backend.config import settings

_redis_client: redis.Redis | None = None


def _client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


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
