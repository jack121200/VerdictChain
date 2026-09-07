"""Turns a set of raw_logs rows into one Investigation for the agents/debate
engine to run against. No skill file assigns this a home explicitly (the
architecture doc's "Trigger Layer" sits between ingestion and the agents but
isn't owned by any listed module) - placed here since it's still pure data
assembly, before any agent reasoning happens.

Deliberately minimal: continuous-mode auto-windowing (a background worker
deciding when a live window is "full" and should become an investigation) is
real-time orchestration, not agent logic - that belongs with the FastAPI/worker
layer (Module 7), not here. create_investigation() takes an explicit row_id
list; whatever assembles that list (manual selection today, a streaming
consumer later) is a separate concern.
"""

import uuid

from sqlalchemy import select

from backend.db.models import Investigation, RawLog
from backend.db.session import SessionLocal
from backend.pipeline.log_streamer import get_rows_for_scenario


def create_investigation(
    row_ids: list[uuid.UUID],
    trigger_type: str,
    trigger_reason: str | None = None,
    scenario_label: str | None = None,
) -> tuple[Investigation, list[RawLog]]:
    """Persists a new Investigation and returns it with its rows (timestamp-ordered).
    scenario_label is stored as hidden ground truth on the Investigation row only
    (SKILL-data-schema.md Section 6) - callers must never forward it into an
    agent's prompt; agents receive `rows` from this function's return value, never
    the Investigation object itself, so there's no code path for that leak.
    """
    if not row_ids:
        raise ValueError("create_investigation() requires at least one row_id")

    session = SessionLocal()
    try:
        investigation = Investigation(
            trigger_type=trigger_type,
            trigger_reason=trigger_reason,
            scenario_label=scenario_label,
        )
        session.add(investigation)
        session.flush()

        rows = (
            session.execute(select(RawLog).where(RawLog.row_id.in_(row_ids)).order_by(RawLog.timestamp))
            .scalars()
            .all()
        )
        session.commit()
        session.refresh(investigation)
        for row in rows:
            session.refresh(row)
        return investigation, rows
    finally:
        session.close()


def create_manual_investigation(scenario_label: str) -> tuple[Investigation, list[RawLog]]:
    """Manual-mode entry point: groups every ingested row tagged with
    scenario_label into one investigation, per the hybrid trigger model
    (SKILL-architecture.md Section 4).
    """
    rows = get_rows_for_scenario(scenario_label)
    if not rows:
        raise ValueError(f"no raw_logs rows found for scenario_label={scenario_label!r}")

    return create_investigation(
        row_ids=[row.row_id for row in rows],
        trigger_type="manual",
        trigger_reason=f"simulate scenario: {scenario_label}",
        scenario_label=scenario_label,
    )
