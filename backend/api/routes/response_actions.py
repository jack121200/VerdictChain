"""Global response-actions read (across all investigations) for the Response
Actions dashboard page.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select

from backend.api.auth import get_current_user
from backend.api.schemas import ResponseActionOut
from backend.db.models import ResponseAction
from backend.db.session import SessionLocal

router = APIRouter(prefix="/response-actions", tags=["response-actions"])


@router.get("", response_model=list[ResponseActionOut])
def list_response_actions(limit: int = 100, username: str = Depends(get_current_user)) -> list[ResponseActionOut]:
    session = SessionLocal()
    try:
        rows = session.execute(
            select(ResponseAction).order_by(ResponseAction.created_at.desc()).limit(limit)
        ).scalars().all()
        return [
            ResponseActionOut(
                action_type=r.action_type, target=r.target, reason=r.reason,
                is_simulated=r.is_simulated, created_at=r.created_at,
            )
            for r in rows
        ]
    finally:
        session.close()
