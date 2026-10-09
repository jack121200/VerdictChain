import pytest

from backend.api.rbac import CAPABILITIES, ROLES, capabilities_for, role_has


def test_roles_are_the_four_plan_roles():
    assert ROLES == ("secops_lead", "forensic_analyst", "red_team_auditor", "watchdog_supervisor")


def test_matrix_is_the_documented_one():
    assert {name: sorted(roles) for name, roles in CAPABILITIES.items()} == {
        "control_live_feed": ["secops_lead", "watchdog_supervisor"],
        "edit_settings": ["secops_lead"],
        "inject_scenario": ["forensic_analyst", "red_team_auditor", "secops_lead", "watchdog_supervisor"],
        "manage_users": ["secops_lead"],
        "override_fault_weights": ["red_team_auditor", "secops_lead", "watchdog_supervisor"],
        "quarantine_agent": ["secops_lead", "watchdog_supervisor"],
        "sign_evidence_bundle": ["secops_lead", "watchdog_supervisor"],
        "trigger_emergency_containment": ["secops_lead", "watchdog_supervisor"],
    }


def test_capabilities_for_each_role():
    assert capabilities_for("forensic_analyst") == ["inject_scenario"]
    assert capabilities_for("red_team_auditor") == ["inject_scenario", "override_fault_weights"]
    assert capabilities_for("watchdog_supervisor") == [
        "control_live_feed",
        "inject_scenario",
        "override_fault_weights",
        "quarantine_agent",
        "sign_evidence_bundle",
        "trigger_emergency_containment",
    ]
    assert capabilities_for("secops_lead") == sorted(CAPABILITIES)


def test_role_has_denies_by_default():
    assert role_has("forensic_analyst", "sign_evidence_bundle") is False
    assert role_has("secops_lead", "manage_users") is True
    assert role_has("root", "inject_scenario") is False
    assert role_has("secops_lead", "no_such_capability") is False
    assert capabilities_for("root") == []


def test_capability_matrix_is_read_only():
    with pytest.raises(TypeError):
        CAPABILITIES["manage_users"] = frozenset(ROLES)  # type: ignore[index]
