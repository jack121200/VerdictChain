"""Hybrid trigger model (SKILL-architecture.md Section 4): replays raw_logs into
RabbitMQ, either continuously (respecting original relative timestamps, sped up)
or immediately for a manually-selected scenario.

Published messages are pointers only — {row_id, timestamp, source, event_type} —
never raw_fields and never ground_truth_label/scenario_label. Whatever consumes
this queue next fetches the full row from Postgres by row_id; that keeps the
blind-test boundary (SKILL-security.md Section 5) true by construction rather
than by a downstream filter someone could forget to write.
"""

import json
import time
from datetime import datetime

import pika
from sqlalchemy import select

from backend.config import settings
from backend.db.models import RawLog
from backend.db.session import SessionLocal

QUEUE_NAME = "raw_log_events"
DEFAULT_SPEED_FACTOR = 60.0  # 1 simulated hour per 1 real minute


def _connection() -> pika.BlockingConnection:
    return pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))


def _declare_queue(channel) -> None:
    channel.queue_declare(queue=QUEUE_NAME, durable=True)


def _to_message(log: RawLog) -> bytes:
    return json.dumps(
        {
            "row_id": str(log.row_id),
            "timestamp": log.timestamp.isoformat(),
            "source": log.source,
            "event_type": log.event_type,
        }
    ).encode("utf-8")


def publish_continuous(speed_factor: float = DEFAULT_SPEED_FACTOR, limit: int | None = None) -> int:
    """Replays raw_logs in timestamp order, sleeping between publishes to respect
    original relative spacing compressed by speed_factor. Returns count published.
    """
    session = SessionLocal()
    try:
        query = select(RawLog).order_by(RawLog.timestamp)
        if limit is not None:
            query = query.limit(limit)
        logs = session.execute(query).scalars().all()
    finally:
        session.close()

    if not logs:
        return 0

    connection = _connection()
    try:
        channel = connection.channel()
        _declare_queue(channel)

        prev_ts: datetime | None = None
        for log in logs:
            if prev_ts is not None:
                gap = (log.timestamp - prev_ts).total_seconds() / speed_factor
                if gap > 0:
                    time.sleep(gap)
            channel.basic_publish(exchange="", routing_key=QUEUE_NAME, body=_to_message(log))
            prev_ts = log.timestamp
    finally:
        connection.close()

    return len(logs)


def publish_manual(scenario_label: str) -> int:
    """Immediately injects every row tagged with scenario_label, bypassing replay
    timing. scenario_label is read here only to pick which rows to inject — the
    published messages never carry it (see module docstring).
    """
    session = SessionLocal()
    try:
        query = (
            select(RawLog)
            .where(RawLog.ground_truth_label == scenario_label)
            .order_by(RawLog.timestamp)
        )
        logs = session.execute(query).scalars().all()
    finally:
        session.close()

    if not logs:
        return 0

    connection = _connection()
    try:
        channel = connection.channel()
        _declare_queue(channel)
        for log in logs:
            channel.basic_publish(exchange="", routing_key=QUEUE_NAME, body=_to_message(log))
    finally:
        connection.close()

    return len(logs)
