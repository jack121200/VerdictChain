"""Builds the allowance block of the status endpoints from OpenAI's own latest answer (openai_usage.py)."""

from datetime import datetime, timezone

from backend.agents import openai_usage
from backend.api.metrics import Metric
from backend.api.schemas.allowance import AllowanceOut

SOURCE = "x-ratelimit-* headers of the latest OpenAI answer (redis, verdictchain:openai:limits)"


def build_allowance(now: float | None = None) -> AllowanceOut:
    moment = now if now is not None else datetime.now(timezone.utc).timestamp()
    reading = openai_usage.read_limits()

    def metric(value: int | None, definition: str) -> Metric[int]:
        if reading is None:
            return Metric(
                value=None,
                n=0,
                as_of=datetime.fromtimestamp(moment, tz=timezone.utc),
                source=SOURCE,
                definition=definition,
                reason="OpenAI has not answered yet, so there is no reading",
            )
        return Metric(
            value=value,
            n=0 if value is None else 1,
            as_of=datetime.fromtimestamp(reading.at, tz=timezone.utc),
            source=SOURCE,
            definition=definition,
            reason=None if value is not None else "OpenAI did not send this header",
        )

    held = openai_usage.hold_in_force(reading, moment) if reading is not None else None
    return AllowanceOut(
        requests_left=metric(
            reading.remaining_requests if reading else None,
            "requests this key may still send before OpenAI refuses (x-ratelimit-remaining-requests)",
        ),
        requests_allowed=metric(
            reading.limit_requests if reading else None,
            "requests this key may send in OpenAI's window, e.g. a day (x-ratelimit-limit-requests)",
        ),
        tokens_left=metric(
            reading.remaining_tokens if reading else None,
            "tokens this key may still use in OpenAI's window (x-ratelimit-remaining-tokens)",
        ),
        tokens_allowed=metric(
            reading.limit_tokens if reading else None,
            "tokens this key may use in OpenAI's window (x-ratelimit-limit-tokens)",
        ),
        held_until=(
            datetime.fromtimestamp(held, tz=timezone.utc) if held is not None and held > moment else None
        ),
    )
