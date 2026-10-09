"""Audit-chain verification with a Redis checkpoint (SKILL-security.md Section 5, plan section 3.4).

A full walk recomputes every entry hash and every link, so its cost grows with the table. After a pass
succeeds, the head (seq, entry_hash) is remembered in Redis. The next default pass is incremental: it
re-checks the checkpoint entry (still there, still the remembered hash, still hashes to itself), then walks
only the entries added after it. The checkpoint moves only after a pass that found no break.

What an incremental pass does NOT do: re-walk entries older than the checkpoint. A change to one of those
rows that leaves the checkpoint entry intact is found only by a full pass (`full=True`). Every result states
the mode that actually ran and the seq it started from, so a caller can see which part of the chain it covers.
If no usable checkpoint exists (never verified, Redis empty or down) the pass is full, and says so.

A checkpoint that no longer matches the table is reported as a break (`checkpoint_mismatch`), not
silently repaired: the entry at that seq changed or is gone. After a deliberate wipe of audit_trail, run one
full pass, which re-anchors the checkpoint on success.
"""

import json
import logging
from dataclasses import dataclass
from typing import Literal

import redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.config import settings
from backend.db.audit import compute_entry_hash
from backend.db.models import AuditTrail

logger = logging.getLogger(__name__)

CHECKPOINT_KEY = "verdictchain:audit:verified"
BATCH_SIZE = 1000

Mode = Literal["incremental", "full"]

_client: redis.Redis | None = None


@dataclass(frozen=True)
class Checkpoint:
    seq: int
    entry_hash: str


@dataclass(frozen=True)
class ChainCheck:
    valid: bool
    mode: Mode
    verified_from_seq: int | None  # the seq this pass started from; None when the chain is empty
    entries_checked: int  # entries whose hash was recomputed in this pass (the checkpoint entry included)
    first_break_seq: int | None
    reason: str  # "ok", "prev_hash_mismatch", "hash_mismatch" or "checkpoint_mismatch"
    head_seq: int | None
    head_hash: str | None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.Redis.from_url(
            settings.redis_url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2
        )
    return _client


def load_checkpoint() -> Checkpoint | None:
    """The remembered checkpoint, or None when there is none or it cannot be read (the pass is then full)."""
    try:
        raw = _redis().get(CHECKPOINT_KEY)
        if raw is None:
            return None
        data = json.loads(raw)
        return Checkpoint(seq=int(data["seq"]), entry_hash=str(data["entry_hash"]))
    except Exception:  # noqa: BLE001 - an unreadable checkpoint only costs a full walk
        logger.warning("audit checkpoint unavailable; verifying the whole chain", exc_info=True)
        return None


def _save_checkpoint(checkpoint: Checkpoint) -> None:
    try:
        _redis().set(CHECKPOINT_KEY, json.dumps({"seq": checkpoint.seq, "entry_hash": checkpoint.entry_hash}))
    except Exception:  # noqa: BLE001 - a lost checkpoint only costs a longer next walk
        logger.warning("could not save the audit checkpoint", exc_info=True)


def _clear_checkpoint() -> None:
    try:
        _redis().delete(CHECKPOINT_KEY)
    except Exception:  # noqa: BLE001
        logger.warning("could not clear the audit checkpoint", exc_info=True)


def verify_audit_chain(session: Session, *, full: bool = False) -> ChainCheck:
    """Verifies the audit chain. `full=True` ignores the checkpoint and walks every entry."""
    checkpoint = None if full else load_checkpoint()
    mode: Mode = "full" if checkpoint is None else "incremental"
    query = select(
        AuditTrail.seq,
        AuditTrail.actor,
        AuditTrail.action,
        AuditTrail.detail,
        AuditTrail.prev_hash,
        AuditTrail.entry_hash,
    ).order_by(AuditTrail.seq)
    if checkpoint is not None:
        query = query.where(AuditTrail.seq >= checkpoint.seq)

    checked = 0
    first_seq: int | None = None
    last = None
    expected_prev = checkpoint.entry_hash if checkpoint is not None else None
    break_seq: int | None = None
    reason = "ok"

    result = session.execute(query.execution_options(yield_per=BATCH_SIZE))
    try:
        for row in result:
            # In incremental mode the first row is the checkpoint entry. Its predecessor is not loaded, so its
            # remembered hash stands in for the link check.
            at_checkpoint = checkpoint is not None and last is None
            if at_checkpoint and row.seq != checkpoint.seq:  # the remembered entry is gone
                break_seq, reason = checkpoint.seq, "checkpoint_mismatch"
                break
            checked += 1
            first_seq = row.seq if first_seq is None else first_seq
            if at_checkpoint and row.entry_hash != checkpoint.entry_hash:  # the remembered entry changed
                break_seq, reason = checkpoint.seq, "checkpoint_mismatch"
                break
            if not at_checkpoint and row.prev_hash != expected_prev:
                break_seq, reason = row.seq, "prev_hash_mismatch"
                break
            if compute_entry_hash(row.actor, row.action, row.detail, row.prev_hash) != row.entry_hash:
                break_seq, reason = row.seq, "hash_mismatch"
                break
            expected_prev = row.entry_hash
            last = row
    finally:
        result.close()
    if checkpoint is not None and checked == 0 and break_seq is None:  # no entry at or after the checkpoint
        break_seq, reason = checkpoint.seq, "checkpoint_mismatch"

    started_from = checkpoint.seq if checkpoint is not None else first_seq
    if break_seq is None:
        head = last
        if head is None:  # full pass over an empty table: nothing to anchor, and any old anchor is moot
            _clear_checkpoint()
        elif checkpoint is None or (head.seq, head.entry_hash) != (checkpoint.seq, checkpoint.entry_hash):
            _save_checkpoint(Checkpoint(head.seq, head.entry_hash))
        return ChainCheck(
            valid=True,
            mode=mode,
            verified_from_seq=started_from,
            entries_checked=checked,
            first_break_seq=None,
            reason="ok",
            head_seq=head.seq if head else None,
            head_hash=head.entry_hash if head else None,
        )

    head_row = session.execute(
        select(AuditTrail.seq, AuditTrail.entry_hash).order_by(AuditTrail.seq.desc()).limit(1)
    ).first()
    return ChainCheck(
        valid=False,
        mode=mode,
        verified_from_seq=started_from,
        entries_checked=checked,
        first_break_seq=break_seq,
        reason=reason,
        head_seq=head_row.seq if head_row else None,
        head_hash=head_row.entry_hash if head_row else None,
    )
