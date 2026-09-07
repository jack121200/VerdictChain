"""Pydantic request/response models - SKILL-security.md Section 3: "Every
FastAPI endpoint has a Pydantic request model - no raw dict/unvalidated JSON."
"""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

# ---- auth ----


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


# ---- investigations ----

ScenarioLabel = Literal[
    "DDoS",
    "Portscan",
    "FTP-Patator",
    "SSH-Patator",
    "Botnet",
    "insider_scenario_1",
    "insider_scenario_2",
    "insider_scenario_3",
]


class SimulateScenarioRequest(BaseModel):
    scenario_label: ScenarioLabel
    max_rows_per_agent: int = Field(default=5, ge=1, le=15)


class CitedEvidenceOut(BaseModel):
    row_id: str
    field: str
    value: str


class DebateRoundOut(BaseModel):
    round: int
    agent_id: str
    theory: str
    confidence: float
    cited_evidence: list[CitedEvidenceOut]
    created_at: datetime


class CredibilityLogOut(BaseModel):
    round: int
    agent_id: str
    crs_before: float
    crs_after: float
    verification_match_rate: float
    isolated: bool
    created_at: datetime


class ResponseActionOut(BaseModel):
    action_type: str
    target: str
    reason: str | None
    is_simulated: bool
    created_at: datetime


class InvestigationSummaryOut(BaseModel):
    investigation_id: str
    trigger_type: str
    status: str
    verdict_class: str | None
    verdict_confidence: float | None
    created_at: datetime


class InvestigationDetailOut(InvestigationSummaryOut):
    debate: list[DebateRoundOut]
    credibility: list[CredibilityLogOut]
    actions: list[ResponseActionOut]


class FeedbackRequest(BaseModel):
    verdict_was_correct: bool


class AgentFleetEntryOut(BaseModel):
    agent_id: str
    credibility_score: float
    isolated: bool
