"""Containment routes (plan section 3.5): sandboxed emergency containment and its release."""

from fastapi import APIRouter

router = APIRouter(prefix="/investigations", tags=["containment"])
