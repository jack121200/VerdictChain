from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from backend.api.metrics import Metric, make_metric


def test_make_metric_sets_a_utc_as_of_and_keeps_a_real_zero():
    metric = make_metric(0, 0, "/stats", "count of threat verdicts in 24 h")
    assert metric.value == 0
    assert metric.n == 0
    assert metric.reason is None
    assert metric.as_of.utcoffset() == timedelta(0)


def test_null_value_requires_a_reason():
    with pytest.raises(ValueError, match="reason is required"):
        make_metric(None, 0, "/stats", "rate")
    metric = make_metric(None, 0, "/stats", "rate", reason="no investigations yet")
    assert metric.value is None
    assert metric.reason == "no investigations yet"


def test_rate_round_trips_through_json():
    metric = make_metric(0.75, 4, "/stats", "verified citations / total")
    restored = Metric[float].model_validate_json(metric.model_dump_json())
    assert restored.value == 0.75
    assert restored.n == 4


def test_n_must_be_non_negative():
    with pytest.raises(ValidationError):
        make_metric(1.0, -1, "/stats", "definition")


def test_as_of_must_be_timezone_aware():
    with pytest.raises(ValidationError, match="timezone-aware"):
        Metric(value=1.0, n=1, as_of=datetime(2026, 1, 1), source="s", definition="d")


def test_as_of_is_normalised_to_utc():
    plus_five = timezone(timedelta(hours=5))
    metric = Metric(
        value=1.0, n=1, as_of=datetime(2026, 1, 1, 5, 0, tzinfo=plus_five), source="s", definition="d"
    )
    assert metric.as_of == datetime(2026, 1, 1, 0, 0, tzinfo=timezone.utc)


def test_non_finite_values_are_rejected():
    with pytest.raises(ValidationError, match="finite"):
        make_metric(float("nan"), 1, "/stats", "definition")
