"""RBAC matrix (plan section 3.5): the roles and the capability map, read only."""

from fastapi import APIRouter, Depends

from backend.api.auth import CurrentAnalyst, get_current_analyst
from backend.api.rbac import CAPABILITIES, ROLES
from backend.api.schemas.admin import RbacMatrixOut

router = APIRouter(prefix="/rbac", tags=["rbac"])


@router.get("/matrix", response_model=RbacMatrixOut)
def rbac_matrix(_: CurrentAnalyst = Depends(get_current_analyst)) -> RbacMatrixOut:
    return RbacMatrixOut(
        roles=list(ROLES),
        capabilities={name: sorted(CAPABILITIES[name]) for name in sorted(CAPABILITIES)},
    )
