"""User administration routes (plan section 3.6): list analysts and change roles."""

from fastapi import APIRouter

router = APIRouter(prefix="/users", tags=["users"])
