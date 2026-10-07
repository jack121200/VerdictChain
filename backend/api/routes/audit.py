"""Audit trail read and on-demand chain verification (SKILL-security.md Section 5, plan section 3.4).

The chain is verified over every entry on each call, so `chain.valid` covers the whole log, not just the
returned page. POST /audit-trail/verify is rate limited per analyst and is not itself audited.
"""

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.auth import get_current_user
from backend.api.rate_limit import enforce_rate_limit
from backend.api.schemas.read import AuditChainOut, AuditEntryOut, AuditTrailOut, AuditVerifyOut
from backend.db.audit import find_first_break, hash_input, is_known_action
from backend.db.models import AuditTrail
from backend.db.session import SessionLocal

router = APIRouter(prefix="/audit-trail", tags=["audit"])

VERIFY_LIMIT_PER_MINUTE = 10


def _all_entries(session: Session) -> list[AuditTrail]:
    return list(session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all())


def _entry_out(entry: AuditTrail) -> AuditEntryOut:
    detail: dict[str, Any] | None = entry.detail
    return AuditEntryOut(
        id=str(entry.id),
        seq=entry.seq,
        prev_hash=entry.prev_hash,
        entry_hash=entry.entry_hash,
        hash_input=hash_input(entry.actor, entry.action, detail, entry.prev_hash),
        actor=entry.actor,
        action=entry.action,
        detail=detail,
        investigation_id=str(entry.investigation_id) if entry.investigation_id else None,
        created_at=entry.created_at,
    )


@router.get("", response_model=AuditTrailOut)
def list_audit_trail(
    limit: int = Query(100, ge=1, le=500),
    before_seq: int | None = Query(None, ge=1),
    action: str | None = Query(None, max_length=64),
    actor: str | None = Query(None, max_length=128),
    investigation_id: uuid.UUID | None = None,
    username: str = Depends(get_current_user),
) -> AuditTrailOut:
    if action is not None and not is_known_action(action):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail=f"Unknown audit action {action!r}")

    session = SessionLocal()
    try:
        everything = _all_entries(session)
        broken = find_first_break(everything)
        chain = AuditChainOut(
            valid=broken is None,
            head_seq=everything[-1].seq if everything else None,
            total=len(everything),
        )

        query = select(AuditTrail)
        if before_seq is not None:
            query = query.where(AuditTrail.seq < before_seq)
        if action is not None:
            query = query.where(AuditTrail.action == action)
        if actor is not None:
            query = query.where(AuditTrail.actor == actor)
        if investigation_id is not None:
            query = query.where(AuditTrail.investigation_id == investigation_id)
        page = session.execute(query.order_by(AuditTrail.seq.desc()).limit(limit)).scalars().all()

        return AuditTrailOut(entries=[_entry_out(e) for e in page], chain=chain, chain_valid=chain.valid)
    finally:
        session.close()


@router.post("/verify", response_model=AuditVerifyOut)
def verify_audit_trail(username: str = Depends(get_current_user)) -> AuditVerifyOut:
    enforce_rate_limit("audit_verify", username, limit=VERIFY_LIMIT_PER_MINUTE, window_seconds=60)

    session = SessionLocal()
    try:
        entries = _all_entries(session)
        head_hash = entries[-1].entry_hash if entries else None
        broken = find_first_break(entries)
        if broken is None:
            return AuditVerifyOut(
                chain_valid=True,
                entries_checked=len(entries),
                first_break_seq=None,
                reason="ok",
                head_hash=head_hash,
            )
        index, reason = broken
        return AuditVerifyOut(
            chain_valid=False,
            entries_checked=index + 1,
            first_break_seq=entries[index].seq,
            reason=reason,
            head_hash=head_hash,
        )
    finally:
        session.close()
