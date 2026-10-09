"""The monitor of the live feed (checklist RT2).

Consumes the pointers the sensor publishes (live_feed.py), keeps a sliding window of the last rows per source
group, scores each window with the rule in live_detector.py and, when a window is flagged, hands it to
`on_flag`. Whoever supplies on_flag decides whether an investigation starts (backend/api/live_runner.py).

The monitor never reads a label. A message has none, and the row fields it fetches are chosen by name
(user, host, raw_fields), never the whole row. The dataset-wide baselines come from the same fields.
"""

import json
import logging
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import pika
from sqlalchemy import Integer, cast, func, select

from backend.config import settings
from backend.db.change_events import publish_change
from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.pipeline import live_state
from backend.pipeline.live_detector import (
    DEVICE,
    FEATURE_NAME,
    FILE,
    GROUP_OF_SOURCE,
    LOGON,
    WINDOW_SIZE,
    Baseline,
    WindowScore,
    row_feature,
    score_window,
)

logger = logging.getLogger(__name__)

BATCH_SIZE = 25  # messages handled together (one database read per batch)
STRIDE = 5  # a window is scored again after this many new rows
CONSUME_TIMEOUT_SECONDS = 0.5


@dataclass(frozen=True)
class Flag:
    """A window the rule flagged: its rows (oldest first) and the number each contributed."""

    group: str
    score: WindowScore
    row_ids: list[uuid.UUID]
    features: list[float | None]


@dataclass(frozen=True)
class _Item:
    row_id: uuid.UUID
    feature: float | None


def compute_baselines() -> dict[str, Baseline]:
    """Dataset-wide mean and standard deviation of each CERT field, over every row of its source. These are
    the same fields the rule reads, so the baseline is what 'ordinary' means in this dataset, label-free."""
    fields = {
        LOGON: ("cert_r4.2_logon", cast(RawLog.raw_fields["off_hours"].as_boolean(), Integer)),
        DEVICE: ("cert_r4.2_device", RawLog.raw_fields["connect_count"].as_float()),
        FILE: ("cert_r4.2_file", RawLog.raw_fields["file_access_count"].as_float()),
    }
    baselines: dict[str, Baseline] = {}
    with SessionLocal() as session:
        for group, (source, expression) in fields.items():
            mean, std, count = session.execute(
                select(func.avg(expression), func.stddev_pop(expression), func.count(expression)).where(
                    RawLog.source == source
                )
            ).one()
            if count:
                baselines[group] = Baseline(mean=float(mean), std=float(std or 0.0), n=int(count))
    return baselines


def _fetch(ids: list[uuid.UUID]) -> dict[uuid.UUID, tuple[str | None, str | None, dict[str, Any]]]:
    with SessionLocal() as session:
        rows = session.execute(
            select(RawLog.row_id, RawLog.user_id, RawLog.host_id, RawLog.raw_fields).where(
                RawLog.row_id.in_(ids)
            )
        ).all()
    return {row_id: (user_id, host_id, raw_fields) for row_id, user_id, host_id, raw_fields in rows}


def window_state(group: str, size: int, rows: int, score: WindowScore | None) -> dict[str, Any]:
    """What the Live page shows for one window (JSON-safe)."""
    return {
        "group": group,
        "feature": FEATURE_NAME[group],
        "size": size,
        "rows": rows,
        "value": None if score is None else score.value,
        "threshold": None if score is None else score.threshold,
        "z": None if score is None else score.z,
        "suspicion": 0.0 if score is None else score.suspicion,
        "flagged": False if score is None else score.flagged,
        "rule": "waiting for the window to fill" if score is None else score.rule,
        "scored_rows": 0 if score is None else score.rows,
        "evaluated_at": None if score is None else datetime.now(timezone.utc).isoformat(),
    }


