"""Investigation read endpoints and analyst feedback. The 'Simulate scenario' trigger is in simulate.py.

Investigation rows never carry scenario_label in any response. Stance and votes are derived on the
server from the debate transcripts, so the browser never parses theory text.
"""

import re
import uuid
from collections import Counter
from typing import get_args

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session

from backend.agents.schemas import AgentId
from backend.api.auth import get_current_user
from backend.api.routes.evidence import (
    citation_summary,
    investigation_transcripts,
    load_investigation_citations,
)
from backend.api.schemas import FeedbackRequest
from backend.api.schemas.read import (
    AgentVoteOut,
    CitedEvidenceOut,
    CredibilityLogOut,
    DebateRoundOut,
    InvestigationDetailOut,
    InvestigationSummaryOut,
    ResponseActionOut,
)
from backend.db.models import AnalystFeedback, CredibilityLog, DebateTranscript, Investigation, ResponseAction
from backend.db.session import SessionLocal
from backend.debate.verdict import _CLASS_KEYWORDS, classify_theory

router = APIRouter(prefix="/investigations", tags=["investigations"])

INVESTIGATOR_IDS: tuple[str, ...] = get_args(AgentId)

# The dataset each investigator reads (SKILL-architecture.md Section 2).
DATASET_BY_AGENT: dict[str, str] = {
    "network_traffic": "CICIDS2017",
    "access_log": "CERT r4.2",
    "endpoint_behavior": "CERT r4.2",
}

_STANCE_RE = re.compile(r"^\s*(CHALLENGE|SUPPORT|REVISE)\b")


def stance_of(theory: str) -> str | None:
    """The first token of the theory when it is CHALLENGE, SUPPORT or REVISE (the prompt requires it)."""
    match = _STANCE_RE.match(theory)
    return match.group(1) if match else None


def matched_keywords(theory: str, vote_class: str) -> list[str]:
    text = theory.lower()
    return [keyword for keyword in _CLASS_KEYWORDS.get(vote_class, []) if keyword in text]


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def rounds_complete_by_investigation(session: Session, investigation_ids: list[uuid.UUID]) -> Counter:
    """Counts the rounds in which all three investigators have a transcript row."""
    if not investigation_ids:
        return Counter()
    rows = session.execute(
        select(
            DebateTranscript.investigation_id,
            DebateTranscript.round,
            func.count(func.distinct(DebateTranscript.agent_id)),
        )
        .where(
            DebateTranscript.investigation_id.in_(investigation_ids),
            DebateTranscript.agent_id.in_(INVESTIGATOR_IDS),
        )
        .group_by(DebateTranscript.investigation_id, DebateTranscript.round)
    ).all()
    complete: Counter = Counter()
    for investigation_id, _round, agents in rows:
        if agents == len(INVESTIGATOR_IDS):
            complete[investigation_id] += 1
    return complete


def containment_by_investigation(session: Session, investigation_ids: list[uuid.UUID]) -> Counter:
    if not investigation_ids:
        return Counter()
    rows = session.execute(
        select(ResponseAction.investigation_id, func.count())
        .where(ResponseAction.investigation_id.in_(investigation_ids))
        .group_by(ResponseAction.investigation_id)
    ).all()
    return Counter({investigation_id: count for investigation_id, count in rows})


def _summary(
    investigation: Investigation, rounds_complete: int, containment_count: int
) -> InvestigationSummaryOut:
    primary = investigation.primary_agent
    return InvestigationSummaryOut(
        investigation_id=str(investigation.investigation_id),
        trigger_type=investigation.trigger_type,
        status=investigation.status,
        verdict_class=investigation.verdict_class,
        verdict_confidence=investigation.verdict_confidence,
        primary_agent=primary,
        dataset=DATASET_BY_AGENT.get(primary) if primary else None,
        noise_pct=investigation.noise_pct,
        rounds_complete=rounds_complete,
        containment_count=containment_count,
        created_at=investigation.created_at,
    )


