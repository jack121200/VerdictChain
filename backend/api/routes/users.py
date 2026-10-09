"""User administration (plan section 3.6): list analysts and change a role. Both need manage_users.

Concurrency rule: every role change locks all secops_lead rows first (FOR UPDATE, ordered by id), then
the target row. Two concurrent demotions therefore run one after the other, and the second one sees the
updated lead count, so the last secops_lead can never be removed.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select

from backend.api.auth import CurrentAnalyst, require_capability
from backend.api.schemas.admin import RoleUpdateRequest, UserOut
from backend.db.audit import append_entry
from backend.db.models import Analyst
from backend.db.session import SessionLocal

router = APIRouter(prefix="/users", tags=["users"])

LEAD = "secops_lead"


def _user_out(analyst: Analyst) -> UserOut:
    return UserOut(
        analyst_id=str(analyst.analyst_id),
        username=analyst.username,
        role=analyst.role,
        created_at=analyst.created_at,
    )


@router.get("", response_model=list[UserOut])
def list_users(
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    _: CurrentAnalyst = Depends(require_capability("manage_users")),
) -> list[UserOut]:
    session = SessionLocal()
    try:
        rows = (
            session.execute(
                select(Analyst).order_by(Analyst.created_at, Analyst.username).limit(limit).offset(offset)
            )
            .scalars()
            .all()
        )
        return [_user_out(row) for row in rows]
    finally:
        session.close()


@router.put("/{analyst_id}/role", response_model=UserOut)
def change_role(
    analyst_id: uuid.UUID,
    payload: RoleUpdateRequest,
    actor: CurrentAnalyst = Depends(require_capability("manage_users")),
) -> UserOut:
    session = SessionLocal()
    try:
        leads = (
            session.execute(
                select(Analyst.analyst_id)
                .where(Analyst.role == LEAD)
                .order_by(Analyst.analyst_id)
                .with_for_update()
            )
            .scalars()
            .all()
        )
        target = session.execute(
            select(Analyst).where(Analyst.analyst_id == analyst_id).with_for_update()
        ).scalar_one_or_none()
        if target is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Analyst not found")

        before, after = target.role, payload.role
        if before == after:
            return _user_out(target)
        if before == LEAD and len(leads) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Cannot demote the last secops_lead"
            )

        target.role = after
        session.flush()
        out = _user_out(target)
        # The audit entry is appended last, in the same transaction as the role change (plan section 3.2).
        append_entry(
            session,
            actor=actor.username,
            action="role_changed",
            detail={
                "analyst_id": str(analyst_id),
                "username": target.username,
                "before": before,
                "after": after,
            },
        )
        session.commit()
        return out
    finally:
        session.close()
