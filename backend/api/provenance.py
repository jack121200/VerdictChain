"""Where an investigation's answers came from: the real providers, the offline stub, or both (checklist CT10).

The offline stub (the test harness in backend/scripts, also used by seed_demo) labels every answer it serves
`stub-openai`, and the debate engine stores that label per transcript row
(debate_transcripts.provider). An investigation is `stub` when every recorded provider is such a label,
`mixed` when some are, and `model` otherwise (including one with no transcript yet: nothing marks it as
stub). Evaluation accuracy is counted over `model` runs by default, so accuracy measured on the stub never
reads as accuracy of the system.
"""

import uuid
from collections.abc import Iterable
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db.models import DebateTranscript

STUB_PREFIX = "stub-"
DataSource = Literal["model", "stub", "mixed"]


def classify_source(total: int, stub: int) -> DataSource:
    if total > 0 and stub == total:
        return "stub"
    return "mixed" if stub > 0 else "model"


def source_of(providers: Iterable[str | None]) -> DataSource:
    names = [name for name in providers if name]
    return classify_source(len(names), sum(1 for name in names if name.startswith(STUB_PREFIX)))


def data_source_by_investigation(
    session: Session, investigation_ids: list[uuid.UUID]
) -> dict[uuid.UUID, DataSource]:
    """One grouped query for a page of investigations. An id with no transcript yet is not in the result."""
    if not investigation_ids:
        return {}
    rows = session.execute(
        select(
            DebateTranscript.investigation_id,
            func.count(),
            func.count().filter(DebateTranscript.provider.startswith(STUB_PREFIX, autoescape=True)),
        )
        .where(DebateTranscript.investigation_id.in_(investigation_ids))
        .group_by(DebateTranscript.investigation_id)
    ).all()
    return {investigation_id: classify_source(total, stub) for investigation_id, total, stub in rows}
