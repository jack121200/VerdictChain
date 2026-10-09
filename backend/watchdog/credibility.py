"""Continuous per-agent Credibility Score (CrS) - SKILL-data-schema.md Section 5.

CrS_new = clamp(CrS_old * (1 + eta * (2 * rate - 1)), 0, 1), with rate = the round's
verification match rate in [0, 1] and eta = 0.20 by default.
rate 0.5 leaves CrS unchanged, rate 1 grows it by eta, rate 0 shrinks it by eta.
From the starting 0.5 with eta 0.20, three consecutive rate-0 rounds (0.40, 0.32, 0.256) take
CrS below the 0.30 isolation threshold, so an agent none of whose citations verify for a whole
3-round debate is isolated when round 3 is scored. (At the earlier eta 0.15 three such rounds
left 0.307, above the threshold, so isolation needed a fourth round in a later debate.)
Formula: resolved 2026-10-05, owner-approved (the earlier multiplier 1 + eta * rate could
only hold or grow CrS, so isolation was unreachable). Default eta 0.15 -> 0.20: 2026-10-09,
migration 0007; eta stays an audited runtime setting in [0.01, 0.5].

Lives in Redis for fast read/write; every update is also logged to Postgres
credibility_log by watchdog/service.py (Redis is a cache, Postgres is the durable record).

Isolation is persistent and is recorded in Postgres (agent_quarantine, set by
backend/debate/engine.py). The Redis flag mirrors the last scored state. reset_agent()
restores the starting CrS and clears the flag. It is called only by the audited restore
action, never by the debate itself.
"""

import redis

from backend.config import settings

STARTING_CRS = 0.5
ETA = 0.20
ISOLATION_THRESHOLD = 0.30
# An agent below this CrS keeps debating but cannot trigger AUTONOMOUS containment: it needs at least the
# credibility of a fresh agent. (The gate used to be the isolation threshold, which an agent that still
# contributes can never be under, so it never refused anything.)
AUTONOMOUS_ACTION_MIN_CRS = STARTING_CRS

_redis_client: redis.Redis | None = None


def _client() -> redis.Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def _crs_key(agent_id: str) -> str:
    return f"verdictchain:crs:{agent_id}"


def _isolated_key(agent_id: str) -> str:
    return f"verdictchain:isolated:{agent_id}"


def get_crs(agent_id: str) -> float:
    value = _client().get(_crs_key(agent_id))
    return float(value) if value is not None else STARTING_CRS


def is_isolated(agent_id: str) -> bool:
    return _client().get(_isolated_key(agent_id)) == "1"


def reset_agent(agent_id: str) -> None:
    """Restores the starting CrS and clears the isolation flag."""
    _client().set(_crs_key(agent_id), STARTING_CRS)
    _client().delete(_isolated_key(agent_id))


def compute_crs(c: float, rate: float, eta: float) -> float:
    """clamp(c * (1 + eta * (2 * rate - 1)), 0, 1). Pure function, no Redis."""
    if not 0.0 <= rate <= 1.0:
        raise ValueError(f"verification match rate must be in [0, 1], got {rate}")
    return max(0.0, min(1.0, c * (1 + eta * (2 * rate - 1))))


def update_crs(
    agent_id: str,
    rate: float,
    eta: float = ETA,
    isolation_threshold: float = ISOLATION_THRESHOLD,
) -> tuple[float, float, bool]:
    """Returns (crs_before, crs_after, isolated)."""
    crs_before = get_crs(agent_id)
    crs_after = compute_crs(crs_before, rate, eta)
    _client().set(_crs_key(agent_id), crs_after)

    isolated = crs_after < isolation_threshold
    if isolated:
        _client().set(_isolated_key(agent_id), "1")
    return crs_before, crs_after, isolated
