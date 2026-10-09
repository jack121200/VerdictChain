"""Manual 'Simulate scenario' trigger (SKILL-architecture.md Section 4, plan section 3.5).

Order: authenticate, capability inject_scenario, rate limit, intake paused (423), rows (404), dominant
investigator (422), noise dilution, debate slot (409), daily caps (429), start_investigation, then the
debate. wait=true runs the debate inline and returns 201 with the verdict. wait=false returns 202 at once
and runs the debate in a background thread. Either way the debate slot is released in finally.
"""

import asyncio
import logging
import re
import threading
import uuid
from dataclasses import dataclass
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from backend.api.auth import CurrentAnalyst, require_capability
from backend.api.rate_limit import (
    GLOBAL_CAP_IDENTIFIER,
    IDEMPOTENCY_PENDING,
    DebateSlot,
    claim_idempotency,
    client_ip,
    enforce_daily_cap,
    enforce_rate_limit,
    finish_idempotency,
    record_daily_run,
    release_idempotency,
    slot_holder,
)
from backend.api.schemas.realtime import SimulateAcceptedOut, SimulateScenarioRequest
from backend.api.websocket import make_debate_broadcaster
from backend.config import settings
from backend.db.models import AgentQuarantine, Investigation
from backend.db.session import SessionLocal
from backend.debate.engine import (
    INVESTIGATORS,
    MIN_ACTIVE_AGENTS,
    DebateFailedError,
    run_debate,
    start_investigation,
)
from backend.debate.state import dominant_agent_for_rows
from backend.pipeline.log_streamer import get_rows_for_scenario
from backend.pipeline.noise import dilute_with_benign

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/investigations", tags=["investigations"])

INVESTIGATION_STATUS_ON_START = "investigating"
IDEMPOTENCY_HEADER = "Idempotency-Key"
REPLAY_HEADER = "Idempotent-Replay"
_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,100}$")


@dataclass
class _Prepared:
    investigation_id: uuid.UUID
    primary_agent: str
    rows: list
    scenario_rows: list
    max_rows: int
    scenario_label: str
    noise_pct: int
    effective_noise_pct: float
    slot: DebateSlot


@router.post(
    "/simulate",
    response_model=None,
    status_code=status.HTTP_201_CREATED,
    # wait=false returns 202 with this body; documenting it lets the frontend contract check validate it.
    responses={status.HTTP_202_ACCEPTED: {"model": SimulateAcceptedOut}},
)
async def simulate_scenario(
    payload: SimulateScenarioRequest,
    request: Request,
    response: Response,
    actor: CurrentAnalyst = Depends(require_capability("inject_scenario")),
) -> Any:
    enforce_rate_limit("simulate", client_ip(request), limit=5, window_seconds=60)

    # A retry or a double click that carries the same Idempotency-Key gets the first request's investigation
    # back (202 + Idempotent-Replay) instead of starting a second debate.
    idempotency_key = _idempotency_key(request)
    if idempotency_key:
        stored = await run_in_threadpool(claim_idempotency, actor.username, idempotency_key)
        if stored == IDEMPOTENCY_PENDING:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail="A request with this Idempotency-Key is still being processed. Retry in a moment.",
            )
        if stored is not None:
            replay = await run_in_threadpool(_accepted_for, stored)
            if replay is None:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail="This Idempotency-Key refers to an investigation that no longer exists.",
                )
            response.status_code = status.HTTP_202_ACCEPTED
            response.headers[REPLAY_HEADER] = "true"
            return replay

    try:
        prepared = await run_in_threadpool(_prepare, payload, actor.username)
    except BaseException:
        if idempotency_key:  # refused: the key stays usable for a corrected retry
            await run_in_threadpool(release_idempotency, actor.username, idempotency_key)
        raise
    if idempotency_key:
        await run_in_threadpool(
            finish_idempotency, actor.username, idempotency_key, str(prepared.investigation_id)
        )
    loop = asyncio.get_running_loop()

    if payload.wait:
        try:
            return await run_in_threadpool(_run, prepared, loop)
        except DebateFailedError as exc:
            # Both LLM providers exhausted mid-debate. The Investigation is already marked status='error'
            # by run_debate, so the client gets an actionable message rather than a bare 500.
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail=f"Debate could not complete (investigation {exc.investigation_id}): {exc.reason}",
            ) from exc

    response.status_code = status.HTTP_202_ACCEPTED
    threading.Thread(
        target=_run_in_background,
        args=(prepared, loop),
        name=f"debate-{prepared.investigation_id}",
        daemon=True,
    ).start()
    return SimulateAcceptedOut(
        investigation_id=str(prepared.investigation_id),
        status=INVESTIGATION_STATUS_ON_START,
        ws_path=f"/ws/investigations/{prepared.investigation_id}",
        noise_pct=prepared.noise_pct,
        effective_noise_pct=prepared.effective_noise_pct,
        primary_agent=prepared.primary_agent,
    )


def _idempotency_key(request: Request) -> str | None:
    raw = request.headers.get(IDEMPOTENCY_HEADER)
    if raw is None:
        return None
    if not _IDEMPOTENCY_KEY_RE.fullmatch(raw):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{IDEMPOTENCY_HEADER} must be 8-100 characters: letters, digits, '_', '.', ':' or '-'.",
        )
    return raw


