"""Agent operations routes (plan section 3.5): fault injection, quarantine and restore."""

from fastapi import APIRouter

router = APIRouter(prefix="/agents", tags=["agent-ops"])
