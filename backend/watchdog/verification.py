"""Deterministic cited-evidence verification (SKILL-architecture.md Section 6):
"After each round, for every cited evidence row: look it up directly in the raw
logs table." No LLM call for this - it's a Postgres lookup, full stop.
"""

import uuid

from backend.agents.schemas import CitedEvidence
from backend.db.models import RawLog
from backend.db.session import SessionLocal

# Fields an agent might legitimately cite that live on the row itself rather
# than inside raw_fields (e.g. endpoint_behavior's prompt includes user_id
# alongside raw_fields - see backend/agents/endpoint_behavior.py).
_TOP_LEVEL_FIELDS = {"user_id", "host_id", "event_type", "source"}


def verify_cited_evidence(cited_evidence: list[CitedEvidence]) -> float:
    """Returns verification_match_rate: fraction of cited_evidence entries whose
    row_id exists in raw_logs AND whose field/value genuinely matches that row.
    A malformed row_id (not a UUID) or a mismatched value both count as failures.
    """
    if not cited_evidence:
        return 0.0

    session = SessionLocal()
    try:
        matches = 0
        for entry in cited_evidence:
            try:
                row_uuid = uuid.UUID(entry.row_id)
            except ValueError:
                continue

            row = session.get(RawLog, row_uuid)
            if row is None:
                continue

            actual = getattr(row, entry.field) if entry.field in _TOP_LEVEL_FIELDS else row.raw_fields.get(entry.field)
            if actual is not None and str(entry.value) == str(actual):
                matches += 1

        return matches / len(cited_evidence)
    finally:
        session.close()
