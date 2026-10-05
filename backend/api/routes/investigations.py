"""Investigation read endpoints and analyst feedback. The 'Simulate scenario' trigger is in simulate.py."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from backend.api.auth import get_current_user
from backend.api.schemas import (
    CredibilityLogOut,
    DebateRoundOut,
    FeedbackRequest,
    InvestigationDetailOut,
    InvestigationSummaryOut,
    ResponseActionOut,
)
from backend.db.models import AnalystFeedback, CredibilityLog, DebateTranscript, Investigation, ResponseAction
from backend.db.session import SessionLocal

router = APIRouter(prefix="/investigations", tags=["investigations"])


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
