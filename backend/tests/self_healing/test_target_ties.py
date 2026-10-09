"""A most-cited tie picks the same containment target every time (checklist CT14).

Counter.most_common breaks ties by insertion order, which for a database IN query is arbitrary. The rule
now is: the most frequent value, and on a tie the smallest."""

from datetime import datetime, timezone

import pytest

from backend.db.models import RawLog
from backend.self_healing.actions import _plan_actions, most_common_value


@pytest.mark.parametrize(
    ("values", "expected"),
    [
        ([], None),
        (["KPC0073"], "KPC0073"),
        (["KPC0073", "CQW0652", "KPC0073"], "KPC0073"),  # a clear winner is never overridden
        (["KPC0073", "CQW0652"], "CQW0652"),  # tie: the smallest
        (["CQW0652", "KPC0073"], "CQW0652"),  # ...whatever the order
        (["b", "a", "b", "a", "c"], "a"),
    ],
)
def test_most_common_value(values, expected):
    assert most_common_value(values) == expected


def _row(user: str) -> RawLog:
    return RawLog(
        timestamp=datetime(2010, 1, 5, tzinfo=timezone.utc),
        source="cert_r4.2_logon",
        event_type="logon",
        user_id=user,
        raw_fields={"f": 0},
        ground_truth_label="benign",
    )


def test_an_insider_plan_locks_the_smallest_user_when_two_users_are_cited_equally(db_session):
    rows = [_row("KPC0073"), _row("CQW0652")]
    db_session.add_all(rows)
    db_session.commit()
    evidence = [{"row_id": str(row.row_id)} for row in rows]

    plan = _plan_actions("insider_logon_anomaly", evidence)
    reversed_plan = _plan_actions("insider_logon_anomaly", list(reversed(evidence)))

    assert plan == reversed_plan == [("lock_account", "CQW0652"), ("trigger_audit", "CQW0652")]
