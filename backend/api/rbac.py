"""RBAC constants (plan section 3.6). The endpoints that enforce them arrive in W1-B; this module
holds only the role list and the capability matrix.
"""

from collections.abc import Mapping
from types import MappingProxyType

ROLES: tuple[str, ...] = ("secops_lead", "forensic_analyst", "red_team_auditor", "watchdog_supervisor")

_LEAD, _ANALYST, _RED_TEAM, _SUPERVISOR = ROLES

CAPABILITIES: Mapping[str, frozenset[str]] = MappingProxyType(
    {
        "sign_evidence_bundle": frozenset({_LEAD, _SUPERVISOR}),
        "trigger_emergency_containment": frozenset({_LEAD, _SUPERVISOR}),
        "inject_scenario": frozenset(ROLES),
        "override_fault_weights": frozenset({_LEAD, _SUPERVISOR, _RED_TEAM}),
        "quarantine_agent": frozenset({_LEAD, _SUPERVISOR}),
        "manage_users": frozenset({_LEAD}),
        "edit_settings": frozenset({_LEAD}),
    }
)


def capabilities_for(role: str) -> list[str]:
    return sorted(capability for capability, roles in CAPABILITIES.items() if role in roles)


def role_has(role: str, capability: str) -> bool:
    """Deny by default: an unknown role or capability has no access."""
    return role in CAPABILITIES.get(capability, frozenset())
