"""Investigation read endpoints and analyst feedback. The 'Simulate scenario' trigger is in simulate.py.

Investigation rows never carry scenario_label in any response. Stance and votes are derived on the
server from the debate transcripts, so the browser never parses theory text.
"""

import re
import uuid
from collections import Counter
from datetime import datetime, timezone
from typing import get_args

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session

from backend.agents.schemas import AgentId
from backend.api.auth import get_current_user
from backend.api.debate_queue import queue_position
from backend.api.provenance import data_source_by_investigation, source_of
from backend.api.rate_limit import slot_holder
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
    InputBasisOut,
    InvestigationDetailOut,
    InvestigationSummaryOut,
    ResponseActionOut,
)
from backend.api.schemas.realtime import InvestigationProgressOut
from backend.db.models import (
    AnalystFeedback,
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    ResponseAction,
)
from backend.db.session import SessionLocal
from backend.debate.engine import DEBATE_ROUNDS
from backend.debate.verdict import _CLASS_KEYWORDS, classify_theory
from backend.evaluation.adaptive_threshold import adapt

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
    """Counts the rounds the engine finished. It writes one `round_completed` audit entry per round, after
    every ACTIVE agent has answered, so a round still counts when an agent was quarantined or isolated
    (counting transcripts per round would call every such round unfinished)."""
    if not investigation_ids:
        return Counter()
    rows = session.execute(
        select(AuditTrail.investigation_id, func.count())
        .where(AuditTrail.action == "round_completed", AuditTrail.investigation_id.in_(investigation_ids))
        .group_by(AuditTrail.investigation_id)
    ).all()
    return Counter({investigation_id: count for investigation_id, count in rows})


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
    investigation: Investigation, rounds_complete: int, containment_count: int, data_source: str
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
        data_source=data_source,
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
        sources = data_source_by_investigation(session, ids)
        return [
            _summary(
                r,
                rounds[r.investigation_id],
                containment[r.investigation_id],
                sources.get(r.investigation_id, "model"),
            )
            for r in rows
        ]
    finally:
        session.close()


def isolated_agents(session: Session, investigation_id: uuid.UUID) -> set[str]:
    """Agents the Watchdog isolated during this investigation. The engine leaves them out of the verdict
    (backend/debate/engine.py), so every read that re-derives votes or a verdict must leave them out too."""
    return set(
        session.execute(
            select(CredibilityLog.agent_id).where(
                CredibilityLog.investigation_id == investigation_id, CredibilityLog.isolated.is_(True)
            )
        )
        .scalars()
        .all()
    )


def input_basis_for(session: Session, investigation_id: uuid.UUID) -> dict[str, InputBasisOut]:
    """How each agent's data slice was chosen, from the first round_completed audit entry (the engine records
    it there). Empty for an investigation that predates the record."""
    detail = session.execute(
        select(AuditTrail.detail)
        .where(AuditTrail.investigation_id == investigation_id, AuditTrail.action == "round_completed")
        .order_by(AuditTrail.seq)
        .limit(1)
    ).scalar_one_or_none()
    raw = (detail or {}).get("input_basis")
    if not isinstance(raw, dict):
        return {}
    return {
        agent: InputBasisOut(basis=str(item["basis"]), row_count=int(item["row_count"]))
        for agent, item in raw.items()
        if isinstance(item, dict) and "basis" in item and "row_count" in item
    }


def _votes(transcripts: list[DebateTranscript], isolated: set[str]) -> list[AgentVoteOut]:
    """Each agent's vote is its latest transcript (highest round). The input is ordered by round. An agent
    isolated in this investigation keeps its row but is marked not counted."""
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
                counted=agent_id not in isolated,
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
        summary = _summary(
            inv, rounds, len(action_rows), source_of(transcript.provider for transcript in transcripts)
        )

        return InvestigationDetailOut(
            **summary.model_dump(),
            effective_noise_pct=inv.effective_noise_pct,
            input_basis=input_basis_for(session, investigation_id),
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
            votes=_votes(transcripts, {c.agent_id for c in credibility_rows if c.isolated}),
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


_FINISHED_STATUSES = frozenset({"verdict_reached", "ambiguous", "contained"})


def _investigation_id_or_none(slot_value: str | None) -> str | None:
    """The slot holds an investigation id while a debate runs (a pending token or label otherwise)."""
    try:
        return str(uuid.UUID(slot_value or ""))
    except ValueError:
        return None


@router.get("/{investigation_id}/progress", response_model=InvestigationProgressOut)
def get_progress(
    investigation_id: uuid.UUID, username: str = Depends(get_current_user)
) -> InvestigationProgressOut:
    """Cheap to poll: where the debate is, from the database and the debate slot."""
    with SessionLocal() as session:
        inv = session.get(Investigation, investigation_id)
        if inv is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")
        done = rounds_complete_by_investigation(session, [investigation_id])[investigation_id]
        current_status, created_at = inv.status, inv.created_at
        position = queue_position(session, investigation_id)

    holder = slot_holder()
    if current_status == "error":
        phase = "error"
    elif current_status in _FINISHED_STATUSES:
        phase = "finished"
    elif current_status == "queued":
        phase = "queued"
    elif holder == str(investigation_id):
        phase = "running"
    else:
        phase = "unknown"
    return InvestigationProgressOut(
        investigation_id=str(investigation_id),
        phase=phase,
        status=current_status,
        rounds_total=DEBATE_ROUNDS,
        rounds_complete=done,
        round=min(done + 1, DEBATE_ROUNDS) if phase == "running" else None,
        elapsed_seconds=round((datetime.now(timezone.utc) - created_at).total_seconds(), 1),
        queue_position=position[0] if position else None,
        queue_length=position[1] if position else None,
        waiting_for=_investigation_id_or_none(holder) if phase == "queued" else None,
    )


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
        # The feedback may move the verdict threshold one small step (LG10). The move is audited.
        adapt(session)
        session.commit()
    finally:
        session.close()
