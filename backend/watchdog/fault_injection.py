"""Dry-run fault injection (plan sections 2.8 and 3.5): shows how the real Watchdog would score one poisoned
citation, and how the agent's CrS would move over the next rounds. Nothing is written except the audit
entry, which the route appends. No Redis CrS, no credibility_log row and no investigation are touched.
"""

import uuid
from typing import Literal

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents.schemas import CitedEvidence
from backend.db.models import RawLog
from backend.debate.state import DOMAIN_SOURCES
from backend.watchdog.credibility import compute_crs
from backend.watchdog.verification import CitationCheck

FaultKind = Literal["ghost_row", "value_mismatch", "malformed_row_id"]

# Every poisoned citation cites a top-level field and a value that no real row carries.
FAULT_FIELD = "event_type"
FAULT_VALUE = "fault-injected-value"


class NoDomainRows(LookupError):
    """The agent's domain has no raw rows to build a value mismatch from."""


def build_poisoned_citation(kind: FaultKind, agent_id: str, session: Session) -> CitedEvidence:
    if kind == "ghost_row":
        return CitedEvidence(row_id=str(uuid.uuid4()), field=FAULT_FIELD, value=FAULT_VALUE)
    if kind == "malformed_row_id":
        return CitedEvidence(row_id="not-a-uuid", field=FAULT_FIELD, value=FAULT_VALUE)
    if kind == "value_mismatch":
        row = (
            session.execute(
                select(RawLog)
                .where(RawLog.source.in_(DOMAIN_SOURCES[agent_id]))
                .order_by(RawLog.timestamp.desc())
                .limit(1)
            )
            .scalars()
            .first()
        )
        if row is None:
            raise NoDomainRows(agent_id)
        return CitedEvidence(row_id=str(row.row_id), field=FAULT_FIELD, value=FAULT_VALUE)
    raise ValueError(f"unknown fault kind {kind!r}")


def match_rate_of(check: CitationCheck) -> float:
    """One citation: 1.0 if it verifies, else 0.0."""
    return 1.0 if check.status == "VERIFIED" else 0.0


def citation_view(check: CitationCheck) -> dict:
    return {
        "row_id": check.row_id,
        "field": check.field,
        "value": check.value,
        "expected": check.expected,
        "status": check.status,
        "reason": check.reason,
    }


def project_trajectory(
    start_crs: float, match_rate: float, rounds: int, eta: float, isolation_threshold: float
) -> tuple[list[dict], int | None]:
    """Applies the real compute_crs for `rounds` rounds from start_crs, with the same match rate each
    round. Returns the projected points and the first round below the isolation threshold (None if never).
    """
    points: list[dict] = []
    crs = start_crs
    would_isolate_at: int | None = None
    for round_no in range(1, rounds + 1):
        after = compute_crs(crs, match_rate, eta)
        isolated = after < isolation_threshold
        points.append(
            {
                "round": round_no,
                "projected_crs_before": crs,
                "projected_crs_after": after,
                "projected_isolated": isolated,
            }
        )
        if isolated and would_isolate_at is None:
            would_isolate_at = round_no
        crs = after
    return points, would_isolate_at
