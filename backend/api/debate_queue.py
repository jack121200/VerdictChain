"""The debate queue (checklist SD2 and SD4).

One debate runs at a time on purpose: the credibility scores are shared state and the LLM quota is global.
A request that arrives while one is running is no longer refused. It is accepted as an investigation with
status 'queued', and one worker thread runs the accepted debates one after the other, oldest first.

The queue is the investigations table itself (status 'queued', queued_at, run_spec; migration 0008), so a
waiting debate survives an API restart: the worker finds it again when the process starts. run_spec holds
ids and numbers only (see build_run_spec), never a label. The scenario label stays on the investigation row,
and the worker reads it only to pick the scenario's rows, as the simulate request did before it.

Rules the worker follows: it starts a debate only while it holds the debate slot (a maintenance operation
holds the same slot), never while intake is paused (the accepted debates wait), and it claims a job with
FOR UPDATE SKIP LOCKED, so a second API process could share the table without running a debate twice.
Accepting a debate is limited per analyst and in total (settings debate_queue_max_per_user and
debate_queue_max_total).
"""

import asyncio
import logging
import threading
import time
import uuid
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.api.rate_limit import DebateSlot
from backend.api.websocket import make_debate_broadcaster
from backend.config import settings
from backend.db.audit import append_entry
from backend.db.models import AgentQuarantine, Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate.engine import INVESTIGATORS, DebateFailedError, NotEnoughActiveAgents, run_debate
from backend.pipeline.log_streamer import get_rows_for_scenario

logger = logging.getLogger(__name__)

QUEUED = "queued"
POLL_SECONDS = 2.0  # how often an idle worker looks for a job that was queued by another process
KEPT_OUTCOMES = 64  # finished runs somebody may still be waiting on (wait=true requests)


@dataclass(frozen=True)
class QueuedJob:
    investigation_id: uuid.UUID
    primary_agent: str
    scenario_label: str | None
    run_spec: dict


@dataclass(frozen=True)
class Outcome:
    result: dict | None = None
    error: Exception | None = None


def build_run_spec(
    *,
    primary_agent: str,
    row_ids: list[uuid.UUID],
    scenario_row_ids: list[uuid.UUID] | None,
    max_rows_per_agent: int,
    requested_by: str,
) -> dict:
    """What the worker needs to run the debate later. scenario_row_ids None means 'every row of the
    investigation's scenario', looked up when the debate starts."""
    return {
        "primary_agent": primary_agent,
        "row_ids": [str(row_id) for row_id in row_ids],
        "scenario_row_ids": (
            None if scenario_row_ids is None else [str(row_id) for row_id in scenario_row_ids]
        ),
        "max_rows_per_agent": max_rows_per_agent,
        "requested_by": requested_by,
    }


def _queued_filter():
    return Investigation.status == QUEUED


def queue_length(session: Session) -> int:
    return session.execute(
        select(func.count()).select_from(Investigation).where(_queued_filter())
    ).scalar_one()


def queue_position(session: Session, investigation_id: uuid.UUID) -> tuple[int, int] | None:
    """(position starting at 1, how many are waiting) for a queued investigation, else None."""
    inv = session.get(Investigation, investigation_id)
    if inv is None or inv.status != QUEUED:
        return None
    ahead = session.execute(
        select(func.count())
        .select_from(Investigation)
        .where(
            _queued_filter(),
            (Investigation.queued_at < inv.queued_at)
            | ((Investigation.queued_at == inv.queued_at) & (Investigation.created_at < inv.created_at)),
        )
    ).scalar_one()
    return ahead + 1, queue_length(session)


def enforce_queue_capacity(username: str) -> None:
    """429 when the queue is full, in total or for this analyst."""
    with SessionLocal() as session:
        total = queue_length(session)
        mine = session.execute(
            select(func.count())
            .select_from(Investigation)
            .where(_queued_filter(), Investigation.run_spec["requested_by"].astext == username)
        ).scalar_one()
    if total >= settings.debate_queue_max_total:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"The debate queue is full ({total} waiting). Try again when one has finished.",
        )
    if mine >= settings.debate_queue_max_per_user:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"You already have {mine} debates waiting. Wait for one to start before adding more.",
        )


def _load_rows(row_ids: list[str]) -> list[RawLog]:
    if not row_ids:
        return []
    with SessionLocal() as session:
        rows = session.execute(
            select(RawLog).where(RawLog.row_id.in_([uuid.UUID(r) for r in row_ids]))
        ).scalars()
        return sorted(rows, key=lambda row: (row.timestamp, str(row.row_id)))


