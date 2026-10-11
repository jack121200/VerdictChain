"""System status (plan section 3.5): service probes, provider configuration and 24 h call counts, sandbox
counters, the debate slot and runtime flags. Nothing here returns a key, a password or a URL: errors are
reported as the exception class name only, because a message can carry a connection string.

The probes run concurrently, each bounded by PROBE_TIMEOUT_S, so the response takes about 2 s at worst.
"""

import asyncio
import socket
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import TypeVar
from urllib.parse import urlsplit

import redis
from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends
from sqlalchemy import func, select, text
from sqlalchemy.exc import SQLAlchemyError

from backend.agents.llm_clients import model_name
from backend.api.auth import CurrentAnalyst, get_current_analyst
from backend.api.live_runner import runner
from backend.api.metrics import Metric
from backend.api.openai_allowance import build_allowance
from backend.api.rate_limit import slot_capacity, slot_holders
from backend.api.schemas.admin import (
    DebateSlotOut,
    ProviderOut,
    ProvidersOut,
    SandboxOut,
    ServiceOut,
    SystemStatusOut,
)
from backend.config import settings
from backend.db.models import DebateTranscript, ResponseAction
from backend.db.runtime_settings import load
from backend.db.session import SessionLocal, engine
from backend.debate import provider_stats

router = APIRouter(prefix="/system", tags=["system"])

API_VERSION = "2.4.0"  # the one place the API version is set (pyproject.toml carries no version)
# Mirrors the temperature literal that the client in backend/agents/llm_clients.py sends.
# test_system.py fails if the source and this value diverge.
LLM_TEMPERATURE = 0.2
PROVIDER_NAMES = ("openai",)  # the client's `name`, as stored in debate_transcripts.provider
PROBE_TIMEOUT_S = 2.0
_AMQP_DEFAULT_PORTS = {"amqp": 5672, "amqps": 5671}
_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "db" / "migrations"

T = TypeVar("T")


@dataclass(frozen=True)
class _Probe:
    ok: bool
    latency_ms: float | None
    error_class: str | None


@dataclass(frozen=True)
class _ProviderStats:
    latency_ms: float | None  # mean call time in the last 24 h; None without calls
    calls: int
    quota_errors: int


@dataclass(frozen=True)
class _DbStats:
    calls_24h: dict[str, int]
    actions_total: int
    sandbox_violations: int
    intake_paused: bool
    provider_stats: dict[str, _ProviderStats] | None  # None when Redis could not be read


_TIMED_OUT = _Probe(False, None, "timeout")


SLOT_SOURCE = "redis sorted set verdictchain:debate:slots"


def _capacity_metric() -> Metric[int]:
    return _metric(
        int,
        slot_capacity(),
        1,
        "DEBATE_MAX_CONCURRENT",
        "how many debates may run at once (setting); a maintenance operation takes every slot",
    )


def _unavailable_slot() -> DebateSlotOut:
    return DebateSlotOut(
        status="unavailable",
        investigation_id=None,
        running=_metric(int, None, 0, SLOT_SOURCE, "debates holding a slot now", "Redis could not be read"),
        capacity=_capacity_metric(),
        investigation_ids=[],
    )


def _slot_state(holders: list[str]) -> DebateSlotOut:
    """What the slots hold: a pending token counts as running (a debate is starting), only ids are listed."""
    ids: list[str] = []
    for holder in holders:
        try:
            ids.append(str(uuid.UUID(holder)))
        except ValueError:
            continue
    return DebateSlotOut(
        status="running" if holders else "idle",
        investigation_id=ids[0] if ids else (holders[0] if holders else None),
        running=_metric(
            int,
            len(holders),
            len(holders),
            SLOT_SOURCE,
            "debates holding a debate slot now; a debate that is starting counts until it has an id",
        ),
        capacity=_capacity_metric(),
        investigation_ids=ids,
    )


def _elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000.0


