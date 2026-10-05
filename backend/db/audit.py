"""Hash-chain helpers for the append-only audit_trail table (SKILL-security.md Section 5).

One global chain across all of audit_trail, ordered by seq (an identity assigned at INSERT).
created_at is not the chain order: it is the transaction start time, so it ties within a
transaction.
"""

import hashlib
import json
import math
import uuid
from collections.abc import Sequence
from typing import Any, Protocol

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from backend.db.models import AuditTrail

# Every action name the frontend knows (plan section 3.2). Writes outside this set are rejected.
AUDIT_ACTIONS: frozenset[str] = frozenset(
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
        # The self-healing actions (SKILL-security.md Section 4).
        "lock_account",
        "block_ip_range",
        "trigger_rate_limiting",
        "trigger_audit",
    }
)
RELEASE_PREFIX = "release:"  # one `release:<action>` per sandbox inverse (plan section 3.5)

# Transaction-scoped advisory lock: one audit writer at a time, released at COMMIT or ROLLBACK.
AUDIT_LOCK_KEY = int.from_bytes(b"vc_audit", "big")


def is_known_action(action: str) -> bool:
    if action in AUDIT_ACTIONS:
        return True
    return action.startswith(RELEASE_PREFIX) and len(action) > len(RELEASE_PREFIX)


def _canonical_value(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("audit detail cannot contain NaN or infinity")
        return round(value, 6)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, dict):
        return {str(key): _canonical_value(item) for key, item in value.items()}
    if isinstance(value, list | tuple):
        return [_canonical_value(item) for item in value]
    return value


def canonical_detail(detail: dict[str, Any] | None) -> dict[str, Any] | None:
    """The form that is stored and hashed: floats rounded to 6 places, UUIDs as strings."""
    return _canonical_value(detail)


def hash_input(actor: str, action: str, detail: dict[str, Any] | None, prev_hash: str | None) -> str:
    """The exact pre-image that is SHA-256 hashed. The API returns it so a browser can recompute the hash."""
    canonical = json.dumps(canonical_detail(detail) or {}, sort_keys=True, default=str)
    return f"{actor}|{action}|{canonical}|{prev_hash or ''}"


def compute_entry_hash(actor: str, action: str, detail: dict[str, Any] | None, prev_hash: str | None) -> str:
    return hashlib.sha256(hash_input(actor, action, detail, prev_hash).encode("utf-8")).hexdigest()


def append_entry(
    session: Session,
    actor: str,
    action: str,
    detail: dict[str, Any] | None = None,
    investigation_id: uuid.UUID | None = None,
) -> AuditTrail:
    """Appends one entry to the global hash chain within the caller's transaction (the caller commits).

    The advisory lock stops two writers from reading the same tail. The flush makes entries this
    session has added but not yet flushed visible to the tail read.
    """
    if not is_known_action(action):
        raise ValueError(f"unknown audit action {action!r}")
    session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": AUDIT_LOCK_KEY})
    session.flush()
    prev_hash = session.execute(
        select(AuditTrail.entry_hash).order_by(AuditTrail.seq.desc()).limit(1)
    ).scalar_one_or_none()

    canonical = canonical_detail(detail)
    entry = AuditTrail(
        investigation_id=investigation_id,
        actor=actor,
        action=action,
        detail=canonical,
        prev_hash=prev_hash,
        entry_hash=compute_entry_hash(actor, action, canonical, prev_hash),
    )
    session.add(entry)
    return entry


class _ChainEntry(Protocol):
    actor: str
    action: str
    detail: dict[str, Any] | None
    prev_hash: str | None
    entry_hash: str


def find_first_break(entries: Sequence[_ChainEntry]) -> tuple[int, str] | None:
    """entries must be ordered by seq, oldest first. Returns (index, reason) for the first entry that
    breaks the chain, or None if every entry verifies.

    reason is "prev_hash_mismatch" when the entry does not link to its predecessor, and "hash_mismatch"
    when its content does not hash to its own entry_hash.
    """
    prev_hash: str | None = None
    for index, entry in enumerate(entries):
        if entry.prev_hash != prev_hash:
            return index, "prev_hash_mismatch"
        if compute_entry_hash(entry.actor, entry.action, entry.detail, prev_hash) != entry.entry_hash:
            return index, "hash_mismatch"
        prev_hash = entry.entry_hash
    return None


def verify_chain(entries: list[_ChainEntry]) -> bool:
    """entries must be ordered oldest-first (by seq). Returns False on any break or tamper."""
    return find_first_break(entries) is None
