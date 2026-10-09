"""Schemas of the live feed: GET /live/status, GET /live/arrivals, POST /live/start and /live/stop."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from backend.api.metrics import Metric


class LiveStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    events_per_second: float | None = Field(default=None, ge=0.5, le=50.0)
    auto_investigate: bool | None = None


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
