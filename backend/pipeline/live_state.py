"""What the live feed shows the rest of the system, kept in Redis (checklist RT1, RT5).

The feed thread, the monitor thread and the API all read and write the same keys, so the numbers on the Live
page come from one place. Everything here is a counter, a window score or a row pointer, never a label.
The state is reset every time the feed is started and is not needed to restart it.
"""

import json
import time
from typing import Any

import redis

from backend.config import settings

PREFIX = "verdictchain:live:"
COUNTERS = PREFIX + "counters"  # hash: published, consumed, flagged, triggered
WINDOWS = PREFIX + "windows"  # hash: group -> json score of its latest window
ARRIVALS = PREFIX + "arrivals"  # list, newest first
SAMPLES = PREFIX + "samples"  # list of "epoch_seconds:consumed", newest first (the measured rate)
TRIGGER = PREFIX + "last_trigger"
GROUP_TRIGGERS = (
    PREFIX + "group_triggers"
)  # hash: group -> epoch seconds of its latest automatic investigation
BLOCKED = PREFIX + "blocked"
CONFIG = PREFIX + "config"
BACKLOG = PREFIX + "backlog"  # messages waiting in the queue, measured by the feed

KEPT_ARRIVALS = 100
KEPT_SAMPLES = 60

_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def reset() -> None:
    _redis().delete(COUNTERS, WINDOWS, ARRIVALS, SAMPLES, TRIGGER, GROUP_TRIGGERS, BLOCKED, CONFIG, BACKLOG)


def incr(field: str, amount: int = 1) -> None:
    _redis().hincrby(COUNTERS, field, amount)


def counters() -> dict[str, int]:
    raw = _redis().hgetall(COUNTERS)
    return {name: int(raw.get(name, 0)) for name in ("published", "consumed", "flagged", "triggered")}


def set_window(group: str, data: dict[str, Any]) -> None:
    _redis().hset(WINDOWS, group, json.dumps(data))


def windows() -> dict[str, dict[str, Any]]:
    return {group: json.loads(value) for group, value in _redis().hgetall(WINDOWS).items()}


def push_arrivals(items: list[dict[str, Any]]) -> None:
    if not items:
        return
    pipe = _redis().pipeline()
    pipe.lpush(ARRIVALS, *[json.dumps(item) for item in items])
    pipe.ltrim(ARRIVALS, 0, KEPT_ARRIVALS - 1)
    pipe.execute()


def arrivals(limit: int) -> list[dict[str, Any]]:
    return [json.loads(item) for item in _redis().lrange(ARRIVALS, 0, max(limit, 1) - 1)]


def push_sample(consumed: int, now: float | None = None) -> None:
    pipe = _redis().pipeline()
    pipe.lpush(SAMPLES, f"{now if now is not None else time.time():.3f}:{consumed}")
    pipe.ltrim(SAMPLES, 0, KEPT_SAMPLES - 1)
    pipe.execute()


def measured_rate(window_seconds: float = 10.0, now: float | None = None) -> tuple[float | None, int]:
    """Rows consumed per second over the last window_seconds, and the number of samples it rests on.
    None until the samples span at least a second."""
    current = now if now is not None else time.time()
    samples: list[tuple[float, int]] = []
    for raw in _redis().lrange(SAMPLES, 0, -1):
        stamp, _, consumed = raw.partition(":")
        samples.append((float(stamp), int(consumed)))
    recent = [sample for sample in samples if current - sample[0] <= window_seconds]
    if len(recent) < 2:
        return None, len(recent)
    newest, oldest = recent[0], recent[-1]
    span = newest[0] - oldest[0]
    if span < 1.0:
        return None, len(recent)
    return (newest[1] - oldest[1]) / span, len(recent)


def set_trigger(data: dict[str, Any]) -> None:
    _redis().set(TRIGGER, json.dumps(data))


def last_trigger() -> dict[str, Any] | None:
    raw = _redis().get(TRIGGER)
    return json.loads(raw) if raw else None


def set_group_trigger(group: str, epoch_seconds: float) -> None:
    _redis().hset(GROUP_TRIGGERS, group, f"{epoch_seconds:.3f}")


def group_trigger_at(group: str) -> float | None:
    """When this source group last started an automatic investigation (epoch seconds), None if never."""
    raw = _redis().hget(GROUP_TRIGGERS, group)
    return float(raw) if raw is not None else None


def set_blocked(reason: str | None, at: str | None = None) -> None:
    if reason is None:
        _redis().delete(BLOCKED)
    else:
        _redis().set(BLOCKED, json.dumps({"reason": reason, "at": at}))


def blocked() -> dict[str, Any] | None:
    raw = _redis().get(BLOCKED)
    return json.loads(raw) if raw else None


def set_config(data: dict[str, Any]) -> None:
    _redis().set(CONFIG, json.dumps(data))


def config() -> dict[str, Any] | None:
    raw = _redis().get(CONFIG)
    return json.loads(raw) if raw else None


def set_backlog(messages: int) -> None:
    _redis().set(BACKLOG, messages)


def backlog() -> int | None:
    raw = _redis().get(BACKLOG)
    return int(raw) if raw is not None else None
