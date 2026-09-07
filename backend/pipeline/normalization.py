"""Raw source row -> common raw_logs schema (SKILL-data-schema.md Section 1).

CERT r4.2 rows are pre-aggregated per (user, day, category) by
backend/pipeline/cert_features.py before reaching these functions — one
aggregate row in, one raw_logs insert dict out, same contract as the network
branch's one-flow-row-in/one-insert-dict-out.
"""

from datetime import datetime, timezone
from typing import Any

# Columns that are metadata, not flow features — excluded from raw_fields so the
# reconstructed-timestamp caveat lives in one place (source_file lets you look it
# up), and Label is deliberately never merged into raw_fields (see below).
_METADATA_COLUMNS = {"Timestamp", "Source File", "Label"}


def _decimal_to_dotted_ip(decimal_ip: Any) -> str:
    n = int(decimal_ip)
    return ".".join(str((n >> shift) & 0xFF) for shift in (24, 16, 8, 0))


def normalize_network_row(row: dict[str, Any]) -> dict[str, Any]:
    """One row from data/processed/network_subset.csv -> a raw_logs insert dict.

    Label is deliberately kept OUT of raw_fields and stored only in
    ground_truth_label. raw_fields is what backend/agents/ code reads to build an
    investigator's data slice — if the label sat inside it, keeping agents blind
    to the scenario (SKILL-security.md Section 5's hard boundary) would depend on
    every future prompt-builder remembering to strip one specific key. Keeping it
    structurally absent from raw_fields removes that failure mode entirely.
    """
    raw_fields = {k: v for k, v in row.items() if k not in _METADATA_COLUMNS}

    return {
        "timestamp": datetime.fromisoformat(row["Timestamp"]),
        "source": "cicids2017",
        "source_file": row["Source File"],
        "event_type": "network_flow",
        "user_id": None,
        "host_id": _decimal_to_dotted_ip(row["Source IP"]),
        "severity": None,
        "raw_fields": raw_fields,
        "ground_truth_label": row["Label"],
    }


_CERT_METADATA_COLUMNS = {"user", "day", "ground_truth_label", "primary_pc"}


def _cert_day_timestamp(day_iso: str) -> datetime:
    """Aggregate rows represent a whole day, not an instant - midnight UTC on
    that real day. Not fabricated precision: the row genuinely IS a full-day
    summary, so this is the honest timestamp for it (see cert_features.py).
    """
    return datetime.fromisoformat(day_iso).replace(tzinfo=timezone.utc)


def normalize_cert_logon_row(row: dict[str, Any]) -> dict[str, Any]:
    raw_fields = {k: v for k, v in row.items() if k not in _CERT_METADATA_COLUMNS}
    return {
        "timestamp": _cert_day_timestamp(row["day"]),
        "source": "cert_r4.2_logon",
        "source_file": "logon.csv",
        "event_type": "logon",
        "user_id": row["user"],
        "host_id": row["primary_pc"],
        "severity": None,
        "raw_fields": raw_fields,
        "ground_truth_label": row["ground_truth_label"],
    }


def normalize_cert_device_row(row: dict[str, Any]) -> dict[str, Any]:
    raw_fields = {k: v for k, v in row.items() if k not in _CERT_METADATA_COLUMNS}
    return {
        "timestamp": _cert_day_timestamp(row["day"]),
        "source": "cert_r4.2_device",
        "source_file": "device.csv",
        "event_type": "device_event",
        "user_id": row["user"],
        "host_id": row["primary_pc"],
        "severity": None,
        "raw_fields": raw_fields,
        "ground_truth_label": row["ground_truth_label"],
    }


def normalize_cert_file_row(row: dict[str, Any]) -> dict[str, Any]:
    raw_fields = {k: v for k, v in row.items() if k not in _CERT_METADATA_COLUMNS}
    return {
        "timestamp": _cert_day_timestamp(row["day"]),
        "source": "cert_r4.2_file",
        "source_file": "file.csv",
        "event_type": "file_access",
        "user_id": row["user"],
        "host_id": row["primary_pc"],
        "severity": None,
        "raw_fields": raw_fields,
        "ground_truth_label": row["ground_truth_label"],
    }
