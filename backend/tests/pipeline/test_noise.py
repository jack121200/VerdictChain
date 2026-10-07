"""Benign-row dilution (backend/pipeline/noise.py). Seeds real raw_logs rows in the test database."""

from collections import Counter
from datetime import datetime, timedelta, timezone

import pytest

from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.pipeline.noise import dilute_with_benign

T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)


def _row(index: int, source: str, label: str, event_type: str = "network_flow") -> RawLog:
    return RawLog(
        timestamp=T0 + timedelta(seconds=index),
        source=source,
        event_type=event_type,
        user_id=None,
        host_id=f"host-{index % 3}",
        raw_fields={"Destination Port": 80 + index, "Flow Bytes/s": 1000.5 + index},
        ground_truth_label=label,
    )


def _seed(db_session, *, scenario: int = 6, benign_cicids: int = 10, scenario_source="cicids2017") -> None:
    rows = [_row(i, scenario_source, "DDoS") for i in range(scenario)]
    rows += [_row(100 + i, "cicids2017", "BENIGN") for i in range(benign_cicids)]
    db_session.add_all(rows)
    db_session.commit()


def _scenario_rows() -> list[RawLog]:
    session = SessionLocal()
    try:
        return (
            session.query(RawLog).filter(RawLog.ground_truth_label == "DDoS").order_by(RawLog.timestamp).all()
        )
    finally:
        session.close()


def _snapshot() -> dict:
    """row_id -> raw_fields as stored, to prove no value was changed."""
    session = SessionLocal()
    try:
        return {r.row_id: dict(r.raw_fields) for r in session.query(RawLog).all()}
    finally:
        session.close()


def test_noise_zero_is_the_identity(db_session):
    _seed(db_session)
    rows = _scenario_rows()
    out, dropped, effective = dilute_with_benign(rows, 0, 5)
    assert out == rows
    assert all(a is b for a, b in zip(out, rows, strict=True))
    assert dropped == []
    assert effective == 0.0


def test_row_count_is_preserved_within_the_window(db_session):
    _seed(db_session)
    out, _, _ = dilute_with_benign(_scenario_rows(), 30, 5)
    assert len(out) == 5


def test_output_is_sorted_by_timestamp(db_session):
    _seed(db_session)
    out, _, _ = dilute_with_benign(_scenario_rows(), 30, 5)
    stamps = [r.timestamp for r in out]
    assert stamps == sorted(stamps)


def test_injected_rows_are_benign_and_from_the_same_source(db_session):
    _seed(db_session)
    window = _scenario_rows()[:5]
    out, dropped, _ = dilute_with_benign(_scenario_rows(), 30, 5)
    assert dropped, "30% of 5 rows must replace at least one row"
    replacements = [r for r in out if r.row_id not in {w.row_id for w in window}]
    assert len(replacements) == len(dropped)
    assert all(r.ground_truth_label.lower() == "benign" for r in replacements)
    # The source mix is preserved: each dropped row is replaced by a row of its own source.
    assert Counter(r.source for r in out) == Counter(r.source for r in window)


def test_values_are_untouched(db_session):
    _seed(db_session)
    stored = _snapshot()
    out, _, _ = dilute_with_benign(_scenario_rows(), 30, 5)
    for row in out:
        assert row.raw_fields == stored[row.row_id]


def test_no_benign_row_is_used_twice(db_session):
    _seed(db_session, scenario=6, benign_cicids=10)
    out, _, _ = dilute_with_benign(_scenario_rows(), 30, 5)
    ids = [r.row_id for r in out]
    assert len(ids) == len(set(ids))


def test_effective_percentage_is_reported(db_session):
    _seed(db_session)
    # round(5 * 30 / 100) = round(1.5) = 2 rows dropped out of a window of 5: 40 %.
    _, dropped, effective = dilute_with_benign(_scenario_rows(), 30, 5)
    assert len(dropped) == 2
    assert effective == 40.0


def test_k_shrinks_to_zero_when_no_benign_row_of_the_source_exists(db_session):
    # The benign rows are all cicids2017; the device source has none, so nothing can be replaced.
    _seed(db_session, scenario=0, benign_cicids=10)
    db_session.add_all([_row(i, "cert_r4.2_device", "insider_scenario_2", "device_event") for i in range(5)])
    db_session.commit()
    session = SessionLocal()
    try:
        device_rows = (
            session.query(RawLog).filter(RawLog.source == "cert_r4.2_device").order_by(RawLog.timestamp).all()
        )
    finally:
        session.close()
    out, dropped, effective = dilute_with_benign(device_rows, 30, 5)
    assert dropped == []
    assert effective == 0.0
    assert [r.row_id for r in out] == [r.row_id for r in device_rows]


def test_k_shrinks_when_only_one_benign_row_is_left(db_session):
    _seed(db_session, scenario=5, benign_cicids=1)
    out, dropped, effective = dilute_with_benign(_scenario_rows(), 30, 5)
    assert len(dropped) == 1  # k was 2, one benign row existed
    assert effective == 20.0
    assert len(out) == 5


def test_at_least_one_scenario_row_is_kept(db_session):
    _seed(db_session, scenario=2, benign_cicids=10)
    # round(2 * 30 / 100) = 1, which the cap min(k, n - 1) keeps at 1: one row replaced, one kept.
    out, dropped, _ = dilute_with_benign(_scenario_rows(), 30, 5)
    assert len(dropped) == 1
    assert any(r.ground_truth_label == "DDoS" for r in out)


def test_single_row_window_drops_nothing(db_session):
    _seed(db_session, scenario=1, benign_cicids=10)
    out, dropped, effective = dilute_with_benign(_scenario_rows(), 30, 5)
    assert dropped == []
    assert effective == 0.0
    assert len(out) == 1


def test_noise_levels_outside_the_allowed_set_are_rejected(db_session):
    with pytest.raises(ValueError, match="noise_pct"):
        dilute_with_benign([], 10, 5)
