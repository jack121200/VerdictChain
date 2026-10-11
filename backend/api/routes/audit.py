"""Audit trail read and on-demand chain verification (SKILL-security.md Section 5, plan section 3.4).

GET /audit-trail verifies the chain over every entry on each call, so `chain.valid` covers the whole log, not
just the returned page. POST /audit-trail/verify is incremental by default (see backend/api/audit_chain.py)
and says which mode ran. It is rate limited per analyst and is not itself audited.
"""

import hashlib
import uuid
from collections.abc import Sequence
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.api.audit_chain import verify_audit_chain
from backend.api.auth import get_current_user
from backend.api.metrics import make_metric
from backend.api.rate_limit import enforce_rate_limit, read_limit
from backend.api.schemas.read import (
    AuditChainOut,
    AuditEntryOut,
    AuditTrailOut,
    AuditVerifyOut,
    CaseAuditChainOut,
    CaseAuditEntryOut,
)
from backend.db.audit import find_first_break, hash_input, is_known_action
from backend.db.models import AuditTrail, Investigation
from backend.db.session import SessionLocal

router = APIRouter(prefix="/audit-trail", tags=["audit"])
# The same audit data, read per case (its path starts with /investigations, so it is a router of its own).
case_router = APIRouter(tags=["audit"])

VERIFY_LIMIT_PER_MINUTE = 10
CASE_DIGEST_RULE = (
    "SHA-256 of the entry_hash values of this case's entries, oldest first, joined by a newline "
    "(no trailing newline). It is derived on every read; nothing about it is stored."
)


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


@router.get("", response_model=AuditTrailOut, dependencies=[read_limit("audit", 120)])
def list_audit_trail(
    limit: int = Query(100, ge=1, le=500),
    before_seq: int | None = Query(None, ge=1),
    action: str | None = Query(None, max_length=64),
    actor: str | None = Query(None, max_length=128),
    investigation_id: uuid.UUID | None = None,
    username: str = Depends(get_current_user),
) -> AuditTrailOut:
    if action is not None and not is_known_action(action):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Unknown audit action {action!r}")

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


def case_digest(entries: Sequence[AuditTrail]) -> str | None:
    """The digest of a case's entries (CASE_DIGEST_RULE), or None when the case has none."""
    if not entries:
        return None
    return hashlib.sha256("\n".join(entry.entry_hash for entry in entries).encode("utf-8")).hexdigest()


@case_router.get(
    "/investigations/{investigation_id}/audit-chain",
    response_model=CaseAuditChainOut,
    dependencies=[read_limit("case_audit_chain", 120)],
)
def case_audit_chain(
    investigation_id: uuid.UUID, username: str = Depends(get_current_user)
) -> CaseAuditChainOut:
    """The entries of one case in chain order, each with the hash input the browser can recompute and how it
    links into the global chain, plus a digest over the case's entry hashes. Nothing new is stored: this is a
    view of audit_trail, and it says so (links_to, digest_rule)."""
    session = SessionLocal()
    try:
        if session.get(Investigation, investigation_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")
        everything = _all_entries(session)
        broken = find_first_break(everything)
        chain = AuditChainOut(
            valid=broken is None,
            head_seq=everything[-1].seq if everything else None,
            total=len(everything),
        )

        mine = [entry for entry in everything if entry.investigation_id == investigation_id]
        entries: list[CaseAuditEntryOut] = []
        previous_in_case: str | None = None
        for entry in mine:
            if entry.prev_hash is None:
                links_to = "genesis"
            elif entry.prev_hash == previous_in_case:
                links_to = "case"
            else:
                links_to = "other"
            entries.append(CaseAuditEntryOut(**_entry_out(entry).model_dump(), links_to=links_to))
            previous_in_case = entry.entry_hash

        return CaseAuditChainOut(
            investigation_id=str(investigation_id),
            entries=entries,
            count=make_metric(
                len(entries),
                len(entries),
                "GET /investigations/{id}/audit-chain",
                "entries of the global audit chain that belong to this investigation",
            ),
            case_digest=case_digest(mine),
            digest_rule=CASE_DIGEST_RULE,
            chain=chain,
        )
    finally:
        session.close()


@router.post("/verify", response_model=AuditVerifyOut)
def verify_audit_trail(
    full: bool = Query(
        False,
        description="true re-walks every entry. The default re-checks the last verified checkpoint and walks "
        "only the entries after it, so a change to an older row is found only with full=true.",
    ),
    username: str = Depends(get_current_user),
) -> AuditVerifyOut:
    enforce_rate_limit("audit_verify", username, limit=VERIFY_LIMIT_PER_MINUTE, window_seconds=60)

    with SessionLocal() as session:
        check = verify_audit_chain(session, full=full)
    return AuditVerifyOut(
        chain_valid=check.valid,
        entries_checked=check.entries_checked,
        first_break_seq=check.first_break_seq,
        reason=check.reason,
        head_hash=check.head_hash,
        mode=check.mode,
        verified_from_seq=check.verified_from_seq,
    )
