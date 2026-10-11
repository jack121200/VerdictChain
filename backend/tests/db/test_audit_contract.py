"""The audit catalog and the hash pre-image: the contract the API and the browser rely on (plan 3.2)."""

import hashlib
import uuid

import pytest

from backend.db.audit import (
    AUDIT_ACTIONS,
    append_entry,
    canonical_detail,
    compute_entry_hash,
    hash_input,
    is_known_action,
)
from backend.db.models import AuditTrail


def test_catalog_is_exactly_the_documented_action_list():
    assert AUDIT_ACTIONS == frozenset(
        {
            "investigation_started",
            "round_completed",
            "credibility_update",
            "agent_isolated",
            "agent_restored",
            "agent_quarantined",
            "verdict_reached",
            "analyst_feedback",
            "register",
            "login",
            "role_changed",
            "settings_changed",
            "evidence_bundle_signed",
            "emergency_containment",
            "containment_released",
            "byzantine_fault_injected",
            "debate_started",
            "investigation_failed",
            "live_feed_started",
            "live_feed_stopped",
            "lock_account",
            "block_ip_range",
            "trigger_rate_limiting",
            "trigger_audit",
        }
    )


def test_release_actions_are_known_only_with_an_action_name():
    assert is_known_action("release:unlock_account")
    assert not is_known_action("release:")
    assert not is_known_action("unlock_account")


def test_unknown_action_is_rejected_before_anything_is_written(db_session):
    with pytest.raises(ValueError, match="unknown audit action"):
        append_entry(db_session, actor="x", action="not_in_catalog")
    assert db_session.query(AuditTrail).count() == 0


def test_hash_input_is_the_exact_preimage_that_is_hashed():
    pre = hash_input("self_healing", "lock_account", {"target": "u1"}, None)
    assert pre == 'self_healing|lock_account|{"target": "u1"}|'
    assert hash_input("a", "login", None, "ff") == "a|login|{}|ff"
    assert compute_entry_hash("self_healing", "lock_account", {"target": "u1"}, None) == (
        hashlib.sha256(pre.encode("utf-8")).hexdigest()
    )


def test_canonical_detail_rounds_floats_and_stringifies_uuids():
    row_id = uuid.uuid4()
    assert canonical_detail({"a": 0.1234567, "b": [row_id, 2.0], "c": None}) == {
        "a": 0.123457,
        "b": [str(row_id), 2.0],
        "c": None,
    }
    assert hash_input("a", "login", {"x": 0.1234567}, None) == 'a|login|{"x": 0.123457}|'


def test_non_finite_floats_are_rejected():
    with pytest.raises(ValueError, match="NaN or infinity"):
        canonical_detail({"x": float("nan")})