class LiveMonitor:
    def __init__(
        self,
        *,
        queue_name: str,
        baselines: dict[str, Baseline],
        on_flag: Callable[[Flag], bool],
        stride: int = STRIDE,
    ) -> None:
        self.queue_name = queue_name
        self.baselines = baselines
        self.on_flag = on_flag
        self.stride = stride
        self._windows: dict[str, deque[_Item]] = {
            group: deque(maxlen=size) for group, size in WINDOW_SIZE.items()
        }
        self._since: dict[str, int] = {group: 0 for group in WINDOW_SIZE}
        self._last: dict[str, WindowScore | None] = {group: None for group in WINDOW_SIZE}
        self._consumed = 0
        self._next_tick = 0.0
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.error: str | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="live-monitor", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 5.0) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout)

    @property
    def alive(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def _run(self) -> None:
        try:
            connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
            try:
                channel = connection.channel()
                channel.queue_declare(queue=self.queue_name, durable=False)
                self._consume(channel)
            finally:
                connection.close()
        except Exception as exc:  # noqa: BLE001 - a thread must report its failure, not die silently
            self.error = f"{type(exc).__name__}: {exc}"
            logger.exception("live monitor stopped by an error")

    def _consume(self, channel) -> None:
        batch: list[dict[str, Any]] = []
        last_tag = None
        for method, _properties, body in channel.consume(
            self.queue_name, inactivity_timeout=CONSUME_TIMEOUT_SECONDS
        ):
            if self._stop.is_set():
                break
            if method is not None:
                batch.append(json.loads(body))
                last_tag = method.delivery_tag
            if batch and (method is None or len(batch) >= BATCH_SIZE):
                try:
                    self.handle_batch(batch)
                except Exception:  # noqa: BLE001 - one bad batch must not stop the monitor
                    logger.exception("live monitor could not handle a batch of %d messages", len(batch))
                channel.basic_ack(delivery_tag=last_tag, multiple=True)
                batch = []
            self._tick()
        channel.cancel()

    def _tick(self) -> None:
        """About once a second: a sample for the measured rate, and a nudge to the open screens."""
        now = time.monotonic()
        if now < self._next_tick:
            return
        self._next_tick = now + 1.0
        live_state.push_sample(self._consumed)
        publish_change(["live_tick"])

    def handle_batch(self, messages: list[dict[str, Any]]) -> None:
        """Adds the rows of one batch to their windows and scores the windows that moved far enough."""
        known = [message for message in messages if message.get("source") in GROUP_OF_SOURCE]
        details = _fetch([uuid.UUID(message["row_id"]) for message in known])
        arrived_at = datetime.now(timezone.utc).isoformat()
        arrivals: list[dict[str, Any]] = []
        touched: set[str] = set()
        for message in known:
            row_id = uuid.UUID(message["row_id"])
            user_id, host_id, raw_fields = details.get(row_id, (None, None, {}))
            group = GROUP_OF_SOURCE[message["source"]]
            self._windows[group].append(_Item(row_id, row_feature(group, raw_fields)))
            self._since[group] += 1
            touched.add(group)
            self._score(group)  # row by row, so the result does not depend on how messages were batched
            arrivals.append(
                {
                    "row_id": str(row_id),
                    "timestamp": message["timestamp"],
                    "source": message["source"],
                    "event_type": message["event_type"],
                    "user_id": user_id,
                    "host_id": host_id,
                    "arrived_at": arrived_at,
                }
            )
        live_state.push_arrivals(arrivals)  # oldest first: LPUSH leaves the newest at the head of the list
        self._consumed += len(messages)
        live_state.incr("consumed", len(messages))
        for group in sorted(touched):
            live_state.set_window(
                group, window_state(group, WINDOW_SIZE[group], len(self._windows[group]), self._last[group])
            )

    def _score(self, group: str) -> None:
        """Scores the group's window if it is full and has taken in `stride` new rows since the last time."""
        window = self._windows[group]
        if len(window) == WINDOW_SIZE[group] and self._since[group] >= self.stride:
            self._since[group] = 0
            score = score_window(group, [item.feature for item in window], self.baselines.get(group))
            self._last[group] = score
            if score.flagged:
                live_state.incr("flagged")
                flag = Flag(group, score, [item.row_id for item in window], [item.feature for item in window])
                try:
                    if self.on_flag(flag):
                        window.clear()  # the next window starts with rows that arrive after the trigger
                        self._since[group] = 0
                        self._last[group] = None
                except Exception:  # noqa: BLE001 - a failed trigger must not stop the monitor
                    logger.exception("live monitor: on_flag failed for %s", group)
