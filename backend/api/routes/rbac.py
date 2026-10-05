"""RBAC matrix route (plan section 3.5): the roles and capability map, read-only."""

from fastapi import APIRouter

router = APIRouter(prefix="/rbac", tags=["rbac"])