def _claim_next() -> QueuedJob | None:
    """Takes the oldest queued investigation: status investigating plus a debate_started audit entry."""
    with SessionLocal() as session:
        inv = session.execute(
            select(Investigation)
            .where(_queued_filter())
            .order_by(Investigation.queued_at, Investigation.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        ).scalar_one_or_none()
        if inv is None:
            return None
        waited = (datetime.now(timezone.utc) - inv.queued_at).total_seconds() if inv.queued_at else 0.0
        inv.status = "investigating"
        inv.updated_at = func.now()
        append_entry(
            session,
            actor="debate_queue",
            action="debate_started",
            detail={"waited_seconds": round(max(waited, 0.0), 1)},
            investigation_id=inv.investigation_id,
        )
        job = QueuedJob(
            inv.investigation_id, inv.primary_agent or "", inv.scenario_label, dict(inv.run_spec or {})
        )
        session.commit()
        return job


def _has_queued() -> bool:
    with SessionLocal() as session:
        return (
            session.execute(select(Investigation.investigation_id).where(_queued_filter()).limit(1)).first()
            is not None
        )


def intake_paused() -> bool:
    from backend.db.runtime_settings import load as load_runtime_settings

    return load_runtime_settings().intake_paused


def active_agent_count() -> int:
    """Investigators that are not quarantined."""
    with SessionLocal() as session:
        quarantined = set(
            session.execute(select(AgentQuarantine.agent_id).where(AgentQuarantine.active.is_(True)))
            .scalars()
            .all()
        )
    return sum(1 for agent in INVESTIGATORS if agent not in quarantined)


class DebateWorker:
    """The one thread that runs queued debates. Started on first use, so a test client without a lifespan
    works, and by the app's lifespan, so a debate queued before a restart runs again."""

    def __init__(self) -> None:
        self._start_lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._wake = threading.Event()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._cond = threading.Condition()
        self._outcomes: OrderedDict[str, Outcome] = OrderedDict()

    def ensure_started(self, loop: asyncio.AbstractEventLoop | None = None) -> None:
        if loop is not None:
            self._loop = loop
        with self._start_lock:
            if self._thread is None or not self._thread.is_alive():
                self._thread = threading.Thread(target=self._main, name="debate-queue-worker", daemon=True)
                self._thread.start()
        self._wake.set()

    def notify(self) -> None:
        self._wake.set()

    def wait_for(self, investigation_id: uuid.UUID, timeout: float) -> Outcome:
        """Blocks until the worker has finished this investigation. Raises TimeoutError."""
        key = str(investigation_id)
        deadline = time.monotonic() + timeout
        with self._cond:
            while key not in self._outcomes:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(key)
                self._cond.wait(remaining)
            return self._outcomes[key]

    def _publish(self, investigation_id: uuid.UUID, outcome: Outcome) -> None:
        with self._cond:
            self._outcomes[str(investigation_id)] = outcome
            while len(self._outcomes) > KEPT_OUTCOMES:
                self._outcomes.popitem(last=False)
            self._cond.notify_all()

    def _main(self) -> None:
        while True:
            try:
                ran = self._run_next()
            except Exception:  # noqa: BLE001 - the worker must outlive any single failure
                logger.exception("debate queue worker iteration failed")
                ran = False
            if not ran:
                self._wake.wait(POLL_SECONDS)
                self._wake.clear()

    def _run_next(self) -> bool:
        if not _has_queued() or intake_paused():
            return False
        slot = DebateSlot(label="queue")
        if not slot.acquire():
            return False  # a debate or a maintenance operation holds the slot
        job: QueuedJob | None = None
        outcome = Outcome()
        try:
            job = _claim_next()
            if job is None:
                return False
            slot.bind(str(job.investigation_id))
            outcome = self._execute(job)
        finally:
            slot.release()
        if job is not None:
            self._publish(job.investigation_id, outcome)
        return job is not None

    def _broadcaster(self, investigation_id: uuid.UUID) -> Callable[[dict], None]:
        loop = self._loop
        if loop is None:
            return lambda message: None
        return make_debate_broadcaster(str(investigation_id), loop)

    def _execute(self, job: QueuedJob) -> Outcome:
        spec = job.run_spec
        try:
            primary_rows = _load_rows(spec["row_ids"])
            if spec.get("scenario_row_ids") is not None:
                scenario_rows = _load_rows(spec["scenario_row_ids"])
            elif job.scenario_label:
                scenario_rows = get_rows_for_scenario(job.scenario_label)
            else:
                scenario_rows = None
            result = run_debate(
                job.primary_agent,
                primary_rows,
                investigation_id=job.investigation_id,
                max_rows_per_agent=spec["max_rows_per_agent"],
                on_update=self._broadcaster(job.investigation_id),
                scenario_rows=scenario_rows,
            )
            return Outcome(result=result)
        except DebateFailedError as exc:
            logger.warning("queued debate %s failed: %s", exc.investigation_id, exc.reason)
            return Outcome(error=exc)
        except NotEnoughActiveAgents as exc:  # run_debate has marked the investigation error
            logger.warning("queued debate %s not run: %s", job.investigation_id, exc)
            return Outcome(error=exc)
        except Exception as exc:  # noqa: BLE001 - run_debate marks its own failures; this covers the rest
            logger.exception("queued debate %s crashed", job.investigation_id)
            _mark_error(job.investigation_id)
            return Outcome(error=exc)


def _mark_error(investigation_id: uuid.UUID) -> None:
    with SessionLocal() as session:
        inv = session.get(Investigation, investigation_id)
        if inv is not None and inv.status == "investigating":
            inv.status = "error"
            inv.updated_at = func.now()
            session.commit()


worker = DebateWorker()
