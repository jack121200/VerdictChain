"""Boot-time validation (SKILL-security.md Section 1): the JWT secret, Postgres, Redis and an LLM key.

collect_problems() returns one plain sentence per problem. run_startup_checks() runs it when the app starts:
with ENVIRONMENT=production any problem aborts startup with ONE message that lists all of them, in
development each problem is logged as a WARNING and the app starts anyway (the offline stub harness has no
LLM keys and must still start).

Messages name the setting or service and, for a failed probe, the exception class. They never carry a
secret value, a URL or an exception message, because those can hold a password.
"""

import asyncio
import logging
from collections.abc import Callable

import redis
from sqlalchemy import text

from backend.config import Settings, settings

logger = logging.getLogger(__name__)

MIN_JWT_SECRET_LENGTH = 32
PROBE_TIMEOUT_S = 3.0
STARTUP_CHECK_TIMEOUT_S = 10.0

# Values that .env.example ships with or that people leave behind. Compared in lower case.
_PLACEHOLDER_VALUES = frozenset(
    {"secret", "password", "jwt_secret", "secret_key", "test", "dev", "development"}
)
_PLACEHOLDER_MARKERS = (
    "change_me",
    "changeme",
    "change-me",
    "replace_me",
    "your_",
    "your-",
    "_here",
    "<",
    ">",
)


class StartupCheckError(RuntimeError):
    """Raised in production when the startup checks found at least one problem."""


def _is_placeholder(value: str) -> bool:
    lowered = value.strip().lower()
    return lowered in _PLACEHOLDER_VALUES or any(marker in lowered for marker in _PLACEHOLDER_MARKERS)


def _probe_postgres() -> str | None:
    """None when the database answers SELECT 1, otherwise the exception class name."""
    from backend.db.session import engine

    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 - reported by class name only
        return type(exc).__name__
    return None


def _probe_redis(cfg: Settings) -> str | None:
    """None when Redis answers PING, otherwise the exception class name."""
    client = redis.Redis.from_url(
        cfg.redis_url, socket_connect_timeout=PROBE_TIMEOUT_S, socket_timeout=PROBE_TIMEOUT_S
    )
    try:
        client.ping()
    except Exception as exc:  # noqa: BLE001
        return type(exc).__name__
    finally:
        client.close()
    return None


def collect_problems(
    cfg: Settings = settings,
    *,
    postgres_probe: Callable[[], str | None] = _probe_postgres,
    redis_probe: Callable[[Settings], str | None] = _probe_redis,
) -> list[str]:
    """Every problem found, in a fixed order. An empty list means the app can start."""
    problems: list[str] = []

    secret = cfg.jwt_secret_key
    if not secret.strip():
        problems.append("JWT_SECRET_KEY is not set")
    elif _is_placeholder(secret):
        problems.append("JWT_SECRET_KEY is still a placeholder value; set a long random secret")
    elif len(secret) < MIN_JWT_SECRET_LENGTH:
        problems.append(f"JWT_SECRET_KEY is shorter than {MIN_JWT_SECRET_LENGTH} characters")

    if (error := postgres_probe()) is not None:
        problems.append(f"PostgreSQL did not answer SELECT 1 ({error})")
    if (error := redis_probe(cfg)) is not None:
        problems.append(f"Redis did not answer PING ({error})")

    key = cfg.openai_api_key
    if not key.strip() or _is_placeholder(key):
        problems.append("no LLM provider key is configured: set OPENAI_API_KEY")
    return problems


def _abort_message(problems: list[str]) -> str:
    listed = "\n".join(f"  {number}. {problem}" for number, problem in enumerate(problems, start=1))
    return (
        f"Refusing to start with ENVIRONMENT=production: {len(problems)} startup check(s) failed.\n"
        f"{listed}\nFix them in .env or the environment, then start again."
    )


async def run_startup_checks(cfg: Settings = settings) -> None:
    """Runs collect_problems off the event loop, bounded in time. Aborts in production, warns otherwise."""
    try:
        problems = await asyncio.wait_for(asyncio.to_thread(collect_problems, cfg), STARTUP_CHECK_TIMEOUT_S)
    except TimeoutError:
        problems = [f"the startup checks did not finish within {STARTUP_CHECK_TIMEOUT_S:.0f} s"]
    if not problems:
        return
    if cfg.environment == "production":
        raise StartupCheckError(_abort_message(problems))
    for problem in problems:
        logger.warning("startup check: %s", problem)
