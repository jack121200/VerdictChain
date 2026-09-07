"""Raw source row -> common raw_logs schema (SKILL-data-schema.md Section 1).

Only the network (CICIDS2017) branch is implemented — the CERT r4.2 branch
(Access-Log / Endpoint-Behavior agents) is stubbed until that dataset is provided,
per this session's decision to build external/network first.
"""

from datetime import datetime
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


def normalize_cert_row(row: dict[str, Any]) -> dict[str, Any]:
    raise NotImplementedError(
        "CERT r4.2 data has not been provided yet (Access-Log / Endpoint-Behavior "
        "agents). Implement this once data/raw_data has logon.csv/device.csv/file.csv "
        "— see SKILL-data-schema.md Section 4 for the required feature spec."
    )
