"""Per-user-per-day feature aggregation for CERT r4.2 (SKILL-data-schema.md
Section 4). Raw events (one row per logon/device/file action) get aggregated
into one row per (user, day) per category - that aggregate row is what
normalize_cert_row() turns into a raw_logs entry, same as one CICIDS flow row
does for the network branch.

Two features the spec allows as conditional ("if derivable") are NOT derivable
from this exact CERT r4.2 file layout, so they're left out rather than faked:
- department-mismatch: file.csv has no file/resource-owner department field,
  only user+filename+pc. LDAP gives the ACCESSING user's department (kept on
  the row for citation), but there's nothing to compare it against.
- "distinct device IDs": device.csv logs Connect/Disconnect events per PC, not
  a per-device serial/ID. "distinct PCs with device activity" is the closest
  honest proxy and is what's actually computed here.
"""

import pandas as pd

REPO_ROOT_LDAP_GLOB = "LDAP/*.csv"


def load_ldap_departments(ldap_dir) -> dict[str, str]:
    """user_id -> department, from the most recent monthly LDAP snapshot they
    appear in (department can drift over time per the r4.2 readme).
    """
    departments: dict[str, tuple[str, str]] = {}  # user_id -> (yyyymm, department)
    for path in sorted(ldap_dir.glob("*.csv")):
        yyyymm = path.stem
        df = pd.read_csv(path, usecols=["user_id", "department"], encoding="utf-8")
        for user_id, department in zip(df["user_id"], df["department"]):
            prev = departments.get(user_id)
            if prev is None or yyyymm > prev[0]:
                departments[user_id] = (yyyymm, department)
    return {user: dept for user, (_, dept) in departments.items()}


def _label_events(df: pd.DataFrame, malicious_ids: dict[str, str]) -> pd.Series:
    return df["id"].map(malicious_ids).fillna("benign")


def _user_off_hours_bounds(logon_df: pd.DataFrame) -> dict[str, tuple[float, float]]:
    """Each user's own typical logon-hour range (10th-90th percentile of THEIR
    OWN logon hours), per SKILL-data-schema.md Section 4: "computed from their
    own history, not a single global cutoff".
    """
    logons = logon_df[logon_df["activity"] == "Logon"].copy()
    logons["hour"] = logons["date"].dt.hour
    bounds = logons.groupby("user")["hour"].quantile([0.1, 0.9]).unstack()
    return {user: (row[0.1], row[0.9]) for user, row in bounds.iterrows()}


def build_logon_features(logon_df: pd.DataFrame, malicious_ids: dict[str, str]) -> pd.DataFrame:
    df = logon_df.copy()
    df["day"] = df["date"].dt.date
    df["hour"] = df["date"].dt.hour
    df["scenario"] = _label_events(df, malicious_ids)

    bounds = _user_off_hours_bounds(df)

    rows = []
    for (user, day), group in df.groupby(["user", "day"]):
        logons = group[group["activity"] == "Logon"]
        logoffs = group[group["activity"] == "Logoff"]
        lo, hi = bounds.get(user, (0, 23))
        off_hours = bool(((logons["hour"] < lo - 1) | (logons["hour"] > hi + 1)).any())
        malicious_labels = set(group.loc[group["scenario"] != "benign", "scenario"])
        rows.append(
            {
                "user": user,
                "day": day.isoformat(),
                "logon_count": len(logons),
                "logoff_count": len(logoffs),
                "distinct_pcs": group["pc"].nunique(),
                "primary_pc": group["pc"].mode().iat[0] if not group.empty else None,
                "off_hours": off_hours,
                "ground_truth_label": next(iter(malicious_labels), "benign"),
                "row_ids": ",".join(group["id"].tolist()),
            }
        )
    return pd.DataFrame(rows)


def build_device_features(device_df: pd.DataFrame, malicious_ids: dict[str, str]) -> pd.DataFrame:
    df = device_df.copy()
    df["day"] = df["date"].dt.date
    df["scenario"] = _label_events(df, malicious_ids)

    rows = []
    for (user, day), group in df.groupby(["user", "day"]):
        connects = group[group["activity"] == "Connect"]
        malicious_labels = set(group.loc[group["scenario"] != "benign", "scenario"])
        rows.append(
            {
                "user": user,
                "day": day.isoformat(),
                "connect_count": len(connects),
                # proxy for "distinct devices" - device.csv has no per-device
                # serial, only which PC saw the connect (see module docstring)
                "distinct_pcs_with_device_activity": group["pc"].nunique(),
                "primary_pc": group["pc"].mode().iat[0] if not group.empty else None,
                "ground_truth_label": next(iter(malicious_labels), "benign"),
                "row_ids": ",".join(group["id"].tolist()),
            }
        )
    return pd.DataFrame(rows)


def build_file_features(
    file_df: pd.DataFrame, malicious_ids: dict[str, str], departments: dict[str, str]
) -> pd.DataFrame:
    df = file_df.copy()
    df["day"] = df["date"].dt.date
    df["scenario"] = _label_events(df, malicious_ids)

    rows = []
    for (user, day), group in df.groupby(["user", "day"]):
        malicious_labels = set(group.loc[group["scenario"] != "benign", "scenario"])
        rows.append(
            {
                "user": user,
                "day": day.isoformat(),
                "file_access_count": len(group),
                "distinct_filenames": group["filename"].nunique(),
                "primary_pc": group["pc"].mode().iat[0] if not group.empty else None,
                "user_department": departments.get(user),  # accessor's dept only - see docstring
                "ground_truth_label": next(iter(malicious_labels), "benign"),
                "row_ids": ",".join(group["id"].tolist()),
            }
        )
    return pd.DataFrame(rows)
