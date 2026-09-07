import pandas as pd

from backend.pipeline.cert_features import build_device_features, build_file_features, build_logon_features


def _logon_df(rows):
    return pd.DataFrame(rows, columns=["id", "date", "user", "pc", "activity"]).assign(
        date=lambda d: pd.to_datetime(d["date"])
    )


def test_build_logon_features_aggregates_per_user_per_day():
    df = _logon_df(
        [
            ["e1", "2010-01-02 08:00:00", "U1", "PC-1", "Logon"],
            ["e2", "2010-01-02 17:00:00", "U1", "PC-1", "Logoff"],
            ["e3", "2010-01-03 08:05:00", "U1", "PC-1", "Logon"],
        ]
    )
    out = build_logon_features(df, malicious_ids={})
    assert len(out) == 2  # 2 distinct (user, day) pairs
    day1 = out[out["day"] == "2010-01-02"].iloc[0]
    assert day1["logon_count"] == 1
    assert day1["logoff_count"] == 1
    assert day1["ground_truth_label"] == "benign"


def test_build_logon_features_off_hours_flag_uses_own_history_not_global_cutoff():
    # U1 always logs on around 3am (their own normal pattern) - should NOT be off_hours
    rows = [[f"e{i}", f"2010-01-{i+1:02d} 03:00:00", "U1", "PC-1", "Logon"] for i in range(10)]
    # one day U1 logs on at 3pm - a genuine deviation from THEIR OWN pattern
    rows.append(["e99", "2010-01-20 15:00:00", "U1", "PC-1", "Logon"])
    df = _logon_df(rows)
    out = build_logon_features(df, malicious_ids={})

    normal_day = out[out["day"] == "2010-01-01"].iloc[0]
    deviant_day = out[out["day"] == "2010-01-20"].iloc[0]
    assert normal_day["off_hours"] == False  # noqa: E712
    assert deviant_day["off_hours"] == True  # noqa: E712


def test_build_logon_features_labels_malicious_day_from_event_id():
    df = _logon_df(
        [
            ["e1", "2010-01-02 08:00:00", "U1", "PC-1", "Logon"],
            ["e2", "2010-01-05 03:00:00", "U1", "PC-1", "Logon"],  # malicious event
        ]
    )
    out = build_logon_features(df, malicious_ids={"e2": "insider_scenario_1"})
    benign_day = out[out["day"] == "2010-01-02"].iloc[0]
    malicious_day = out[out["day"] == "2010-01-05"].iloc[0]
    assert benign_day["ground_truth_label"] == "benign"
    assert malicious_day["ground_truth_label"] == "insider_scenario_1"


def test_build_device_features_counts_connects():
    df = pd.DataFrame(
        [
            ["e1", "2010-01-02 08:00:00", "U1", "PC-1", "Connect"],
            ["e2", "2010-01-02 08:30:00", "U1", "PC-1", "Disconnect"],
        ],
        columns=["id", "date", "user", "pc", "activity"],
    ).assign(date=lambda d: pd.to_datetime(d["date"]))
    out = build_device_features(df, malicious_ids={})
    assert len(out) == 1
    assert out.iloc[0]["connect_count"] == 1


def test_build_file_features_keeps_department_but_no_fabricated_mismatch():
    df = pd.DataFrame(
        [["e1", "2010-01-02 08:00:00", "U1", "PC-1", "report.doc"]],
        columns=["id", "date", "user", "pc", "filename"],
    ).assign(date=lambda d: pd.to_datetime(d["date"]))
    out = build_file_features(df, malicious_ids={}, departments={"U1": "Engineering"})
    row = out.iloc[0]
    assert row["user_department"] == "Engineering"
    assert "department_mismatch" not in out.columns  # not derivable from this schema - see docstring
