"""The simulated sensor (checklist RT1): what it replays, what it publishes and how fast. Real RabbitMQ."""

import json
import random
import time
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from backend.db.models import RawLog
from backend.pipeline import live_feed, live_state
from backend.pipeline.live_feed import LiveFeed, Pools, RowRef, load_pools, next_segment
from backend.tests.pipeline.live_support import depth, drain, private_queue, wait_until

T0 = datetime(2017, 7, 5, tzinfo=timezone.utc)


def _ref(index: int, source: str = "cicids2017", event_type: str = "network_flow") -> RowRef:
    return RowRef(uuid.uuid4(), T0 + timedelta(seconds=index), source, event_type)


def _pools() -> Pools:
    return Pools(
        benign={
            "network": [_ref(i) for i in range(200)],
            "logon": [_ref(i, "cert_r4.2_logon", "logon") for i in range(200)],
            "device": [],
            "file": [],
        },
        attack={"DDoS": [_ref(1000 + i) for i in range(100)], "Portscan": []},
    )


def test_an_attack_segment_is_a_contiguous_slice_of_one_scenario():
    pools = _pools()
    segment = next_segment(pools, random.Random(1), attack_share=1.0)

    assert live_feed.ATTACK_SEGMENT[0] <= len(segment) <= live_feed.ATTACK_SEGMENT[1]
    attack_ids = [ref.row_id for ref in pools.attack["DDoS"]]
    start = attack_ids.index(segment[0].row_id)
    assert [ref.row_id for ref in segment] == attack_ids[start : start + len(segment)]


def test_a_benign_segment_is_a_random_sample_of_one_source_group():
    pools = _pools()
    segment = next_segment(pools, random.Random(2), attack_share=0.0)

    assert live_feed.BENIGN_SEGMENT[0] <= len(segment) <= live_feed.BENIGN_SEGMENT[1]
    assert len({ref.source for ref in segment}) == 1  # one group per segment
    assert len({ref.row_id for ref in segment}) == len(segment)  # no row twice
    assert not {ref.row_id for ref in segment} & {ref.row_id for ref in pools.attack["DDoS"]}


def test_the_share_of_attack_segments_follows_the_setting():
    pools = _pools()
    attack_ids = {ref.row_id for ref in pools.attack["DDoS"]}
    rng = random.Random(3)
    segments = [next_segment(pools, rng, attack_share=0.25) for _ in range(400)]
    attacks = sum(1 for segment in segments if segment[0].row_id in attack_ids)

    assert 70 <= attacks <= 130  # 25 % of 400, give or take chance


def test_with_nothing_to_replay_there_is_no_segment():
    assert next_segment(Pools(), random.Random(0), attack_share=0.5) == []


def test_a_message_is_a_pointer_with_no_fields_and_no_label():
    ref = RowRef(uuid.UUID(int=7), T0, "cert_r4.2_logon", "logon")
    body = json.loads(ref.message())

    assert set(body) == {"row_id", "timestamp", "source", "event_type"}
    assert body["row_id"] == str(uuid.UUID(int=7))


def test_pools_split_ordinary_rows_by_group_and_scenario_rows_by_label(db_session):
    def row(source: str, event_type: str, label: str | None, seconds: int) -> RawLog:
        return RawLog(
            timestamp=T0 + timedelta(seconds=seconds),
            source=source,
            event_type=event_type,
            raw_fields={"x": 1},
            ground_truth_label=label,
        )

    db_session.add_all(
        [
            row("cicids2017", "network_flow", "BENIGN", 0),
            row("cicids2017", "network_flow", "DDoS", 2),
            row("cicids2017", "network_flow", "DDoS", 1),
            row("cert_r4.2_logon", "logon", "benign", 3),
            row("cert_r4.2_logon", "logon", "insider_scenario_1", 4),
            row("cert_r4.2_device", "device_event", None, 5),
            row("unknown_source", "other", "DDoS", 6),
        ]
    )
    db_session.commit()

    pools = load_pools()

    assert {group: len(refs) for group, refs in pools.benign.items()} == {
        "network": 1,
        "logon": 1,
        "device": 1,  # an unlabelled row is ordinary traffic
        "file": 0,
    }
    assert set(pools.attack) == {"DDoS", "insider_scenario_1"}
    assert [ref.timestamp.second for ref in pools.attack["DDoS"]] == [1, 2]  # oldest first
    assert all(ref.source != "unknown_source" for refs in pools.attack.values() for ref in refs)


def test_the_feed_publishes_at_about_the_set_rate_and_only_pointers():
    live_state.reset()
    with private_queue() as queue:
        feed = LiveFeed(queue_name=queue, events_per_second=20, attack_share=0.5, pools=_pools(), seed=5)
        feed.start()
        try:
            time.sleep(1.5)
        finally:
            feed.stop()
        messages = drain(queue)

    assert feed.error is None and not feed.alive
    assert 18 <= len(messages) <= 42  # 20 per second for 1.5 s, in ticks of 0.2 s
    assert all(set(message) == {"row_id", "timestamp", "source", "event_type"} for message in messages)
    assert live_state.counters()["published"] == len(messages)
    assert live_state.backlog() is not None


def test_the_feed_waits_while_the_queue_is_backed_up(monkeypatch):
    monkeypatch.setattr(live_feed, "MAX_BACKLOG", 6)
    monkeypatch.setattr(live_feed, "BACKLOG_CHECK_SECONDS", 0.2)
    live_state.reset()
    with private_queue() as queue:
        feed = LiveFeed(queue_name=queue, events_per_second=50, attack_share=0.0, pools=_pools(), seed=6)
        feed.start()
        try:
            wait_until(lambda: feed.alive and live_state.counters()["published"] >= 6, what="the first rows")
            time.sleep(1.0)
        finally:
            feed.stop()
        waiting = depth(queue)

    assert 6 <= waiting <= 6 + 2 * 10 + 10  # it stopped adding soon after the limit (50 x 1.2 s would be 60+)


def test_a_feed_with_no_rows_stops_and_says_why():
    with private_queue() as queue:
        feed = LiveFeed(queue_name=queue, events_per_second=20, attack_share=0.5, pools=Pools(), seed=1)
        feed.start()
        wait_until(lambda: not feed.alive, what="the feed to give up")

    assert feed.error == "no rows to replay: ingest a dataset first"


@pytest.fixture(autouse=True)
def _clean_live_state():
    live_state.reset()
    yield
    live_state.reset()
