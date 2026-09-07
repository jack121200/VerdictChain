import uuid

import pytest

from backend.db.models import RawLog
from backend.debate.state import (
    build_peripheral_digest,
    is_near_duplicate,
    primary_agent_for_rows,
)


def _row(event_type: str, label: str = "benign") -> RawLog:
    return RawLog(
        row_id=uuid.uuid4(),
        timestamp="2020-01-01T00:00:00+00:00",
        source="x",
        event_type=event_type,
        raw_fields={},
        ground_truth_label=label,
    )


def test_primary_agent_for_rows_network():
    assert primary_agent_for_rows([_row("network_flow")]) == "network_traffic"


def test_primary_agent_for_rows_mixed_endpoint_types():
    assert primary_agent_for_rows([_row("logon"), _row("device_event")]) == "endpoint_behavior"


def test_primary_agent_for_rows_rejects_multi_domain():
    with pytest.raises(ValueError):
        primary_agent_for_rows([_row("network_flow"), _row("file_access")])


def test_build_peripheral_digest_excludes_self_and_never_leaks_label():
    rows_by_agent = {
        "network_traffic": [_row("network_flow", label="SECRET_SCENARIO")],
        "access_log": [_row("file_access")],
    }
    digest = build_peripheral_digest(rows_by_agent, exclude_agent="network_traffic")
    assert "network_traffic" not in digest
    assert digest["access_log"]["row_count"] == 1
    assert "SECRET_SCENARIO" not in str(digest)


def test_is_near_duplicate_true_for_identical_text():
    assert is_near_duplicate("Traffic spike suggests DDoS.", "Traffic spike suggests DDoS.")


def test_is_near_duplicate_false_for_genuinely_different_text():
    assert not is_near_duplicate(
        "Traffic spike suggests DDoS.",
        "CHALLENGE: Access-Log's theory is unsupported given off-hours logon pattern.",
    )
