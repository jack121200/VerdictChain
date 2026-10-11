"""What OpenAI itself allows this key (GET /system/status and GET /live/status)."""

from datetime import datetime

from pydantic import BaseModel

from backend.api.metrics import Metric


class AllowanceOut(BaseModel):
    """The latest x-ratelimit-* reading OpenAI sent. The numbers are as of the answer they came from (each
    Metric's as_of), not of this request; a key that has not been used yet has no reading."""

    requests_left: Metric[int]
    requests_allowed: Metric[int]
    tokens_left: Metric[int]
    tokens_allowed: Metric[int]
    held_until: datetime | None  # OpenAI asked for a wait (a long retry-after) that has not passed yet
