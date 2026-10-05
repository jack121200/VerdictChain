"""Pydantic models for the API. Every name is re-exported here, so `from backend.api.schemas import X`
works whichever module defines X.
"""

from backend.api.schemas.auth import LoginRequest, RegisterRequest, TokenResponse
from backend.api.schemas.evidence import FeedbackRequest
from backend.api.schemas.read import (
    AgentFleetEntryOut,
    CitedEvidenceOut,
    CredibilityLogOut,
    DebateRoundOut,
    InvestigationDetailOut,
    InvestigationSummaryOut,
    ResponseActionOut,
)
from backend.api.schemas.realtime import ScenarioLabel, SimulateScenarioRequest

__all__ = [
    "AgentFleetEntryOut",
    "CitedEvidenceOut",
    "CredibilityLogOut",
    "DebateRoundOut",
    "FeedbackRequest",
    "InvestigationDetailOut",
    "InvestigationSummaryOut",
    "LoginRequest",
    "RegisterRequest",
    "ResponseActionOut",
    "ScenarioLabel",
    "SimulateScenarioRequest",
    "TokenResponse",
]
