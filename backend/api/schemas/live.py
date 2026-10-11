"""Schemas of the live feed: GET /live/status, GET /live/arrivals, POST /live/start and /live/stop."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.api.metrics import Metric
from backend.api.schemas.allowance import AllowanceOut


class LiveStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events_per_second: float | None = Field(default=None, ge=0.5, le=50.0)
    auto_investigate: bool | None = None
    # Rows the feed must stream before the first OpenAI call (None: the LIVE_LLM_AFTER_ROWS setting).
    llm_after_rows: int | None = Field(default=None, ge=50, le=20000)


class LiveWindowOut(BaseModel):
    """The latest window of one source group and how the rule scored it."""

    group: Literal["network", "logon", "device", "file"]
    source: str
    feature: str
    size: int  # rows the window holds when full
    rows: int  # rows in it now
    scored_rows: int  # rows of the last scored window that had a usable value
    value: float | None  # network: spread of log10(1 + packets/s); others: window mean of the field
    threshold: float | None  # the value at which the window is flagged
    z: float | None  # standard errors above the dataset mean (not for network)
    suspicion: float  # 0..1, flagged at 0.5
    flagged: bool
    rule: str
    evaluated_at: datetime | None


class LiveTriggerOut(BaseModel):
    investigation_id: str
    group: str
    reason: str
    at: datetime


class LiveBlockedOut(BaseModel):
    reason: str
    at: datetime | None


class LiveLlmOut(BaseModel):
    """The language model behind the automatic investigations: OpenAI, used by the live feed only."""

    provider: Literal["openai"]
    configured: bool  # OPENAI_API_KEY is set (the key itself is never sent)
    model: str | None
    # off: the feed is not running; not_configured: no key; warming_up: fewer rows streamed than
    # activation_rows, so no call has been made; active: the next flagged window may start a debate;
    # budget_reached: the token budget of the last 24 hours is used up; allowance_reached: OpenAI itself
    # says this key has too few requests left (or asked for a wait) for the next debate.
    state: Literal["off", "not_configured", "warming_up", "active", "budget_reached", "allowance_reached"]
    activation_rows: Metric[int]
    rows_seen: Metric[int]
    tokens_24h: Metric[int]
    token_limit: Metric[int]
    calls_24h: Metric[int]
    allowance: AllowanceOut


class LiveStatusOut(BaseModel):
    state: Literal["running", "stopped"]
    simulated: bool  # always true: the feed replays dataset rows, no real network is monitored
    notice: str
    started_at: datetime | None
    started_by: str | None
    events_per_second: float | None
    auto_investigate: bool
    published: Metric[int]
    consumed: Metric[int]
    rate: Metric[float]
    backlog: Metric[int]
    flagged: Metric[int]
    triggered: Metric[int]
    triggers_today: Metric[int]
    daily_cap: Metric[int]
    llm: LiveLlmOut
    windows: list[LiveWindowOut]
    last_trigger: LiveTriggerOut | None
    blocked: LiveBlockedOut | None
    error: str | None
    generated_at: datetime


class LiveArrivalOut(BaseModel):
    """One row that arrived: the pointer plus the allow-listed fields. Never a label, never raw_fields."""

    row_id: str
    timestamp: datetime
    source: str
    event_type: str
    user_id: str | None
    host_id: str | None
    arrived_at: datetime
