"""Continuous per-agent Credibility Score (CrS) - SKILL-data-schema.md Section 5.
CrS_new = clamp(CrS_old * (1 + eta * verification_match_rate), 0, 1), eta=0.15.
Lives in Redis for fast read/write; every update is also logged to Postgres
credibility_log by watchdog/service.py (Redis is a cache, Postgres is the
durable audit record).

Design note on "activate a backup agent instance" (SKILL-architecture.md
Section 6): there is one code implementation per agent, not multiple physical
instances, so a "freshly-activated backup" is represented as a full state
reset - CrS back to the neutral starting value, isolation flag cleared. This
is a deliberate interpretation, not something either skill file specifies
literally, flagged here for review.

*** FLAGGED DEFECT (2026-09-07, verified with real arithmetic, not asserted
from a failing test) *** The formula as LITERALLY specified is implemented
here exactly as written, but it is mathematically incapable of ever isolating
an agent that starts at the spec's own starting value:
  CrS_new = CrS_old * (1 + eta * verification_match_rate)
For verification_match_rate in [0, 1] and eta > 0, the multiplier (1 + eta*rate)
is ALWAYS >= 1.0 - the formula can only hold CrS flat (rate=0) or grow it
(rate>0). It has no term that ever decreases CrS. Starting from CrS=0.5 (the
spec's own starting value) and ISOLATION_THRESHOLD=0.30, CrS can never fall
below 0.30 under ANY sequence of verification outcomes, so the isolation path
in SKILL-architecture.md Section 6 is unreachable from normal operation as
currently specified. Isolation still triggers correctly if CrS is ever
otherwise below 0.30 (verified by test) - the mechanism itself is not broken,
only the arithmetic that's supposed to feed it. NOT silently changed to a
different formula (e.g. penalizing failures with something like
`1 + eta*(2*rate - 1)`) since that would be an unauthorized deviation from a
locked spec value - needs a decision from the project owner.
"""

import redis

from backend.config import settings

STARTING_CRS = 0.5
ETA = 0.15
ISOLATION_THRESHOLD = 0.30

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
    """"Activate a backup" - see module docstring."""
    _client().set(_crs_key(agent_id), STARTING_CRS)
    _client().delete(_isolated_key(agent_id))


def update_crs(agent_id: str, verification_match_rate: float) -> tuple[float, float, bool]:
    """Returns (crs_before, crs_after, isolated)."""
    crs_before = get_crs(agent_id)
    crs_after = max(0.0, min(1.0, crs_before * (1 + ETA * verification_match_rate)))
    _client().set(_crs_key(agent_id), crs_after)

    isolated = crs_after < ISOLATION_THRESHOLD
    if isolated:
        _client().set(_isolated_key(agent_id), "1")
    return crs_before, crs_after, isolated
