"""The monitor of the live feed (checklist RT2): windows, scores, the flag callback and the blind boundary.
Real RabbitMQ, Redis and Postgres."""

import ast
import math
from pathlib import Path

import pytest

from backend.db.models import RawLog
from backend.pipeline import live_state
from backend.pipeline.live_detector import DEVICE, FILE, LOGON, Baseline
from backend.pipeline.live_feed import RowRef
from backend.pipeline.live_monitor import LiveMonitor, compute_baselines
from backend.tests.pipeline.live_support import (
    T0,
    logon_rows,
    private_queue,
    publish,
    refs_of,
    wait_until,
)

OFF_HOURS = Baseline(mean=0.037, std=math.sqrt(0.037 * (1 - 0.037)), n=58675)
PIPELINE = Path(__file__).resolve().parents[2] / "pipeline"


@pytest.fixture(autouse=True)
def _clean_live_state():
    live_state.reset()
    yield
    live_state.reset()


def _run(db_session, rows, flags, *, accept: bool):
    """Stores the rows, publishes their pointers and runs a monitor over them until all are consumed."""
    db_session.add_all(rows)
    db_session.commit()
    with private_queue() as queue:
        monitor = LiveMonitor(
            queue_name=queue, baselines={LOGON: OFF_HOURS}, on_flag=lambda flag: flags.append(flag) or accept
        )
        monitor.start()
        try:
            publish(queue, refs_of(rows))
            wait_until(lambda: live_state.counters()["consumed"] >= len(rows), what="all rows to be consumed")
        finally:
            monitor.stop()
    assert monitor.error is None


def test_a_full_window_of_off_hours_logons_is_flagged_with_its_rows_in_order(db_session):
    rows = logon_rows(20, off_hours=True)
    flags: list = []

    _run(db_session, rows, flags, accept=False)

    assert len(flags) == 1
    flag = flags[0]
    assert flag.group == LOGON and flag.score.flagged
    assert flag.row_ids == [row.row_id for row in rows]  # the order they arrived in
    assert flag.features == [1.0] * 20
    assert "logon window" in flag.score.rule and "off_hours" in flag.score.rule
    window = live_state.windows()[LOGON]
    assert window["flagged"] is True and window["rows"] == 20 and window["suspicion"] == 1.0
    assert live_state.counters() == {"published": 0, "consumed": 20, "flagged": 1, "triggered": 0}


def test_ordinary_logons_are_never_flagged(db_session):
    flags: list = []

    _run(db_session, logon_rows(40, off_hours=False), flags, accept=False)

    assert flags == []
    window = live_state.windows()[LOGON]
    assert window["flagged"] is False and window["suspicion"] == 0.0 and window["rows"] == 20
    assert live_state.counters()["flagged"] == 0


def test_a_window_is_scored_again_every_five_rows_while_nobody_takes_the_flag(db_session):
    flags: list = []

    _run(db_session, logon_rows(40, off_hours=True), flags, accept=False)

    assert len(flags) == 5  # at rows 20, 25, 30, 35 and 40


def test_an_accepted_flag_clears_the_window_so_the_next_one_needs_twenty_new_rows(db_session):
    flags: list = []

    _run(db_session, logon_rows(40, off_hours=True), flags, accept=True)

    assert len(flags) == 2  # at rows 20 and 40
    assert flags[0].row_ids[0] != flags[1].row_ids[0]
    assert not set(flags[0].row_ids) & set(flags[1].row_ids)


def test_rows_from_an_unknown_source_are_consumed_but_not_windowed(db_session):
    stranger = RawLog(
        timestamp=T0, source="firewall", event_type="other", raw_fields={}, ground_truth_label=None
    )
    db_session.add(stranger)
    db_session.commit()
    flags: list = []

    with private_queue() as queue:
        monitor = LiveMonitor(
            queue_name=queue, baselines={}, on_flag=lambda flag: flags.append(flag) or False
        )
        monitor.start()
        try:
            publish(queue, [RowRef(stranger.row_id, T0, "firewall", "other")])
            wait_until(lambda: live_state.counters()["consumed"] >= 1, what="the row to be consumed")
        finally:
            monitor.stop()

    assert flags == [] and live_state.arrivals(10) == []


def test_arrivals_keep_the_allow_listed_fields_newest_first_and_no_label(db_session):
    rows = logon_rows(6, off_hours=False, label="secret_label_never_shown")
    _run(db_session, rows, [], accept=False)

    arrivals = live_state.arrivals(10)

    assert [item["row_id"] for item in arrivals] == [str(row.row_id) for row in reversed(rows)]
    assert set(arrivals[0]) == {
        "row_id",
        "timestamp",
        "source",
        "event_type",
        "user_id",
        "host_id",
        "arrived_at",
    }
    assert "secret_label_never_shown" not in str(arrivals)
    assert arrivals[0]["user_id"] == rows[-1].user_id and arrivals[0]["host_id"] == rows[-1].host_id


def test_the_measured_rate_needs_two_samples_a_second_apart():
    assert live_state.measured_rate(now=100.0) == (None, 0)
    live_state.push_sample(0, now=95.0)
    assert live_state.measured_rate(now=100.0) == (None, 1)
    live_state.push_sample(50, now=99.0)
    rate, samples = live_state.measured_rate(now=100.0)
    assert samples == 2 and rate == pytest.approx(50 / 4.0)
    live_state.push_sample(60, now=99.2)  # the rate runs from the oldest sample in the window to the newest
    rate, _ = live_state.measured_rate(now=100.0)
    assert rate == pytest.approx(60 / 4.2)


def test_baselines_are_the_dataset_wide_mean_and_spread_of_each_field(db_session):
    def row(source, event_type, **raw):
        return RawLog(
            timestamp=T0, source=source, event_type=event_type, raw_fields=raw, ground_truth_label="x"
        )

    db_session.add_all(
        [row("cert_r4.2_logon", "logon", off_hours=index < 10) for index in range(100)]
        + [
            row("cert_r4.2_device", "device_event", connect_count=2 if index % 2 else 4)
            for index in range(100)
        ]
    )
    db_session.commit()

    baselines = compute_baselines()

    assert set(baselines) == {LOGON, DEVICE}  # no file rows, so no file baseline
    assert baselines[LOGON].mean == pytest.approx(0.1) and baselines[LOGON].std == pytest.approx(0.3)
    assert baselines[DEVICE].mean == pytest.approx(3.0) and baselines[DEVICE].std == pytest.approx(1.0)
    assert baselines[LOGON].n == 100 and FILE not in baselines


@pytest.mark.parametrize("module", ["live_monitor.py", "live_detector.py", "live_state.py"])
def test_the_monitor_side_never_names_a_label(module):
    """The blind boundary of the live path: the sensor may read labels (it plays the world), nothing after."""
    tree = ast.parse((PIPELINE / module).read_text(encoding="utf-8"))
    names = {node.id for node in ast.walk(tree) if isinstance(node, ast.Name)}
    names |= {node.attr for node in ast.walk(tree) if isinstance(node, ast.Attribute)}
    names |= {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }
    forbidden = {"ground_truth_label", "scenario_label"}
    assert not [name for name in names if name in forbidden]
