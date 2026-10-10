"""Response models for the investigation, agent, audit, response-action and raw-log read endpoints."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from backend.api.metrics import Metric
from backend.api.schemas.evidence import CitationSummaryOut


class CitedEvidenceOut(BaseModel):
    row_id: str
    field: str
    value: str


class DebateRoundOut(BaseModel):
    round: int
    agent_id: str
    theory: str
    confidence: float
    stance: str | None
    provider: str | None
    cited_evidence: list[CitedEvidenceOut]
    created_at: datetime


class AgentVoteOut(BaseModel):
    agent_id: str
    round: int
    vote_class: str
    matched_keywords: list[str]
    # False when the Watchdog isolated this agent during the investigation: the engine leaves it out of the
    # verdict, so its last transcript is shown but not counted.
    counted: bool = True


class InputBasisOut(BaseModel):
    """How one agent's data slice was chosen (backend/debate/state.py): scenario_rows, same_user_window,
    time_window or recent_sample, and how many rows it got."""

    basis: str
    row_count: int


class CredibilityLogOut(BaseModel):
    round: int
    agent_id: str
    crs_before: float
    crs_after: float
    verification_match_rate: float
    isolated: bool
    created_at: datetime


class CredibilityPointOut(CredibilityLogOut):
    investigation_id: str | None


class ResponseActionOut(BaseModel):
    id: str
    investigation_id: str | None
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
    primary_agent: str | None
    dataset: str | None
    noise_pct: int
    rounds_complete: int
    containment_count: int
    data_source: Literal["model", "stub", "mixed"]  # stub: every answer came from the offline stub
    created_at: datetime


class InvestigationDetailOut(InvestigationSummaryOut):
    effective_noise_pct: float | None
    input_basis: dict[str, InputBasisOut] = Field(default_factory=dict)
    debate: list[DebateRoundOut]
    votes: list[AgentVoteOut]
    citations: CitationSummaryOut
    credibility: list[CredibilityLogOut]
    actions: list[ResponseActionOut]


class AgentFleetEntryOut(BaseModel):
    agent_id: str
    display_name: str
    domain: str
    signals: list[str]
    provider_chain: list[str]
    model: str
    temperature: Metric[float]
    crs: Metric[float]
    isolated: bool
    rounds_scored: Metric[int]
    citations_verified: Metric[int]
    citations_total: Metric[int]
    invalid_rate: Metric[float]
    last_vote: str | None


class AuditEntryOut(BaseModel):
    id: str
    seq: int
    prev_hash: str | None
    entry_hash: str
    hash_input: str
    actor: str
    action: str
    detail: dict[str, Any] | None
    investigation_id: str | None
    created_at: datetime


class AuditChainOut(BaseModel):
    valid: bool
    head_seq: int | None
    total: int


class AuditTrailOut(BaseModel):
    entries: list[AuditEntryOut]
    chain: AuditChainOut
    chain_valid: bool


class AuditVerifyOut(BaseModel):
    chain_valid: bool
    entries_checked: int  # entries whose hash was recomputed in this pass, not the size of the chain
    first_break_seq: int | None
    reason: str | None
    head_hash: str | None
    # Which part of the chain this pass covered: "full" walked every entry, "incremental" started at the
    # last verified checkpoint (verified_from_seq) and does not re-walk older entries.
    mode: Literal["incremental", "full"]
    verified_from_seq: int | None


class RawLogOut(BaseModel):
    row_id: str
    timestamp: datetime
    source: str
    source_file: str | None
    event_type: str
    user_id: str | None
    host_id: str | None
    severity: str | None
    raw_fields: dict[str, Any]


class RawLogCountOut(BaseModel):
    source: str
    count: Metric[int]


class RawLogCountsOut(BaseModel):
    total: Metric[int]
    sources: list[RawLogCountOut]
