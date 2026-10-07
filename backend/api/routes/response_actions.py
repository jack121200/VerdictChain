"""Global response-actions read (across all investigations) for the Containment page.

Every row has is_simulated = true (enforced by a CHECK constraint, SKILL-security.md Section 4).
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from backend.api.auth import get_current_user
from backend.api.schemas.read import ResponseActionOut
from backend.db.models import ResponseAction
from backend.db.session import SessionLocal

router = APIRouter(prefix="/response-actions", tags=["response-actions"])


@router.get("", response_model=list[ResponseActionOut])
def list_response_actions(
    limit: int = Query(100, ge=1, le=200), username: str = Depends(get_current_user)
) -> list[ResponseActionOut]:
    session = SessionLocal()
    try:
        rows = (
            session.execute(
                select(ResponseAction)
                .order_by(ResponseAction.created_at.desc(), ResponseAction.id)
                .limit(limit)
            )
            .scalars()
            .all()
        )
        return [
            ResponseActionOut(
                id=str(r.id),
                investigation_id=str(r.investigation_id) if r.investigation_id else None,
                action_type=r.action_type,
                target=r.target,
                reason=r.reason,
                is_simulated=r.is_simulated,
                created_at=r.created_at,
            )
            for r in rows
        ]
    finally:
        session.close()
