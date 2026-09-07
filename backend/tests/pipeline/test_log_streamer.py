import json
import time
from datetime import datetime, timedelta, timezone

from backend.config import settings
from backend.db.models import RawLog
from backend.pipeline.log_streamer import QUEUE_NAME, publish_continuous, publish_manual

import pika


def _drain_queue(max_messages: int, timeout_s: float = 5.0) -> list[dict]:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)

    messages = []
    deadline = time.monotonic() + timeout_s
    while len(messages) < max_messages and time.monotonic() < deadline:
        method, _props, body = channel.basic_get(queue=QUEUE_NAME, auto_ack=True)
        if method is None:
            time.sleep(0.05)
            continue
        messages.append(json.loads(body))
    connection.close()
    return messages


def _purge_queue() -> None:
    connection = pika.BlockingConnection(pika.URLParameters(settings.rabbitmq_url))
    channel = connection.channel()
    channel.queue_declare(queue=QUEUE_NAME, durable=True)
    channel.queue_purge(QUEUE_NAME)
    connection.close()


def _make_log(db_session, minutes_ago: int, label: str) -> RawLog:
    log = RawLog(
        timestamp=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        source="cicids2017",
        source_file="test.csv",
        event_type="network_flow",
        raw_fields={"destination_port": 445},
        ground_truth_label=label,
    )
    db_session.add(log)
    db_session.flush()
    return log


def test_publish_manual_filters_by_scenario_and_never_leaks_label(db_session):
    _purge_queue()

    target = _make_log(db_session, minutes_ago=5, label="ddos_scenario")
    _make_log(db_session, minutes_ago=4, label="portscan_scenario")
    db_session.commit()

    count = publish_manual("ddos_scenario")
    assert count == 1

    messages = _drain_queue(max_messages=1)
    assert len(messages) == 1
    assert messages[0]["row_id"] == str(target.row_id)
    assert "ground_truth_label" not in messages[0]
    assert "raw_fields" not in messages[0]


def test_publish_continuous_preserves_order_and_respects_speed_factor(db_session):
    _purge_queue()

    older = _make_log(db_session, minutes_ago=10, label="a")
    newer = _make_log(db_session, minutes_ago=9, label="b")  # 60s gap
    db_session.commit()

    start = time.monotonic()
    count = publish_continuous(speed_factor=30.0)  # 60s gap -> ~2s sleep
    elapsed = time.monotonic() - start

    assert count == 2
    assert elapsed >= 1.5  # the compressed sleep actually happened, not skipped

    messages = _drain_queue(max_messages=2)
    assert [m["row_id"] for m in messages] == [str(older.row_id), str(newer.row_id)]
