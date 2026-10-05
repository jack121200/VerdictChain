"""System status route (plan section 3.5): service health, providers, sandbox and debate slot."""

from fastapi import APIRouter

router = APIRouter(prefix="/system", tags=["system"])
