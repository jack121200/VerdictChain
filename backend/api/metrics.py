"""The Metric envelope (plan sections 1 R2 and 3.4). Every live number ships with its n, as_of,
source and definition, so the UI can show a Proof popover. A null value always carries a reason,
so an empty state is never shown as 0 or as a placeholder.
"""

import math
from datetime import datetime, timezone
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field, field_validator, model_validator

T = TypeVar("T")


class Metric(BaseModel, Generic[T]):
    value: T | None
    n: int = Field(ge=0)
    as_of: datetime
    source: str
    definition: str
    reason: str | None = None

    @field_validator("as_of")
    @classmethod
    def _as_of_is_utc(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("as_of must be timezone-aware")
        return value.astimezone(timezone.utc)

    @model_validator(mode="after")
    def _null_needs_reason(self) -> "Metric[T]":
        if self.value is None and not self.reason:
            raise ValueError("reason is required when value is None")
        if isinstance(self.value, float) and not math.isfinite(self.value):
            raise ValueError("value must be finite")
        return self


def make_metric(value: Any, n: int, source: str, definition: str, reason: str | None = None) -> Metric[Any]:
    return Metric(
        value=value,
        n=n,
        as_of=datetime.now(timezone.utc),
        source=source,
        definition=definition,
        reason=reason,
    )