@router.get("", response_model=list[InvestigationSummaryOut])
def list_investigations(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status_filter: str | None = Query(None, alias="status", max_length=64),
    verdict_class: str | None = Query(None, max_length=64),
    trigger_type: str | None = Query(None, max_length=64),
    primary_agent: str | None = Query(None, max_length=64),
    q: str | None = Query(None, max_length=200),
    username: str = Depends(get_current_user),
) -> list[InvestigationSummaryOut]:
    session = SessionLocal()
    try:
        query = select(Investigation)
        if status_filter:
            query = query.where(Investigation.status == status_filter)
        if verdict_class:
            query = query.where(Investigation.verdict_class == verdict_class)
        if trigger_type:
            query = query.where(Investigation.trigger_type == trigger_type)
        if primary_agent:
            query = query.where(Investigation.primary_agent == primary_agent)
        term = (q or "").strip()
        if term:
            escaped = _escape_like(term)
            query = query.where(
                or_(
                    cast(Investigation.investigation_id, Text).ilike(f"{escaped}%", escape="\\"),
                    Investigation.verdict_class.ilike(f"%{escaped}%", escape="\\"),
                    Investigation.trigger_type.ilike(f"%{escaped}%", escape="\\"),
                )
            )
        rows = (
            session.execute(
                query.order_by(Investigation.created_at.desc(), Investigation.investigation_id)
                .limit(limit)
                .offset(offset)
            )
            .scalars()
            .all()
        )
        ids = [r.investigation_id for r in rows]
        rounds = rounds_complete_by_investigation(session, ids)
        containment = containment_by_investigation(session, ids)
        return [_summary(r, rounds[r.investigation_id], containment[r.investigation_id]) for r in rows]
    finally:
        session.close()


def _votes(transcripts: list[DebateTranscript]) -> list[AgentVoteOut]:
    """Each agent's vote is its latest transcript (highest round). The input is ordered by round."""
    latest: dict[str, DebateTranscript] = {}
    for transcript in transcripts:
        latest[transcript.agent_id] = transcript
    votes = []
    for agent_id in INVESTIGATOR_IDS:
        if agent_id not in latest:
            continue
        transcript = latest[agent_id]
        vote_class = classify_theory(transcript.theory)
        votes.append(
            AgentVoteOut(
                agent_id=agent_id,
                round=transcript.round,
                vote_class=vote_class,
                matched_keywords=matched_keywords(transcript.theory, vote_class),
            )
        )
    return votes


@router.get("/{investigation_id}", response_model=InvestigationDetailOut)
def get_investigation(
    investigation_id: uuid.UUID, username: str = Depends(get_current_user)
) -> InvestigationDetailOut:
    session = SessionLocal()
    try:
        inv = session.get(Investigation, investigation_id)
        if inv is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")

        transcripts = investigation_transcripts(session, investigation_id)
        credibility_rows = (
            session.execute(
                select(CredibilityLog)
                .where(CredibilityLog.investigation_id == investigation_id)
                .order_by(CredibilityLog.round, CredibilityLog.agent_id)
            )
            .scalars()
            .all()
        )
        action_rows = (
            session.execute(
                select(ResponseAction)
                .where(ResponseAction.investigation_id == investigation_id)
                .order_by(ResponseAction.created_at, ResponseAction.id)
            )
            .scalars()
            .all()
        )
        checked = load_investigation_citations(session, transcripts)
        rounds = rounds_complete_by_investigation(session, [investigation_id])[investigation_id]
        summary = _summary(inv, rounds, len(action_rows))

        return InvestigationDetailOut(
            **summary.model_dump(),
            effective_noise_pct=inv.effective_noise_pct,
            debate=[
                DebateRoundOut(
                    round=t.round,
                    agent_id=t.agent_id,
                    theory=t.theory,
                    confidence=t.confidence,
                    stance=stance_of(t.theory),
                    provider=t.provider,
                    cited_evidence=[CitedEvidenceOut.model_validate(e) for e in t.cited_evidence],
                    created_at=t.created_at,
                )
                for t in transcripts
            ],
            votes=_votes(transcripts),
            citations=citation_summary(
                [c.status for _, c in checked], source=f"/investigations/{investigation_id}"
            ),
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
                    id=str(a.id),
                    investigation_id=str(a.investigation_id) if a.investigation_id else None,
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
