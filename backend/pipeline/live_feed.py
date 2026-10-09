"""The simulated sensor of the live feed (checklist RT1).

There is no real network here, so something has to play the part of one. This module replays rows of the
ingested datasets into RabbitMQ on its own, in short segments: mostly ordinary traffic and now and then a
segment taken from one of the labelled scenarios, the way an attack shows up in the middle of normal traffic.
It is the one place on the live path that knows which rows belong to an attack, because it decides what the
"world" does. Nothing it publishes says so: a message is a pointer (row id, time, source, event type) exactly
as in backend/pipeline/log_streamer.py. The monitor (live_monitor.py) never reads a label.

Pacing is a constant number of rows per second. The rows keep their own dataset timestamps, but the two
datasets have no shared timeline (CICIDS2017 is one week in 2017, CERT r4.2 spans 2010 to 2011), so replaying
them at their original spacing is not possible. Publishing pauses while the queue holds more than MAX_BACKLOG
messages, so a slow or stopped monitor cannot grow it without bound.
"""

import json
import logging
import random
import threading
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import datetime

import pika
from sqlalchemy import func, select

from backend.config import settings
from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.pipeline import live_state
from backend.pipeline.live_detector import GROUP_OF_SOURCE, GROUPS

logger = logging.getLogger(__name__)

TICK_SECONDS = 0.2
BENIGN_POOL_PER_GROUP = 5000
BENIGN_SEGMENT = (24, 48)  # rows of ordinary traffic per segment
ATTACK_SEGMENT = (40, 70)  # rows of a scenario per segment (a window of 20 or 30 fills with them)
MAX_BACKLOG = 500
BACKLOG_CHECK_SECONDS = 2.0


@dataclass(frozen=True)
class RowRef:
    row_id: uuid.UUID
    timestamp: datetime
    source: str
    event_type: str

    def message(self) -> bytes:
        """The pointer that goes on the queue. No fields, no label."""
        return json.dumps(
            {
                "row_id": str(self.row_id),
                "timestamp": self.timestamp.isoformat(),
                "source": self.source,
                "event_type": self.event_type,
            }
        ).encode("utf-8")


@dataclass
class Pools:
    benign: dict[str, list[RowRef]] = field(default_factory=dict)  # per group
    attack: dict[str, list[RowRef]] = field(default_factory=dict)  # per scenario, oldest first


def load_pools(per_group: int = BENIGN_POOL_PER_GROUP) -> Pools:
    """Reads the pointers of the rows the sensor may replay. This is the one place the labels are read."""
    pools = Pools()
    with SessionLocal() as session:
        for group in GROUPS:
            sources = [source for source, name in GROUP_OF_SOURCE.items() if name == group]
            rows = session.execute(
                select(RawLog.row_id, RawLog.timestamp, RawLog.source, RawLog.event_type)
                .where(
                    RawLog.source.in_(sources),
                    (RawLog.ground_truth_label.is_(None))
                    | (func.lower(RawLog.ground_truth_label) == "benign"),
                )
                .order_by(func.random())
                .limit(per_group)
            ).all()
            pools.benign[group] = [RowRef(*row) for row in rows]
        attacks = session.execute(
            select(
                RawLog.row_id, RawLog.timestamp, RawLog.source, RawLog.event_type, RawLog.ground_truth_label
            )
            .where(RawLog.ground_truth_label.is_not(None), func.lower(RawLog.ground_truth_label) != "benign")
            .order_by(RawLog.timestamp, RawLog.row_id)
        ).all()
    for row_id, timestamp, source, event_type, label in attacks:
        if source in GROUP_OF_SOURCE:
            pools.attack.setdefault(label, []).append(RowRef(row_id, timestamp, source, event_type))
    return pools


def next_segment(pools: Pools, rng: random.Random, attack_share: float) -> list[RowRef]:
    """The next stretch of traffic: a slice of one scenario with probability attack_share, else ordinary rows
    of one source group."""
    scenarios = sorted(label for label, refs in pools.attack.items() if refs)
    if scenarios and rng.random() < attack_share:
        refs = pools.attack[rng.choice(scenarios)]
        length = min(len(refs), rng.randint(*ATTACK_SEGMENT))
        start = rng.randrange(0, len(refs) - length + 1)
        return refs[start : start + length]
    groups = [group for group in GROUPS if pools.benign.get(group)]
    if not groups:
        return []
    refs = pools.benign[rng.choice(groups)]
    return rng.sample(refs, min(len(refs), rng.randint(*BENIGN_SEGMENT)))


def segments(pools: Pools, rng: random.Random, attack_share: float) -> Iterator[RowRef]:
    """An endless stream of rows. Ends only when there is nothing to replay."""
    while True:
        segment = next_segment(pools, rng, attack_share)
        if not segment:
            return
        yield from segment


class LiveFeed:
    """Publishes rows to the queue at events_per_second until stopped."""

    def __init__(
        self,
        *,
        queue_name: str,
        events_per_second: float,
        attack_share: float,
        pools: Pools | None = None,
        seed: int | None = None,
    ) -> None:
        self.queue_name = queue_name
        self.events_per_second = events_per_second
        self.attack_share = attack_share
        self._pools = pools
        self._rng = random.Random(seed)
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.error: str | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="live-feed", daemon=True)
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
            pools = self._pools or load_pools()
            stream = segments(pools, self._rng, self.attack_share)
            connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
            try:
                channel = connection.channel()
                channel.queue_declare(queue=self.queue_name, durable=False)
                self._publish_loop(channel, stream)
            finally:
                connection.close()
        except Exception as exc:  # noqa: BLE001 - a thread must report its failure, not die silently
            self.error = f"{type(exc).__name__}: {exc}"
            logger.exception("live feed stopped by an error")

    def _publish_loop(self, channel, stream: Iterator[RowRef]) -> None:
        budget = 0.0
        next_backlog_check = 0.0
        backlog = 0
        while not self._stop.wait(TICK_SECONDS):
            now = time.monotonic()
            if now >= next_backlog_check:
                backlog = channel.queue_declare(queue=self.queue_name, passive=True).method.message_count
                live_state.set_backlog(backlog)
                next_backlog_check = now + BACKLOG_CHECK_SECONDS
            if backlog > MAX_BACKLOG:
                continue  # the monitor is behind: the sensor waits
            budget += self.events_per_second * TICK_SECONDS
            count = int(budget)
            budget -= count
            sent = 0
            for _ in range(count):
                ref = next(stream, None)
                if ref is None:
                    self.error = "no rows to replay: ingest a dataset first"
                    return
                channel.basic_publish(exchange="", routing_key=self.queue_name, body=ref.message())
                sent += 1
            if sent:
                live_state.incr("published", sent)