def _probe_postgres() -> _Probe:
    started = time.perf_counter()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception as exc:  # any failure is reported by class name only
        return _Probe(False, None, type(exc).__name__)
    return _Probe(True, _elapsed_ms(started), None)


def _probe_redis() -> tuple[_Probe, DebateSlotOut]:
    """PING, then the debate slots. They are 'unavailable' when Redis cannot be read, never 'idle'."""
    started = time.perf_counter()
    client = redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=PROBE_TIMEOUT_S,
        socket_timeout=PROBE_TIMEOUT_S,
    )
    try:
        client.ping()
        latency = _elapsed_ms(started)
        holders = slot_holders(client)
    except Exception as exc:
        return _Probe(False, None, type(exc).__name__), _unavailable_slot()
    else:
        return _Probe(True, latency, None), _slot_state(holders)
    finally:
        client.close()


def _probe_rabbitmq() -> _Probe:
    """TCP connect to the broker host and port. Reachability only: no AMQP handshake, no credentials."""
    started = time.perf_counter()
    try:
        parts = urlsplit(settings.rabbitmq_url)
        if not parts.hostname:
            raise ValueError("RABBITMQ_URL has no host")
        port = parts.port or _AMQP_DEFAULT_PORTS.get(parts.scheme, 5672)
        with socket.create_connection((parts.hostname, port), timeout=PROBE_TIMEOUT_S):
            pass
    except Exception as exc:
        return _Probe(False, None, type(exc).__name__)
    return _Probe(True, _elapsed_ms(started), None)


def _read_db_stats() -> _DbStats:
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    with SessionLocal() as session:
        per_provider = dict(
            session.execute(
                select(DebateTranscript.provider, func.count())
                .where(DebateTranscript.created_at >= since, DebateTranscript.provider.in_(PROVIDER_NAMES))
                .group_by(DebateTranscript.provider)
            ).all()
        )
        actions_total = session.execute(select(func.count()).select_from(ResponseAction)).scalar_one()
        violations = session.execute(
            select(func.count()).select_from(ResponseAction).where(ResponseAction.is_simulated.is_(False))
        ).scalar_one()
        intake_paused = load(session).intake_paused
    return _DbStats(
        calls_24h={name: int(per_provider.get(name, 0)) for name in PROVIDER_NAMES},
        actions_total=int(actions_total),
        sandbox_violations=int(violations),
        intake_paused=intake_paused,
        provider_stats=_read_provider_stats(),
    )


def _read_provider_stats() -> dict[str, _ProviderStats] | None:
    try:
        stats = {}
        for name in PROVIDER_NAMES:
            mean, calls = provider_stats.latency_ms(name)
            stats[name] = _ProviderStats(mean, calls, provider_stats.quota_errors(name))
        return stats
    except redis.RedisError:
        return None


async def _bounded(fn: Callable[[], T], on_timeout: T) -> T:
    try:
        return await asyncio.wait_for(asyncio.to_thread(fn), PROBE_TIMEOUT_S)
    except TimeoutError:
        return on_timeout


async def _db_stats() -> _DbStats | None:
    try:
        return await asyncio.wait_for(asyncio.to_thread(_read_db_stats), PROBE_TIMEOUT_S)
    except (TimeoutError, SQLAlchemyError, OSError):
        return None


@lru_cache(maxsize=1)
def _migration_head() -> str:
    config = Config()
    config.set_main_option("script_location", str(_MIGRATIONS_DIR))
    return ScriptDirectory.from_config(config).get_current_head() or "none"


def _metric[
    V
](kind: type[V], value: V | None, n: int, source: str, definition: str, reason: str | None = None) -> Metric[
    V
]:
    return Metric[kind](
        value=value,
        n=n,
        as_of=datetime.now(timezone.utc),
        source=source,
        definition=definition,
        reason=reason,
    )


