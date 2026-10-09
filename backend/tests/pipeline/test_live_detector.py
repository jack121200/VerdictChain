"""The rule that wakes the investigators on the live feed (checklist RT2): pure functions, no I/O."""

import math

import pytest

from backend.pipeline.live_detector import (
    DEVICE,
    LOGON,
    NETWORK,
    NETWORK_MAX_SPREAD,
    WINDOW_SIZE,
    Z_FLAG,
    Baseline,
    rank_rows,
    row_feature,
    score_window,
)

OFF_HOURS = Baseline(mean=0.037, std=math.sqrt(0.037 * (1 - 0.037)), n=58675)
CONNECTS = Baseline(mean=3.0, std=2.59, n=13685)


def test_a_window_of_near_identical_flows_is_flagged():
    flood = [math.log10(1 + 2.0 + 0.01 * i) for i in range(30)]  # a flood: the same low packet rate
    score = score_window(NETWORK, flood, None)

    assert score.flagged and score.value is not None and score.value <= NETWORK_MAX_SPREAD
    assert score.suspicion >= 0.5
    assert "30 flows" in score.rule and "packet-rate spread" in score.rule


def test_ordinary_traffic_with_a_wide_spread_of_packet_rates_is_not_flagged():
    ordinary = [math.log10(1 + rate) for rate in (0.4, 3, 64, 900, 21000, 0.05, 12, 480, 7, 150) * 3]
    score = score_window(NETWORK, ordinary, None)

    assert not score.flagged
    assert score.value is not None and score.value > NETWORK_MAX_SPREAD
    assert score.suspicion < 0.5


def test_too_few_flows_say_so_instead_of_guessing():
    score = score_window(NETWORK, [1.0, 1.0, None, None, 1.0], None)

    assert not score.flagged and score.value is None and score.suspicion == 0.0
    assert score.rule == "too few flows to compare"
    assert score.rows == 3  # only the rows with a usable value count


def test_the_flag_sits_exactly_at_z_four_and_suspicion_is_one_half_there():
    size = WINDOW_SIZE[LOGON]
    standard_error = OFF_HOURS.std / math.sqrt(size)
    threshold_mean = OFF_HOURS.mean + Z_FLAG * standard_error
    # 5 of 20 rows off-hours = 0.25 is the first mean at or above the threshold (0.2058).
    below = score_window(LOGON, [1.0] * 4 + [0.0] * 16, OFF_HOURS)
    at_or_above = score_window(LOGON, [1.0] * 5 + [0.0] * 15, OFF_HOURS)

    assert threshold_mean == pytest.approx(0.2058, abs=1e-3)
    assert not below.flagged and below.z is not None and below.z < Z_FLAG
    assert at_or_above.flagged and at_or_above.z is not None and at_or_above.z >= Z_FLAG
    assert at_or_above.threshold == pytest.approx(threshold_mean)
    assert score_window(LOGON, [0.0] * 20, OFF_HOURS).suspicion == 0.0
    assert score_window(LOGON, [1.0] * 20, OFF_HOURS).suspicion == 1.0


def test_a_window_of_heavy_device_use_is_flagged_and_an_ordinary_one_is_not():
    heavy = score_window(DEVICE, [6.0, 7.0, 5.0, 8.0] * 5, CONNECTS)
    ordinary = score_window(DEVICE, [2.0, 3.0, 4.0, 1.0, 5.0] * 4, CONNECTS)

    assert heavy.flagged and "connect_count" in heavy.rule
    assert not ordinary.flagged


def test_without_a_usable_baseline_nothing_is_flagged():
    values = [1.0] * 20
    assert not score_window(LOGON, values, None).flagged
    assert not score_window(LOGON, values, Baseline(mean=0.5, std=0.0, n=10)).flagged
    assert not score_window(LOGON, [], OFF_HOURS).flagged
    assert score_window(LOGON, values, None).rule == "no baseline for off_hours"


@pytest.mark.parametrize(
    ("group", "raw", "expected"),
    [
        (NETWORK, {"Flow Packets/s": 99.0}, 2.0),
        (NETWORK, {"Flow Packets/s": 0}, 0.0),
        (NETWORK, {"Flow Packets/s": -1.0}, None),
        (NETWORK, {"Flow Packets/s": float("inf")}, None),
        (NETWORK, {"Flow Packets/s": float("nan")}, None),
        (NETWORK, {"Flow Packets/s": "fast"}, None),
        (NETWORK, {}, None),
        (LOGON, {"off_hours": True}, 1.0),
        (LOGON, {"off_hours": False}, 0.0),
        (LOGON, {"off_hours": "true"}, 1.0),
        (LOGON, {}, None),
        (DEVICE, {"connect_count": 7}, 7.0),
        (DEVICE, {"connect_count": True}, None),
        (DEVICE, {"connect_count": None}, None),
    ],
)
def test_row_feature_reads_only_the_documented_field(group, raw, expected):
    assert row_feature(group, raw) == expected


def test_rank_rows_puts_the_signal_first():
    rows = ["a", "b", "c", "d"]
    # network: closest to the median (2.5) first, a row without a value last
    assert rank_rows(NETWORK, rows, [5.0, 2.0, None, 2.5]) == ["d", "b", "a", "c"]
    # other groups: the highest field value first
    assert rank_rows(DEVICE, rows, [1.0, 9.0, None, 4.0]) == ["b", "d", "a", "c"]
    assert rank_rows(DEVICE, [], []) == []
