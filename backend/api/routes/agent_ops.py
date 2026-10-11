"""Agent operations (plan sections 3.5 and 2.8): dry-run fault injection, quarantine and restore.

Quarantine and restore hold the debate slot while they write, so a debate cannot start (or be running)
while the active set changes. The route answers 409 instead.
"""

import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.api.auth import CurrentAnalyst, require_capability
from backend.api.rate_limit import DebateSlot, enforce_rate_limit, slot_holder
from backend.api.schemas.ops import (
    AgentOpOut,
    CitationCheckOut,
    FaultInjectionOut,
    FaultInjectionRequest,
    ProjectedRoundOut,
    QuarantineRequest,
    RestoreRequest,
)
from backend.db.audit import append_entry
from backend.db.models import AgentQuarantine
from backend.db.session import SessionLocal
from backend.debate.engine import INVESTIGATORS
from backend.watchdog.credibility import get_crs, reset_agent
from backend.watchdog.fault_injection import (
    NoDomainRows,
    build_poisoned_citation,
    citation_view,
    match_rate_of,
    project_trajectory,
)
from backend.watchdog.verification import check_citation

router = APIRouter(prefix="/agents", tags=["agent-ops"])

FAULT_INJECTION_RATE_LIMIT = 10  # per analyst, per minute


@router.post("/{agent_id}/fault-injection", response_model=FaultInjectionOut)
def inject_fault(
    agent_id: str,
    body: FaultInjectionRequest,
    actor: CurrentAnalyst = Depends(require_capability("override_fault_weights")),
) -> FaultInjectionOut:
    _known_agent(agent_id)
    enforce_rate_limit("fault_injection", actor.username, limit=FAULT_INJECTION_RATE_LIMIT, window_seconds=60)

    # Imported here so tests can patch the settings loader. W1-B owns backend/db/runtime_settings.py.
    from backend.db.runtime_settings import load as load_runtime_settings

    with SessionLocal() as session:
        try:
            poisoned = build_poisoned_citation(body.kind, agent_id, session)
        except NoDomainRows as exc:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail=f"No raw rows in the {agent_id} domain to build a value mismatch from.",
            ) from exc
        check = check_citation(session, poisoned)
        match_rate = match_rate_of(check)

        production_before = get_crs(agent_id)
        live = load_runtime_settings()
        trajectory, would_isolate_at = project_trajectory(
            production_before, match_rate, body.rounds, live.eta, live.isolation_threshold
        )
        production_after = get_crs(agent_id)

        append_entry(
            session,
            actor=actor.username,
            action="byzantine_fault_injected",
            detail={
                "agent_id": agent_id,
                "kind": body.kind,
                "rounds": body.rounds,
                "citation_status": check.status,
                "citation_reason": check.reason,
                "projected_match_rate": match_rate,
                "would_isolate_at_round": would_isolate_at,
                "production_crs_before": production_before,
                "production_crs_after": production_after,
                "dry_run": True,
            },
        )
        session.commit()

    return FaultInjectionOut(
        agent_id=agent_id,
        kind=body.kind,
        citation=CitationCheckOut(**citation_view(check)),
        projected_match_rate=match_rate,
        eta=live.eta,
        isolation_threshold=live.isolation_threshold,
        projected_trajectory=[ProjectedRoundOut(**point) for point in trajectory],
        would_isolate_at_round=would_isolate_at,
        production_crs_before=production_before,
        production_crs_after=production_after,
        production_crs_unchanged=production_before == production_after,
    )


@router.post("/{agent_id}/quarantine", response_model=AgentOpOut)
def quarantine_agent(
    agent_id: str,
    body: QuarantineRequest,
    actor: CurrentAnalyst = Depends(require_capability("quarantine_agent")),
) -> AgentOpOut:
    _known_agent(agent_id)
    with _maintenance_slot():
        with SessionLocal() as session:
            row = _lock_quarantine_row(session, agent_id)
            if row.active:
                raise HTTPException(status.HTTP_409_CONFLICT, detail=f"{agent_id} is already quarantined.")
            previous = get_crs(agent_id)
            row.active = True
            row.reason = body.reason
            row.set_by = actor.username
            row.updated_at = datetime.now(timezone.utc)
            append_entry(
                session,
                actor=actor.username,
                action="agent_quarantined",
                detail={"agent_id": agent_id, "previous_crs": previous, "reason": body.reason},
            )
            session.commit()
    return AgentOpOut(agent_id=agent_id, active=True, previous_crs=previous, crs_now=get_crs(agent_id))


@router.post("/{agent_id}/restore", response_model=AgentOpOut)
def restore_agent(
    agent_id: str,
    body: RestoreRequest,
    actor: CurrentAnalyst = Depends(require_capability("quarantine_agent")),
) -> AgentOpOut:
    _known_agent(agent_id)
    with _maintenance_slot():
        with SessionLocal() as session:
            row = _lock_quarantine_row(session, agent_id)
            if not row.active:
                raise HTTPException(status.HTTP_409_CONFLICT, detail=f"{agent_id} is not quarantined.")
            previous = get_crs(agent_id)
            # CrS is reset before the commit: if the reset fails, the agent stays quarantined, which is the
            # safe side. A reset without the commit only leaves a healthy score on a quarantined agent.
            reset_agent(agent_id)
            row.active = False
            row.reason = None
            row.set_by = actor.username
            row.updated_at = datetime.now(timezone.utc)
            append_entry(
                session,
                actor=actor.username,
                action="agent_restored",
                detail={"agent_id": agent_id, "previous_crs": previous, "note": body.note},
            )
            session.commit()
    return AgentOpOut(agent_id=agent_id, active=False, previous_crs=previous, crs_now=get_crs(agent_id))


def _known_agent(agent_id: str) -> None:
    if agent_id not in INVESTIGATORS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown agent {agent_id!r}")


@contextmanager
def _maintenance_slot() -> Iterator[None]:
    """Holds every debate slot for one quarantine or restore. A running debate answers 409 instead."""
    slot = DebateSlot(exclusive=True)
    if not slot.acquire():
        raise HTTPException(status.HTTP_409_CONFLICT, detail=_slot_busy_detail(slot_holder()))
    try:
        yield
    finally:
        slot.release()


def _slot_busy_detail(holder: str | None) -> str:
    try:
        return f"A debate is running (investigation {uuid.UUID(holder or '')}). Retry when it finishes."
    except ValueError:
        return "A debate or another maintenance operation is starting. Retry when it finishes."


def _lock_quarantine_row(session: Session, agent_id: str) -> AgentQuarantine:
    row = session.get(AgentQuarantine, agent_id, with_for_update=True)
    if row is None:  # the migration seeds one row per agent; create it defensively
        row = AgentQuarantine(agent_id=agent_id, active=False)
        session.add(row)
        session.flush()
    return row
