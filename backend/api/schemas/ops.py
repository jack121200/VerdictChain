"""Request and response models for containment, fault injection and agent quarantine."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

FaultKind = Literal["ghost_row", "value_mismatch", "malformed_row_id"]


class EmergencyContainmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    confirm: Literal[True]


class ContainmentActionOut(BaseModel):
    action_type: str
    target: str
    reason: str
    is_simulated: bool


class ContainmentOut(BaseModel):
    investigation_id: str
    status: str
    verdict_class: str
    actions: list[ContainmentActionOut]


class ReleaseContainmentOut(BaseModel):
    investigation_id: str
    status: str
    released: list[ContainmentActionOut]


class FaultInjectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: FaultKind
    rounds: int = Field(default=1, ge=1, le=6)


class CitationCheckOut(BaseModel):
    row_id: str
    field: str
    value: str
    expected: str | None
    status: str
    reason: str


class ProjectedRoundOut(BaseModel):
    round: int
    projected_crs_before: float
    projected_crs_after: float
    projected_isolated: bool


class FaultInjectionOut(BaseModel):
    agent_id: str
    kind: FaultKind
    dry_run: Literal[True] = True
    citation: CitationCheckOut
    projected_match_rate: float
    eta: float
    isolation_threshold: float
    projected_trajectory: list[ProjectedRoundOut]
    would_isolate_at_round: int | None
    production_crs_before: float
    production_crs_after: float
    production_crs_unchanged: bool


class QuarantineRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


class RestoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str = Field(min_length=3, max_length=500)


class AgentOpOut(BaseModel):
    agent_id: str
    active: bool
    previous_crs: float
    crs_now: float
