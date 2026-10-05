"""Headline metrics route (plan section 3.4): every KPI as a Metric envelope."""

from fastapi import APIRouter

router = APIRouter(prefix="/stats", tags=["stats"])
