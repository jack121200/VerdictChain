"""Runtime settings: the single runtime_settings row (migration 0004, plan section 3.1).

load() is read by the debate engine and the API. save() validates and writes, but does not commit:
the caller commits in the same transaction as its audit entry, so a change and its audit row land
together (plan section 3.2).
"""

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.models import RuntimeSettings as RuntimeSettingsRow
from backend.db.session import SessionLocal

# The four editable fields, and their ranges. These match the table CHECK constraints.
SETTING_FIELDS: tuple[str, ...] = (
    "eta",
    "isolation_threshold",
    "verdict_confidence_threshold",
    "intake_paused",
)
VALUE_RANGES: dict[str, tuple[float, float]] = {
    "eta": (0.01, 0.5),
    "isolation_threshold": (0.05, 0.45),
    "verdict_confidence_threshold": (0.50, 0.99),
}


@dataclass(frozen=True)
class RuntimeSettings:
    eta: float
    isolation_threshold: float
    verdict_confidence_threshold: float
    intake_paused: bool
    updated_at: datetime | None = None
    updated_by: str | None = None

    def values(self) -> dict[str, Any]:
        """The editable fields only (no timestamps), as written to the audit detail."""
        return {name: getattr(self, name) for name in SETTING_FIELDS}


# Defaults match the migration's server defaults. load() returns them when the row is missing.
DEFAULTS = RuntimeSettings(
    eta=0.15,
    isolation_threshold=0.30,
    verdict_confidence_threshold=0.80,
    intake_paused=False,
)


def _from_row(row: RuntimeSettingsRow) -> RuntimeSettings:
    return RuntimeSettings(
        eta=row.eta,
        isolation_threshold=row.isolation_threshold,
        verdict_confidence_threshold=row.verdict_confidence_threshold,
        intake_paused=row.intake_paused,
        updated_at=row.updated_at,
        updated_by=row.updated_by,
    )


def _read(session: Session, *, lock: bool) -> RuntimeSettings:
    statement = select(RuntimeSettingsRow).where(RuntimeSettingsRow.id == 1)
    if lock:
        statement = statement.with_for_update()
    row = session.execute(statement).scalar_one_or_none()
    return DEFAULTS if row is None else _from_row(row)


def load(session: Session | None = None) -> RuntimeSettings:
    """Reads the single row. Returns DEFAULTS when the row is missing (the test DB is truncated)."""
    if session is not None:
        return _read(session, lock=False)
    with SessionLocal() as own:
        return _read(own, lock=False)


def load_for_update(session: Session) -> RuntimeSettings:
    """Like load(), but locks the row until the caller's transaction ends (used before a PUT)."""
    return _read(session, lock=True)


def save(session: Session, values: dict[str, Any], updated_by: str) -> RuntimeSettings:
    """Validates the four settings and writes them. Flushes but does not commit: the caller commits.

    Raises ValueError for a missing or unknown field, a wrong type, or a value outside its range.
    """
    unknown = set(values) - set(SETTING_FIELDS)
    missing = set(SETTING_FIELDS) - set(values)
    if unknown or missing:
        raise ValueError(
            f"missing {sorted(missing)}, unknown {sorted(unknown)}; need exactly {list(SETTING_FIELDS)}"
        )
    for name, (low, high) in VALUE_RANGES.items():
        value = values[name]
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError(f"{name} must be a number")
        if not low <= value <= high:
            raise ValueError(f"{name} must be between {low} and {high}")
    if not isinstance(values["intake_paused"], bool):
        raise ValueError("intake_paused must be a boolean")

    row = session.execute(
        select(RuntimeSettingsRow).where(RuntimeSettingsRow.id == 1).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        row = RuntimeSettingsRow(id=1)
        session.add(row)
    for name in SETTING_FIELDS:
        setattr(row, name, values[name])
    row.updated_at = datetime.now(timezone.utc)
    row.updated_by = updated_by
    session.flush()
    return _from_row(row)
