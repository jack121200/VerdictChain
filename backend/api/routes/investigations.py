"""Manual 'Simulate scenario' trigger + investigation read endpoints
(SKILL-architecture.md Section 4). The heavy debate work runs synchronously
inside run_debate, offloaded to a worker thread via run_in_threadpool so the
async event loop is never blocked (SKILL-conventions.md: "no blocking calls
inside async def... without an async driver or run_in_executor" - the whole
data/agent layer is sync by design, built and tested that way in Modules 1-6;
threadpool offload satisfies the async-handler requirement without an
enormous, high-risk rewrite of already-working code).
"""

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import select

from backend.api.auth import get_current_user
from backend.api.rate_limit import client_ip, enforce_rate_limit
from backend.api.schemas import (
    CredibilityLogOut,
    DebateRoundOut,
    FeedbackRequest,
    InvestigationDetailOut,
    InvestigationSummaryOut,
    ResponseActionOut,
    SimulateScenarioRequest,
)
from backend.db.models import AnalystFeedback, CredibilityLog, DebateTranscript, Investigation, ResponseAction
from backend.db.session import SessionLocal
from backend.debate.engine import DebateFailedError, run_debate
from backend.debate.state import primary_agent_for_rows
from backend.pipeline.log_streamer import get_rows_for_scenario

router = APIRouter(prefix="/investigations", tags=["investigations"])


@router.post("/simulate", status_code=status.HTTP_201_CREATED)
async def simulate_scenario(
    payload: SimulateScenarioRequest,
    request: Request,
    username: str = Depends(get_current_user),
) -> dict:
    enforce_rate_limit("simulate", client_ip(request), limit=5, window_seconds=60)

    rows = await run_in_threadpool(get_rows_for_scenario, payload.scenario_label)
    if not rows:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, detail=f"No rows for scenario {payload.scenario_label!r}"
        )

    primary_agent = primary_agent_for_rows(rows)
    loop = asyncio.get_running_loop()

    try:
        result = await run_in_threadpool(
            _run_debate_with_broadcast,
            primary_agent,
            rows,
            payload.scenario_label,
            payload.max_rows_per_agent,
            loop,
        )
    except DebateFailedError as exc:
        # Both LLM providers exhausted mid-debate (observed live this session -
        # a real, if uncommon, failure mode, not hypothetical). The
        # Investigation is already marked status='error' by run_debate itself;
        # this just gives the client something actionable instead of a bare 500.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            detail=f"Debate could not complete (investigation {exc.investigation_id}): {exc.reason}",
        ) from exc

    return result


def _run_debate_with_broadcast(primary_agent, rows, scenario_label, max_rows_per_agent, loop):
    """investigation_id doesn't exist until run_debate() creates it internally,
    and round 1's first on_update() fires before the caller could ever learn
    that id - so live updates are broadcast on a scenario-keyed channel
    (`scenario:{scenario_label}`), not an investigation-id-keyed one. The
    WebSocket route (main.py) subscribes by scenario_label for exactly this
    reason: a client opens the socket BEFORE calling /simulate and starts
    receiving round 1 immediately, rather than racing to learn an id first.
    """
    from backend.api.websocket import manager

    def _on_update(message: dict) -> None:
        asyncio.run_coroutine_threadsafe(manager.broadcast(f"scenario:{scenario_label}", message), loop)

    return run_debate(
        primary_agent,
        rows,
        max_rows_per_agent=max_rows_per_agent,
        scenario_label=scenario_label,
        on_update=_on_update,
    )


@router.get("", response_model=list[InvestigationSummaryOut])
def list_investigations(username: str = Depends(get_current_user)) -> list[InvestigationSummaryOut]:
    session = SessionLocal()
    try:
        rows = (
            session.execute(select(Investigation).order_by(Investigation.created_at.desc())).scalars().all()
        )
        return [
            InvestigationSummaryOut(
                investigation_id=str(r.investigation_id),
                trigger_type=r.trigger_type,
                status=r.status,
                verdict_class=r.verdict_class,
                verdict_confidence=r.verdict_confidence,
                created_at=r.created_at,
            )
            for r in rows
        ]
    finally:
        session.close()


@router.get("/{investigation_id}", response_model=InvestigationDetailOut)
def get_investigation(
    investigation_id: uuid.UUID, username: str = Depends(get_current_user)
) -> InvestigationDetailOut:
    session = SessionLocal()
    try:
        inv = session.get(Investigation, investigation_id)
        if inv is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")

        debate_rows = (
            session.execute(
                select(DebateTranscript)
                .where(DebateTranscript.investigation_id == investigation_id)
                .order_by(DebateTranscript.round)
            )
            .scalars()
            .all()
        )
        credibility_rows = (
            session.execute(
                select(CredibilityLog)
                .where(CredibilityLog.investigation_id == investigation_id)
                .order_by(CredibilityLog.round)
            )
            .scalars()
            .all()
        )
        action_rows = (
            session.execute(select(ResponseAction).where(ResponseAction.investigation_id == investigation_id))
            .scalars()
            .all()
        )

        return InvestigationDetailOut(
            investigation_id=str(inv.investigation_id),
            trigger_type=inv.trigger_type,
            status=inv.status,
            verdict_class=inv.verdict_class,
            verdict_confidence=inv.verdict_confidence,
            created_at=inv.created_at,
            debate=[
                DebateRoundOut(
                    round=d.round,
                    agent_id=d.agent_id,
                    theory=d.theory,
                    confidence=d.confidence,
                    cited_evidence=d.cited_evidence,
                    created_at=d.created_at,
                )
                for d in debate_rows
            ],
            credibility=[
                CredibilityLogOut(
                    round=c.round,
                    agent_id=c.agent_id,
                    crs_before=c.crs_before,
                    crs_after=c.crs_after,
                    verification_match_rate=c.verification_match_rate,
                    isolated=c.isolated,
                    created_at=c.created_at,
                )
                for c in credibility_rows
            ],
            actions=[
                ResponseActionOut(
                    action_type=a.action_type,
                    target=a.target,
                    reason=a.reason,
                    is_simulated=a.is_simulated,
                    created_at=a.created_at,
                )
                for a in action_rows
            ],
        )
    finally:
        session.close()


@router.post("/{investigation_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def submit_feedback(
    investigation_id: uuid.UUID, payload: FeedbackRequest, username: str = Depends(get_current_user)
) -> None:
    session = SessionLocal()
    try:
        if session.get(Investigation, investigation_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")
        session.add(
            AnalystFeedback(
                investigation_id=investigation_id, verdict_was_correct=payload.verdict_was_correct
            )
        )
        session.commit()
    finally:
        session.close()
