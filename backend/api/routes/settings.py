"""Runtime settings routes (plan section 3.5): read and replace the thresholds."""

from fastapi import APIRouter

router = APIRouter(prefix="/settings", tags=["settings"])
