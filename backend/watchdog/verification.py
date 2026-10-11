"""Deterministic cited-evidence verification (SKILL-architecture.md Section 6):
"After each round, for every cited evidence row: look it up directly in the raw
logs table." No LLM call for this - it's a Postgres lookup, full stop.

A citation verifies when the cited text equals the stored value the way the investigators were shown it
(their prompts carry the rows as JSON, so a stored True is the text "true", a stored 0.3 is "0.3"), or
equals it as Python prints it ("True"), or is the same number written another way ("0.30" for 0.3). Nothing
else is forgiven: a different value, a different field or a field that does not exist is a discrepancy.
"""

import hashlib
import json
import math
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import timezone
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents.schemas import CitedEvidence
from backend.db.models import RawLog
from backend.db.session import SessionLocal

CitationStatus = Literal["VERIFIED", "DISCREPANCY", "INVALID_ROW"]
CitationReason = Literal["ok", "row_not_found", "malformed_row_id", "field_not_found", "value_mismatch"]

# Fields an agent might legitimately cite that live on the row itself rather
# than inside raw_fields (e.g. endpoint_behavior's prompt includes user_id
# alongside raw_fields - see backend/agents/endpoint_behavior.py).
_TOP_LEVEL_FIELDS = {"user_id", "host_id", "event_type", "source"}


@dataclass(frozen=True)
class CitationCheck:
    """One cited entry checked against raw_logs. expected is the stored value as the agents were shown it
    (shown_value), or None when the row or the field does not exist."""

    row_id: str
    field: str
    value: str
    expected: str | None
    status: CitationStatus
    reason: CitationReason
    row_fingerprint: str | None


def canonical_row(row: RawLog) -> dict[str, Any]:
    """The allow-listed fields of a raw row, in the form that is hashed. Timestamps are UTC."""
    return {
        "row_id": str(row.row_id),
        "timestamp": row.timestamp.astimezone(timezone.utc).isoformat(),
        "source": row.source,
        "source_file": row.source_file,
        "event_type": row.event_type,
        "user_id": row.user_id,
        "host_id": row.host_id,
        "severity": row.severity,
        "raw_fields": row.raw_fields,
    }


def row_fingerprint(row: RawLog) -> str:
    """SHA-256 of the canonical raw row: sorted keys, compact separators, no NaN."""
    payload = json.dumps(canonical_row(row), sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def shown_value(stored: Any) -> str:
    """A stored value as the investigators read it: strings as they are, everything else as JSON text
    (true, 80, 0.3), because the prompt carries the rows as JSON."""
    return stored if isinstance(stored, str) else json.dumps(stored, default=str)


def _same_number(cited: str, stored: Any) -> bool:
    if isinstance(stored, bool) or not isinstance(stored, int | float):
        return False
    try:
        number = float(cited.strip())
    except ValueError:
        return False
    return math.isfinite(number) and math.isclose(number, float(stored), rel_tol=1e-9, abs_tol=1e-12)


def value_matches(cited: str, stored: Any) -> bool:
    """Whether a cited value is the stored value (see the module docstring for the three accepted forms)."""
    text = str(cited)
    return text == shown_value(stored) or text == str(stored) or _same_number(text, stored)


def _lookup(row: RawLog, field: str) -> tuple[bool, Any]:
    """Returns (field_exists, stored_value)."""
    if field in _TOP_LEVEL_FIELDS:
        return True, getattr(row, field)
    raw = row.raw_fields or {}
    if field in raw:
        return True, raw[field]
    return False, None


def check_citations(session: Session, entries: Sequence[CitedEvidence]) -> list[CitationCheck]:
    """Checks every entry against raw_logs with one IN-query. Results keep the input order."""
    parsed: dict[int, uuid.UUID] = {}
    for index, entry in enumerate(entries):
        try:
            parsed[index] = uuid.UUID(entry.row_id)
        except ValueError:
            continue

    rows: dict[uuid.UUID, RawLog] = {}
    if parsed:
        found = session.execute(select(RawLog).where(RawLog.row_id.in_(set(parsed.values())))).scalars()
        rows = {row.row_id: row for row in found}

    checks: list[CitationCheck] = []
    for index, entry in enumerate(entries):
        base = {"row_id": entry.row_id, "field": entry.field, "value": entry.value}
        if index not in parsed:
            checks.append(
                CitationCheck(
                    **base,
                    expected=None,
                    status="INVALID_ROW",
                    reason="malformed_row_id",
                    row_fingerprint=None,
                )
            )
            continue

        row = rows.get(parsed[index])
        if row is None:
            checks.append(
                CitationCheck(
                    **base, expected=None, status="INVALID_ROW", reason="row_not_found", row_fingerprint=None
                )
            )
            continue

        fingerprint = row_fingerprint(row)
        exists, actual = _lookup(row, entry.field)
        if not exists:
            checks.append(
                CitationCheck(
                    **base,
                    expected=None,
                    status="DISCREPANCY",
                    reason="field_not_found",
                    row_fingerprint=fingerprint,
                )
            )
        elif actual is None:
            checks.append(
                CitationCheck(
                    **base,
                    expected=None,
                    status="DISCREPANCY",
                    reason="value_mismatch",
                    row_fingerprint=fingerprint,
                )
            )
        elif value_matches(entry.value, actual):
            checks.append(
                CitationCheck(
                    **base,
                    expected=shown_value(actual),
                    status="VERIFIED",
                    reason="ok",
                    row_fingerprint=fingerprint,
                )
            )
        else:
            checks.append(
                CitationCheck(
                    **base,
                    expected=shown_value(actual),
                    status="DISCREPANCY",
                    reason="value_mismatch",
                    row_fingerprint=fingerprint,
                )
            )
    return checks


def check_citation(session: Session, entry: CitedEvidence) -> CitationCheck:
    return check_citations(session, [entry])[0]


def verify_cited_evidence(cited_evidence: list[CitedEvidence]) -> float:
    """Returns verification_match_rate: fraction of cited_evidence entries that check as VERIFIED.
    A malformed row_id, a missing row, a missing field or a mismatched value all count as failures.
    """
    if not cited_evidence:
        return 0.0

    session = SessionLocal()
    try:
        checks = check_citations(session, cited_evidence)
        return sum(1 for check in checks if check.status == "VERIFIED") / len(cited_evidence)
    finally:
        session.close()
