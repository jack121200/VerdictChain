"""Raw-log read routes (plan section 3.4): allow-listed rows, recent rows and per-source counts."""

from fastapi import APIRouter

router = APIRouter(prefix="/raw-logs", tags=["raw-logs"])
