"""Evaluation route (plan section 3.4): accuracy and per-class metrics over labelled investigations."""

from fastapi import APIRouter

router = APIRouter(prefix="/evaluation", tags=["evaluation"])
