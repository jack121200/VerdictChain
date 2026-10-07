"""Debate-round input assembly, peripheral digest, and near-duplicate detection
(SKILL-architecture.md Sections 3 and 5).

Design decision (2026-09-07 session, undocumented in the skill files - flagged
here for review): an investigation as currently built (investigation_builder.py)
only ever has ONE agent's domain populated - a manual scenario is either a
network attack type OR a CERT insider scenario, never both, and there's no
column tying a network row to a CERT row. A real 3-agent debate needs the other
two agents to have SOMETHING real and citable, so they're given a small recent
sample from their OWN domain (not scenario-matched) rather than sitting out.
Peripheral awareness is therefore structural-only (row counts/event types) - not
a bug, a hard limit of these two datasets not sharing a real timeline (CICIDS2017
is July 2017; CERT r4.2 is 2010-2011). True content-level cross-domain
correlation needs a scenario deliberately built to span both, which doesn't
exist yet.
"""

import difflib

from sqlalchemy import select

from backend.db.models import RawLog
from backend.db.session import SessionLocal

DOMAIN_SOURCES = {
    "network_traffic": ["cicids2017"],
    "access_log": ["cert_r4.2_file"],
    "endpoint_behavior": ["cert_r4.2_logon", "cert_r4.2_device"],
}

EVENT_TYPE_TO_AGENT = {
    "network_flow": "network_traffic",
    "file_access": "access_log",
    "logon": "endpoint_behavior",
    "device_event": "endpoint_behavior",
}


def primary_agent_for_rows(rows: list[RawLog]) -> str:
    event_types = {r.event_type for r in rows}
    agents = {EVENT_TYPE_TO_AGENT[et] for et in event_types if et in EVENT_TYPE_TO_AGENT}
    if len(agents) != 1:
        raise ValueError(f"rows must belong to exactly one agent's domain, got {agents}")
    return next(iter(agents))


# Ties on row count go to the earliest agent in this order (plan section 3.3).
_TIE_BREAK_ORDER = ("network_traffic", "access_log", "endpoint_behavior")


def dominant_agent_for_rows(rows: list[RawLog]) -> tuple[str, list[RawLog]]:
    """Returns (agent_id, rows_of_that_domain) for the agent with the most mapped rows.
    Rows with an unmapped event_type are ignored. No mapped rows raises ValueError.
    """
    by_agent: dict[str, list[RawLog]] = {agent: [] for agent in _TIE_BREAK_ORDER}
    for row in rows:
        agent = EVENT_TYPE_TO_AGENT.get(row.event_type)
        if agent is not None:
            by_agent[agent].append(row)
    if not any(by_agent.values()):
        raise ValueError("no rows map to an investigator agent's domain")
    # max() returns the first maximal item in iteration order, which is the tie-break.
    winner = max(_TIE_BREAK_ORDER, key=lambda agent: len(by_agent[agent]))
    return winner, by_agent[winner]


def _contextual_sample(agent_id: str, limit: int) -> list[RawLog]:
    session = SessionLocal()
    try:
        rows = (
            session.execute(
                select(RawLog)
                .where(RawLog.source.in_(DOMAIN_SOURCES[agent_id]))
                .order_by(RawLog.timestamp.desc())
                .limit(limit)
            )
            .scalars()
            .all()
        )
        for row in rows:
            session.refresh(row)
        return rows
    finally:
        session.close()


def assemble_debate_inputs(
    primary_agent_id: str, primary_rows: list[RawLog], max_rows: int = 5
) -> dict[str, list[RawLog]]:
    """primary agent gets the real scenario-matched rows; the other two get a
    real recent sample from their own domain so they have something to cite.
    """
    inputs = {primary_agent_id: primary_rows[:max_rows]}
    for agent_id in DOMAIN_SOURCES:
        if agent_id != primary_agent_id:
            inputs[agent_id] = _contextual_sample(agent_id, limit=max_rows)
    return inputs


def build_peripheral_digest(rows_by_agent: dict[str, list[RawLog]], exclude_agent: str) -> dict:
    """Deterministic structural summary only - row counts and event_type, never
    ground_truth_label. See module docstring for why it can't be richer yet.
    """
    return {
        agent_id: {"row_count": len(rows), "event_types": sorted({r.event_type for r in rows})}
        for agent_id, rows in rows_by_agent.items()
        if agent_id != exclude_agent
    }


def is_near_duplicate(a: str, b: str, threshold: float = 0.9) -> bool:
    """SKILL-architecture.md Section 3: 'the code must reject a Round 2 message
    that is a near-duplicate of the same agent's Round 1 message'."""
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() >= threshold
