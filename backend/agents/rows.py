"""What an investigator is allowed to see of a raw_logs row (checklist LG11).

An investigator is handed AgentRow objects, never RawLog ORM rows. A RawLog carries ground_truth_label, the
hidden answer the evaluation is scored against, so any code holding one could read it. An AgentRow has no such
attribute: the blind test (CLAUDE.md rule 6) then holds by construction, not only because no agent happens to
read the field. The AST scan and the seeded-secret test in tests/agents/test_blind_boundary.py stay as well.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from backend.db.models import RawLog


@dataclass(frozen=True, slots=True)
class AgentRow:
    row_id: uuid.UUID
    timestamp: datetime
    source: str
    source_file: str | None
    event_type: str
    user_id: str | None
    host_id: str | None
    severity: str | None
    raw_fields: dict[str, Any]


def project(row: RawLog) -> AgentRow:
    """The label-free view of a raw row. raw_fields is copied, so an agent cannot change the stored row."""
    return AgentRow(
        row_id=row.row_id,
        timestamp=row.timestamp,
        source=row.source,
        source_file=row.source_file,
        event_type=row.event_type,
        user_id=row.user_id,
        host_id=row.host_id,
        severity=row.severity,
        raw_fields=dict(row.raw_fields or {}),
    )
