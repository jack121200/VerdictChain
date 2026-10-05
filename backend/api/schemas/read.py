"""Response models for the investigation and agent read endpoints."""

from datetime import datetime

from pydantic import BaseModel


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


class AgentFleetEntryOut(BaseModel):
    agent_id: str
    credibility_score: float
    isolated: bool
