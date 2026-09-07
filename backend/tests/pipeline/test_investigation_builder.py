import pytest
from datetime import datetime, timedelta, timezone

from backend.db.models import RawLog
from backend.pipeline.investigation_builder import create_investigation, create_manual_investigation


def _make_log(db_session, minutes_ago: int, label: str) -> RawLog:
    log = RawLog(
        timestamp=datetime.now(timezone.utc) - timedelta(minutes=minutes_ago),
        source="cicids2017",
        source_file="test.csv",
        event_type="network_flow",
        raw_fields={"Destination Port": 445},
        ground_truth_label=label,
    )
    db_session.add(log)
    db_session.flush()
    return log


def test_create_manual_investigation_groups_matching_rows(db_session):
    target1 = _make_log(db_session, minutes_ago=5, label="ddos_test")
    target2 = _make_log(db_session, minutes_ago=4, label="ddos_test")
    _make_log(db_session, minutes_ago=3, label="portscan_test")
    db_session.commit()

    investigation, rows = create_manual_investigation("ddos_test")

    assert investigation.trigger_type == "manual"
    assert investigation.scenario_label == "ddos_test"
    assert investigation.status == "investigating"
    assert {r.row_id for r in rows} == {target1.row_id, target2.row_id}


def test_create_manual_investigation_raises_on_no_matches(db_session):
    with pytest.raises(ValueError, match="no raw_logs rows found"):
        create_manual_investigation("nonexistent_scenario_xyz")


def test_create_investigation_requires_row_ids():
    with pytest.raises(ValueError):
        create_investigation(row_ids=[], trigger_type="manual")
