"""Evidence routes (plan section 3.4): citations, evidence bundle and sign-off.

These paths sit under /investigations/{id} and at /citations, so this router has no prefix.
"""

from fastapi import APIRouter

router = APIRouter(tags=["evidence"])
