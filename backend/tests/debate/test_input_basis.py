"""How the non-primary agents' data slices are chosen (backend/debate/state.py, checklist LG3).

Best first: the scenario's own rows of the agent's domain, the same users inside the scenario's time window,
any rows inside that window, the newest rows of the domain. The choice uses only the timestamps and user ids
of the scenario's rows, never a label.
"""

from datetime import datetime, timedelta, timezone

from backend.db.models import RawLog
from backend.debate.state import WINDOW_PAD, assemble_debate_inputs

JAN_5 = datetime(2010, 1, 5, 9, 0, tzinfo=timezone.utc)
JULY_2017 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)


def _row(
    source: str, event_type: str, when: datetime, user: str | None = None, label: str = "benign"
) -> RawLog:
    return RawLog(
        timestamp=when,
        source=source,
        event_type=event_type,
        user_id=user,
        raw_fields={"f": 0},
        ground_truth_label=label,
    )


def _logon(when: datetime, user: str | None = "U1", label: str = "benign") -> RawLog:
    return _row("cert_r4.2_logon", "logon", when, user, label)


def _file(when: datetime, user: str | None = "U1", label: str = "benign") -> RawLog:
    return _row("cert_r4.2_file", "file_access", when, user, label)


def _flow(when: datetime, label: str = "benign") -> RawLog:
    return _row("cicids2017", "network_flow", when, None, label)


def _store(db_session, *rows: RawLog) -> list[RawLog]:
    db_session.add_all(rows)
    db_session.commit()
    return list(rows)


def test_a_scenario_that_carries_rows_of_another_domain_gives_the_agent_those_rows(db_session):
    logons = _store(db_session, _logon(JAN_5), _logon(JAN_5 + timedelta(minutes=5)))
    files = _store(db_session, _file(JAN_5))
    _store(db_session, _flow(JULY_2017))

    inputs, basis = assemble_debate_inputs(
        "endpoint_behavior", logons, max_rows=5, scenario_rows=logons + files
    )

    assert basis == {
        "endpoint_behavior": "scenario_rows",
        "access_log": "scenario_rows",
        "network_traffic": "recent_sample",  # no network rows near January 2010
    }
    assert [r.row_id for r in inputs["access_log"]] == [files[0].row_id]
    assert [r.row_id for r in inputs["endpoint_behavior"]] == [r.row_id for r in logons]


def test_the_same_users_inside_the_time_window_come_before_other_users(db_session):
    logons = _store(db_session, _logon(JAN_5, "U1"))
    same_user = _store(db_session, _file(JAN_5 + timedelta(hours=3), "U1"))
    _store(db_session, _file(JAN_5 + timedelta(hours=1), "U2"))  # in the window, another user
    _store(db_session, _file(JAN_5 + timedelta(days=40), "U1"))  # the right user, far outside the window

    inputs, basis = assemble_debate_inputs("endpoint_behavior", logons, scenario_rows=logons)

    assert basis["access_log"] == "same_user_window"
    assert [r.row_id for r in inputs["access_log"]] == [same_user[0].row_id]


def test_other_users_in_the_window_are_used_when_the_scenario_users_have_no_rows_there(db_session):
    logons = _store(db_session, _logon(JAN_5, "U1"))
    other = _store(
        db_session, _file(JAN_5 + timedelta(hours=2), "U2"), _file(JAN_5 + timedelta(hours=1), "U3")
    )

    inputs, basis = assemble_debate_inputs("endpoint_behavior", logons, scenario_rows=logons)

    assert basis["access_log"] == "time_window"
    assert {r.row_id for r in inputs["access_log"]} == {r.row_id for r in other}
    # ordered by time, so the earlier row comes first
    assert inputs["access_log"][0].row_id == other[1].row_id


def test_the_window_is_padded_by_a_day_and_no_more(db_session):
    logons = _store(db_session, _logon(JAN_5, "U1"))
    inside = _store(db_session, _file(JAN_5 + WINDOW_PAD - timedelta(minutes=1), "U1"))
    _store(db_session, _file(JAN_5 + WINDOW_PAD + timedelta(minutes=1), "U1"))

    inputs, basis = assemble_debate_inputs("endpoint_behavior", logons, scenario_rows=logons)

    assert basis["access_log"] == "same_user_window"
    assert [r.row_id for r in inputs["access_log"]] == [inside[0].row_id]


def test_datasets_that_share_no_timeline_fall_back_to_the_newest_rows(db_session):
    flows = _store(db_session, _flow(JULY_2017, "DDoS"))
    newest = _store(db_session, _file(JAN_5 + timedelta(days=3)))
    _store(db_session, _file(JAN_5))
    _store(db_session, _logon(JAN_5))

    inputs, basis = assemble_debate_inputs("network_traffic", flows, max_rows=1, scenario_rows=flows)

    assert basis == {
        "network_traffic": "scenario_rows",
        "access_log": "recent_sample",
        "endpoint_behavior": "recent_sample",
    }
    assert [r.row_id for r in inputs["access_log"]] == [newest[0].row_id]  # the newest, not the first


def test_the_choice_never_reads_a_label(db_session):
    logons = _store(db_session, _logon(JAN_5, "U1", label="insider_scenario_1"))
    # One row carries the scenario's label, one is benign: both are equally eligible.
    files = _store(
        db_session,
        _file(JAN_5 + timedelta(hours=1), "U1", label="insider_scenario_1"),
        _file(JAN_5 + timedelta(hours=2), "U1", label="benign"),
    )

    inputs, _ = assemble_debate_inputs("endpoint_behavior", logons, scenario_rows=logons)

    assert {r.row_id for r in inputs["access_log"]} == {r.row_id for r in files}


def test_without_scenario_rows_the_primary_rows_are_the_context(db_session):
    logons = _store(db_session, _logon(JAN_5, "U1"))
    same_user = _store(db_session, _file(JAN_5, "U1"))

    inputs, basis = assemble_debate_inputs("endpoint_behavior", logons)

    assert basis["access_log"] == "same_user_window"
    assert [r.row_id for r in inputs["access_log"]] == [same_user[0].row_id]
