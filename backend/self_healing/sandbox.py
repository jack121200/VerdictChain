"""SANDBOX BOUNDARY (SKILL-security.md Section 4 - "the most important rule in
this file"). These functions perform ZERO networking of any kind - no socket,
httpx, requests, subprocess, or any I/O beyond in-memory mock state. There is
no code path, config flag, or environment variable that could make them reach
a real system; that would require writing an entirely new module, not
toggling something here. This file has no networking import at all - grep for
"socket", "httpx", "requests", "subprocess" and you will find nothing, which
is a stronger, simpler guarantee than a firewalled container would be (zero
network stack beats a firewalled one).

The "local Docker-sandboxed mock service" language in SKILL-security.md
Section 4 is satisfied here by the two in-process mock services below rather
than literal separate containers - a deliberate interpretation of that line's
"e.g.", flagged for review. A real containerized mock is a possible Module
7/8 follow-up for demo visual realism, not a change to the safety guarantee -
the guarantee is "no networking code exists here", which no amount of
containerization changes one way or the other.

response_actions.is_simulated is also hardcoded TRUE at the schema level
(Module 1's CHECK constraint, ck_response_actions_always_simulated) as a
second, independent safeguard - even a bug here couldn't produce a row that
claims to be a real action.
"""

from dataclasses import dataclass, field


@dataclass
class _MockDirectoryService:
    """In-memory simulated identity/directory service. Real state, zero network."""

    locked_accounts: set[str] = field(default_factory=set)

    def lock_account(self, user_id: str) -> str:
        self.locked_accounts.add(user_id)
        return f"account {user_id} locked in sandboxed directory service (simulated, no real system contacted)"


@dataclass
class _MockFirewall:
    """In-memory simulated firewall. Real state, zero network."""

    blocked_ranges: set[str] = field(default_factory=set)
    rate_limited_targets: set[str] = field(default_factory=set)

    def block_ip_range(self, ip_range: str) -> str:
        self.blocked_ranges.add(ip_range)
        return f"{ip_range} blocked in sandboxed firewall (simulated, no real system contacted)"

    def trigger_rate_limiting(self, target: str) -> str:
        self.rate_limited_targets.add(target)
        return f"rate limiting enabled for {target} in sandboxed firewall (simulated, no real system contacted)"


_directory_service = _MockDirectoryService()
_firewall = _MockFirewall()


def lock_account(user_id: str) -> str:
    return _directory_service.lock_account(user_id)


def block_ip_range(ip_range: str) -> str:
    return _firewall.block_ip_range(ip_range)


def trigger_rate_limiting(target: str) -> str:
    return _firewall.trigger_rate_limiting(target)


def trigger_audit(target: str) -> str:
    return f"audit triggered for {target} (simulated, no real audit system contacted)"