def _accepted_for(investigation_id: str) -> SimulateAcceptedOut | None:
    """The 202 body for an investigation that already exists (an idempotent replay), or None."""
    try:
        parsed = uuid.UUID(investigation_id)
    except ValueError:
        return None
    with SessionLocal() as session:
        inv = session.get(Investigation, parsed)
        if inv is None:
            return None
        return SimulateAcceptedOut(
            investigation_id=str(inv.investigation_id),
            status=inv.status,
            ws_path=f"/ws/investigations/{inv.investigation_id}",
            noise_pct=inv.noise_pct or 0,
            effective_noise_pct=inv.effective_noise_pct or 0.0,
            primary_agent=inv.primary_agent or "",
        )


def _prepare(payload: SimulateScenarioRequest, username: str) -> _Prepared:
    """Every check that can refuse a run, then the investigation row. Holds the slot on success."""
    # Imported here so tests can patch the settings loader. W1-B owns backend/db/runtime_settings.py.
    from backend.db.runtime_settings import load as load_runtime_settings

    if load_runtime_settings().intake_paused:
        raise HTTPException(
            status.HTTP_423_LOCKED,
            detail="Intake is paused. New investigations are refused until it is resumed in Settings.",
        )

    rows = get_rows_for_scenario(payload.scenario_label)
    if not rows:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"No rows for scenario {payload.scenario_label!r}"
        )
    try:
        primary_agent, primary_rows = dominant_agent_for_rows(rows)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Scenario {payload.scenario_label!r} has no rows in any investigator domain: {exc}",
        ) from exc

    window, dropped_ids, effective_pct = dilute_with_benign(
        primary_rows, payload.noise_pct, payload.max_rows_per_agent
    )

    slot = DebateSlot()
    if not slot.acquire():
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_busy_detail(slot_holder()))
    try:
        if _active_agent_count() < MIN_ACTIVE_AGENTS:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=(
                    f"Fewer than {MIN_ACTIVE_AGENTS} investigator agents are active. "
                    "Restore a quarantined agent first."
                ),
            )
        enforce_daily_cap(
            "debate_user",
            username,
            settings.debate_daily_limit_user,
            "Daily debate limit reached for this analyst. Try again tomorrow.",
        )
        enforce_daily_cap(
            "debate_global",
            GLOBAL_CAP_IDENTIFIER,
            settings.debate_daily_limit_global,
            "Daily debate limit reached across all analysts. Try again tomorrow.",
        )
        investigation_id = start_investigation(
            trigger_type="manual",
            trigger_reason="manual simulated injection",
            scenario_label=payload.scenario_label,
            primary_agent=primary_agent,
            noise_pct=payload.noise_pct,
            effective_noise_pct=effective_pct,
            injected_row_ids=dropped_ids,
            started_by=username,
            max_rows_per_agent=payload.max_rows_per_agent,
        )
        slot.bind(str(investigation_id))
    except BaseException:
        slot.release()
        raise

    record_daily_run("debate_user", username)
    record_daily_run("debate_global", GLOBAL_CAP_IDENTIFIER)
    return _Prepared(
        investigation_id=investigation_id,
        primary_agent=primary_agent,
        rows=window,
        scenario_rows=rows,
        max_rows=payload.max_rows_per_agent,
        scenario_label=payload.scenario_label,
        noise_pct=payload.noise_pct,
        effective_noise_pct=effective_pct,
        slot=slot,
    )


def _run(prepared: _Prepared, loop: asyncio.AbstractEventLoop) -> dict:
    """Runs the debate on the prepared investigation. Releases the slot in every outcome."""
    try:
        return run_debate(
            prepared.primary_agent,
            prepared.rows,
            investigation_id=prepared.investigation_id,
            max_rows_per_agent=prepared.max_rows,
            on_update=make_debate_broadcaster(str(prepared.investigation_id), prepared.scenario_label, loop),
            scenario_rows=prepared.scenario_rows,
        )
    finally:
        prepared.slot.release()


def _run_in_background(prepared: _Prepared, loop: asyncio.AbstractEventLoop) -> None:
    try:
        _run(prepared, loop)
    except DebateFailedError as exc:
        logger.warning("background debate %s failed: %s", exc.investigation_id, exc.reason)
    except Exception:  # noqa: BLE001 - a thread must never die silently; the investigation is marked error
        logger.exception("background debate %s crashed", prepared.investigation_id)


def _active_agent_count() -> int:
    with SessionLocal() as session:
        quarantined = set(
            session.execute(select(AgentQuarantine.agent_id).where(AgentQuarantine.active.is_(True)))
            .scalars()
            .all()
        )
    return sum(1 for agent in INVESTIGATORS if agent not in quarantined)


def _busy_detail(holder: str | None) -> str:
    try:
        uuid.UUID(holder or "")
    except ValueError:
        return "Another debate or maintenance operation holds the slot. Wait for it to finish and retry."
    return f"A debate is already running (investigation {holder}). Wait for it to finish and retry."
