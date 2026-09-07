"""Hash-chain helpers for the append-only audit_trail table (SKILL-security.md Section 5).

Chain scope: a single global chain across all of audit_trail, ordered by created_at.
The skill file doesn't scope the chain per-investigation, so this is the simplest
reading of "the log" being tamper-evident as one sequence.
"""

import hashlib
import json
import uuid
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.models import AuditTrail


def _canonical(detail: dict[str, Any] | None) -> str:
    return json.dumps(detail or {}, sort_keys=True, default=str)


def compute_entry_hash(actor: str, action: str, detail: dict[str, Any] | None, prev_hash: str | None) -> str:
    payload = f"{actor}|{action}|{_canonical(detail)}|{prev_hash or ''}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def append_entry(
    session: Session,
    actor: str,
    action: str,
    detail: dict[str, Any] | None = None,
    investigation_id: uuid.UUID | None = None,
) -> AuditTrail:
    """Appends one entry to the global hash chain within an existing session/
    transaction (caller commits). Looks up the current chain tail itself so
    every caller doesn't have to track prev_hash by hand.
    """
    tail = session.execute(
        select(AuditTrail).order_by(AuditTrail.created_at.desc()).limit(1)
    ).scalar_one_or_none()
    prev_hash = tail.entry_hash if tail else None

    entry = AuditTrail(
        investigation_id=investigation_id,
        actor=actor,
        action=action,
        detail=detail,
        prev_hash=prev_hash,
        entry_hash=compute_entry_hash(actor, action, detail, prev_hash),
    )
    session.add(entry)
    return entry


class _ChainEntry(Protocol):
    actor: str
    action: str
    detail: dict[str, Any] | None
    prev_hash: str | None
    entry_hash: str


def verify_chain(entries: list[_ChainEntry]) -> bool:
    """entries must be ordered oldest-first. Returns False on any break or tamper."""
    prev_hash: str | None = None
    for entry in entries:
        expected = compute_entry_hash(entry.actor, entry.action, entry.detail, prev_hash)
        if expected != entry.entry_hash or entry.prev_hash != prev_hash:
            return False
        prev_hash = entry.entry_hash
    return True
