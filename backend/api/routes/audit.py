"""Global audit trail read, with live hash-chain verification (SKILL-security.md
Section 5) - so the dashboard can show whether the log is genuinely tamper-free,
not just display it.
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select

from backend.api.auth import get_current_user
from backend.db.audit import verify_chain
from backend.db.models import AuditTrail
from backend.db.session import SessionLocal

router = APIRouter(prefix="/audit-trail", tags=["audit"])


class AuditEntryOut(BaseModel):
    id: str
    investigation_id: str | None
    actor: str
    action: str
    detail: dict | None
    entry_hash: str
    created_at: str


class AuditTrailOut(BaseModel):
    entries: list[AuditEntryOut]
    chain_valid: bool


@router.get("", response_model=AuditTrailOut)
def list_audit_trail(limit: int = 100, username: str = Depends(get_current_user)) -> AuditTrailOut:
    session = SessionLocal()
    try:
        all_entries = session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all()
        chain_valid = verify_chain(all_entries)

        recent = list(reversed(all_entries))[:limit]
        return AuditTrailOut(
            entries=[
                AuditEntryOut(
                    id=str(e.id),
                    investigation_id=str(e.investigation_id) if e.investigation_id else None,
                    actor=e.actor,
                    action=e.action,
                    detail=e.detail,
                    entry_hash=e.entry_hash,
                    created_at=e.created_at.isoformat(),
                )
                for e in recent
            ],
            chain_valid=chain_valid,
        )
    finally:
        session.close()
