"""Helpers shared by the live feed tests: a private RabbitMQ queue per test, row builders and a wait loop."""

import json
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pika

from backend.config import settings
from backend.db.models import RawLog
from backend.pipeline.live_feed import RowRef

T0 = datetime(2010, 3, 1, tzinfo=timezone.utc)


@contextmanager
def private_queue() -> Iterator[str]:
    """A queue name nobody else uses, deleted afterwards."""
    name = f"test_live_{uuid.uuid4().hex[:12]}"
    try:
        yield name
    finally:
        connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
        try:
            connection.channel().queue_delete(queue=name)
        finally:
            connection.close()


def publish(queue: str, refs: list[RowRef]) -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    try:
        channel = connection.channel()
        channel.queue_declare(queue=queue, durable=False)
        for ref in refs:
            channel.basic_publish(exchange="", routing_key=queue, body=ref.message())
    finally:
        connection.close()


def drain(queue: str) -> list[dict]:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    messages: list[dict] = []
    try:
        channel = connection.channel()
        channel.queue_declare(queue=queue, durable=False)
        while True:
            method, _properties, body = channel.basic_get(queue=queue, auto_ack=True)
            if method is None:
                return messages
            messages.append(json.loads(body))
    finally:
        connection.close()


def depth(queue: str) -> int:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    try:
        return connection.channel().queue_declare(queue=queue, passive=True).method.message_count
    finally:
        connection.close()


def logon_rows(count: int, *, off_hours: bool, label: str = "benign", start: int = 0) -> list[RawLog]:
    return [
        RawLog(
            row_id=uuid.uuid4(),
            timestamp=T0 + timedelta(minutes=start + i),
            source="cert_r4.2_logon",
            event_type="logon",
            user_id=f"U{(start + i) % 7:03d}",
            host_id=f"PC-{(start + i) % 5}",
            raw_fields={"off_hours": off_hours, "logon_count": 1},
            ground_truth_label=label,
        )
        for i in range(count)
    ]


def refs_of(rows: list[RawLog]) -> list[RowRef]:
    return [RowRef(row.row_id, row.timestamp, row.source, row.event_type) for row in rows]


def wait_until(predicate: Callable[[], bool], timeout: float = 10.0, what: str = "the condition") -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.05)
    raise AssertionError(f"timed out after {timeout:g} s waiting for {what}")
