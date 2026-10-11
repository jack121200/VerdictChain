"""Manual 'Simulate scenario' trigger (SKILL-architecture.md Section 4, plan section 3.5).

Order: authenticate, capability inject_scenario, rate limit, intake paused (423), the provider's own
allowance (429), rows (404), dominant
investigator (422), noise dilution, active investigators (409), queue capacity (429), daily caps (429),
start_investigation. The accepted investigation goes into the debate queue (backend/api/debate_queue.py):
the workers run up to DEBATE_MAX_CONCURRENT debates at once, so a request that arrives while every debate slot
is busy waits as 'queued' instead of being refused. wait=true blocks until the debate has finished and returns
201 with the verdict; wait=false returns 202 at once.
"""

import asyncio
import re
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool

from backend.agents import openai_usage
from backend.api.auth import CurrentAnalyst, require_capability
from backend.api.debate_queue import (
    active_agent_count,
    build_run_spec,
    enforce_queue_capacity,
    intake_paused,
    queue_position,
    worker,
)
from backend.api.rate_limit import (
    GLOBAL_CAP_IDENTIFIER,
    IDEMPOTENCY_PENDING,
    claim_idempotency,
    client_ip,
    enforce_daily_cap,
    enforce_rate_limit,
    finish_idempotency,
    record_daily_run,
    release_idempotency,
)
from backend.api.schemas.realtime import SimulateAcceptedOut, SimulateScenarioRequest
from backend.config import settings
from backend.db.models import Investigation
from backend.db.session import SessionLocal
from backend.debate.engine import (
    ESTIMATED_TOKENS_PER_DEBATE,
    MIN_ACTIVE_AGENTS,
    REQUESTS_PER_DEBATE,
    DebateFailedError,
    start_investigation,
)
from backend.debate.state import dominant_agent_for_rows
from backend.pipeline.log_streamer import get_rows_for_scenario
from backend.pipeline.noise import dilute_with_benign

router = APIRouter(prefix="/investigations", tags=["investigations"])

IDEMPOTENCY_HEADER = "Idempotency-Key"
REPLAY_HEADER = "Idempotent-Replay"
_IDEMPOTENCY_KEY_RE = re.compile(r"^[A-Za-z0-9_.:-]{8,100}$")
# How long a wait=true request waits for its debate (the queue plus the debate itself).
WAIT_TIMEOUT_SECONDS = 3600.0


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
        investigation_id, primary_agent = await run_in_threadpool(_accept, payload, actor.username)
    except BaseException:
        if idempotency_key:  # refused: the key stays usable for a corrected retry
            await run_in_threadpool(release_idempotency, actor.username, idempotency_key)
        raise
    if idempotency_key:
        await run_in_threadpool(finish_idempotency, actor.username, idempotency_key, str(investigation_id))
    worker.ensure_started(asyncio.get_running_loop())

    if payload.wait:
        try:
            outcome = await run_in_threadpool(worker.wait_for, investigation_id, WAIT_TIMEOUT_SECONDS)
        except TimeoutError as exc:
            raise HTTPException(
                status.HTTP_504_GATEWAY_TIMEOUT,
                detail=(
                    f"Investigation {investigation_id} has not finished yet. "
                    f"Follow it at /investigations/{investigation_id}/progress."
                ),
            ) from exc
        if isinstance(outcome.error, DebateFailedError):
            # Both LLM providers exhausted mid-debate. The Investigation is already marked status='error'
            # by run_debate, so the client gets an actionable message rather than a bare 500.
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                detail=(
                    f"Debate could not complete (investigation {investigation_id}): {outcome.error.reason}"
                ),
            ) from outcome.error
        if outcome.error is not None:
            raise HTTPException(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Debate could not run (investigation {investigation_id}): {outcome.error}",
            ) from outcome.error
        return outcome.result

    response.status_code = status.HTTP_202_ACCEPTED
    return await run_in_threadpool(_accepted_for, str(investigation_id))


def _idempotency_key(request: Request) -> str | None:
    raw = request.headers.get(IDEMPOTENCY_HEADER)
    if raw is None:
        return None
    if not _IDEMPOTENCY_KEY_RE.fullmatch(raw):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"{IDEMPOTENCY_HEADER} must be 8-100 characters: letters, digits, '_', '.', ':' or '-'.",
        )
    return raw


def _accepted_for(investigation_id: str) -> SimulateAcceptedOut | None:
    """The 202 body for an investigation that exists (a new one, or an idempotent replay), or None."""
    try:
        parsed = uuid.UUID(investigation_id)
    except ValueError:
        return None
    with SessionLocal() as session:
        inv = session.get(Investigation, parsed)
        if inv is None:
            return None
        position = queue_position(session, parsed)
        return SimulateAcceptedOut(
            investigation_id=str(inv.investigation_id),
            status=inv.status,
            ws_path=f"/ws/investigations/{inv.investigation_id}",
            noise_pct=inv.noise_pct or 0,
            effective_noise_pct=inv.effective_noise_pct or 0.0,
            primary_agent=inv.primary_agent or "",
            queue_position=position[0] if position else None,
            queue_length=position[1] if position else None,
        )


def _accept(payload: SimulateScenarioRequest, username: str) -> tuple[uuid.UUID, str]:
    """Every check that can refuse a run, then the queued investigation row."""
    if intake_paused():
        raise HTTPException(
            status.HTTP_423_LOCKED,
            detail="Intake is paused. New investigations are refused until it is resumed in Settings.",
        )

    # What OpenAI itself allows this key (its own answers say so): a debate it would refuse is declined now,
    # in words, instead of being queued and failing after minutes of retries.
    if (
        allowance := openai_usage.allowance_block(
            needed_requests=REQUESTS_PER_DEBATE, needed_tokens=ESTIMATED_TOKENS_PER_DEBATE
        )
    ) is not None:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, detail=allowance)

    rows = get_rows_for_scenario(payload.scenario_label)
    if not rows:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"No rows for scenario {payload.scenario_label!r}"
        )
    try:
        primary_agent, primary_rows = dominant_agent_for_rows(rows)
    except ValueError as exc:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Scenario {payload.scenario_label!r} has no rows in any investigator domain: {exc}",
        ) from exc

    window, dropped_ids, effective_pct = dilute_with_benign(
        primary_rows, payload.noise_pct, payload.max_rows_per_agent
    )

    if active_agent_count() < MIN_ACTIVE_AGENTS:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail=(
                f"Fewer than {MIN_ACTIVE_AGENTS} investigator agents are active. "
                "Restore a quarantined agent first."
            ),
        )
    enforce_queue_capacity(username)
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
        run_spec=build_run_spec(
            primary_agent=primary_agent,
            row_ids=[row.row_id for row in window],
            scenario_row_ids=None,  # every row of the scenario, looked up when the debate starts
            max_rows_per_agent=payload.max_rows_per_agent,
            requested_by=username,
        ),
    )
    record_daily_run("debate_user", username)
    record_daily_run("debate_global", GLOBAL_CAP_IDENTIFIER)
    return investigation_id, primary_agent
