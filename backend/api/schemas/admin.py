"""Models for user administration, runtime settings, system status and the RBAC matrix."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool

from backend.api.metrics import Metric
from backend.api.schemas.allowance import AllowanceOut

RoleName = Literal["secops_lead", "forensic_analyst", "red_team_auditor", "watchdog_supervisor"]


class UserOut(BaseModel):
    analyst_id: str
    username: str
    role: str
    created_at: datetime


class RoleUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: RoleName


class SettingsOut(BaseModel):
    eta: float
    isolation_threshold: float
    verdict_confidence_threshold: float
    intake_paused: bool
    updated_at: datetime | None
    updated_by: str | None
    debate_rounds: int  # read-only constant (plan section 3.5)
    starting_crs: float  # read-only constant (plan section 3.5)


class AdaptiveRuleOut(BaseModel):
    """The constants of the adaptive rule (backend/evaluation/adaptive_threshold.py), shown on the screen."""

    window_size: int
    min_feedback: int
    adapt_every: int
    tighten_at: float
    relax_at: float
    step_up: float
    step_down: float
    floor: float
    ceiling: float


class AdaptiveChangeOut(BaseModel):
    at: datetime
    before: float
    after: float
    reason: str
    feedback_count: int


class AdaptiveThresholdOut(BaseModel):
    threshold: Metric[float]  # the verdict confidence threshold now
    window: Metric[int]  # feedback rows the rule looks at
    false_positive_share: Metric[float]  # null without feedback
    next_step: Literal["tighten", "relax", "hold", "wait"]
    reason: str
    new_threshold: float | None
    rule: AdaptiveRuleOut
    last_change: AdaptiveChangeOut | None


class SettingsUpdateRequest(BaseModel):
    # Full replace: all four fields are required. Ranges match the table CHECK constraints.
    model_config = ConfigDict(extra="forbid")

    eta: float = Field(ge=0.01, le=0.5, allow_inf_nan=False)
    isolation_threshold: float = Field(ge=0.05, le=0.45, allow_inf_nan=False)
    verdict_confidence_threshold: float = Field(ge=0.50, le=0.99, allow_inf_nan=False)
    intake_paused: StrictBool


class ServiceOut(BaseModel):
    ok: bool
    latency_ms: Metric[float]
    error_class: str | None  # the exception class name only, never its message (it may carry a URL)


class ProviderOut(BaseModel):
    configured: bool
    model: str
    temperature: Metric[float]
    calls_24h: Metric[int]
    latency_ms: Metric[float]
    quota_errors_24h: Metric[int]
    allowance: AllowanceOut  # what OpenAI itself allows this key


class ProvidersOut(BaseModel):
    openai: ProviderOut  # the only provider, for every debate and the reason written with an action


class SandboxOut(BaseModel):
    is_simulated_violations: Metric[int]
    actions_total: Metric[int]


class DebateSlotOut(BaseModel):
    """The debate slots: up to `capacity` debates run at once (setting DEBATE_MAX_CONCURRENT)."""

    status: Literal["idle", "running", "unavailable"]
    investigation_id: str | None  # the longest-running debate, null while idle
    running: Metric[int]  # debates holding a slot now (a debate that is starting counts)
    capacity: Metric[int]  # DEBATE_MAX_CONCURRENT
    investigation_ids: list[str]  # every running debate, longest-running first


class SystemStatusOut(BaseModel):
    postgres: ServiceOut
    redis: ServiceOut
    rabbitmq: ServiceOut
    providers: ProvidersOut
    sandbox: SandboxOut
    debate_slot: DebateSlotOut
    intake_paused: bool | None  # null when the database could not be read
    continuous_mode: bool
    api_version: str
    migration_head: str


class RbacMatrixOut(BaseModel):
    roles: list[str]
    capabilities: dict[str, list[str]]