def _service(probe: _Probe, source: str) -> ServiceOut:
    reason = None if probe.ok else f"probe failed: {probe.error_class}"
    latency = _metric(
        float, probe.latency_ms, 1 if probe.ok else 0, source, "wall-clock ms for one probe", reason
    )
    return ServiceOut(ok=probe.ok, latency_ms=latency, error_class=probe.error_class)


def _db_reason(pg: _Probe) -> str:
    return f"postgres probe failed: {pg.error_class}" if not pg.ok else "database query failed or timed out"


def _provider(name: str, model: str, configured: bool, db: _DbStats | None, db_reason: str) -> ProviderOut:
    count = db.calls_24h[name] if db is not None else None
    stats = db.provider_stats[name] if db is not None and db.provider_stats is not None else None
    stats_reason = db_reason if db is None else "redis could not be read"
    return ProviderOut(
        configured=configured,
        model=model,
        temperature=_metric(
            float, LLM_TEMPERATURE, 1, "backend/agents/llm_clients.py", "sampling temperature per call"
        ),
        calls_24h=_metric(
            int,
            count,
            count or 0,
            "debate_transcripts.provider, created_at within 24 h",
            f"debate transcript rows written by {name} in the last 24 h",
            None if db is not None else db_reason,
        ),
        latency_ms=_metric(
            float,
            stats.latency_ms if stats is not None else None,
            stats.calls if stats is not None else 0,
            "debate engine timer, kept in redis for 24 h",
            f"mean time an investigator waited for {name} to answer in the last 24 h, including the client's "
            "own spacing between calls and any fallback; n = calls timed",
            (
                None
                if stats is not None and stats.calls
                else stats_reason if stats is None else f"no {name} calls in 24 h"
            ),
        ),
        quota_errors_24h=_metric(
            int,
            stats.quota_errors if stats is not None else None,
            stats.quota_errors if stats is not None else 0,
            "debate engine failures, kept in redis for 24 h",
            f"debates ended by a {name} quota or rate-limit error in the last 24 h",
            None if stats is not None else stats_reason,
        ),
        allowance=build_allowance(),
    )


@router.get("/status", response_model=SystemStatusOut)
async def system_status(_: CurrentAnalyst = Depends(get_current_analyst)) -> SystemStatusOut:
    pg, (redis_probe, slot), rmq, db = await asyncio.gather(
        _bounded(_probe_postgres, _TIMED_OUT),
        _bounded(_probe_redis, (_TIMED_OUT, _unavailable_slot())),
        _bounded(_probe_rabbitmq, _TIMED_OUT),
        _db_stats(),
    )
    db_reason = _db_reason(pg)
    sandbox_source = "response_actions"
    return SystemStatusOut(
        postgres=_service(pg, "postgres SELECT 1 through the app engine"),
        redis=_service(redis_probe, "redis PING"),
        rabbitmq=_service(rmq, "TCP connect to the RABBITMQ_URL host and port (reachability only)"),
        providers=ProvidersOut(
            openai=_provider("openai", model_name(), bool(settings.openai_api_key.strip()), db, db_reason),
        ),
        sandbox=SandboxOut(
            is_simulated_violations=_metric(
                int,
                db.sandbox_violations if db is not None else None,
                db.actions_total if db is not None else 0,
                f"{sandbox_source} WHERE is_simulated = false",
                "rows that are not simulated (must be 0); n is the number of action rows checked",
                None if db is not None else db_reason,
            ),
            actions_total=_metric(
                int,
                db.actions_total if db is not None else None,
                db.actions_total if db is not None else 0,
                f"count of {sandbox_source} rows",
                "self-healing actions recorded, all simulated",
                None if db is not None else db_reason,
            ),
        ),
        debate_slot=slot,
        intake_paused=db.intake_paused if db is not None else None,
        continuous_mode=runner.running,
        api_version=API_VERSION,
        migration_head=_migration_head(),
    )
