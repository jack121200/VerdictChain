"""Debate-round input assembly, peripheral digest, and near-duplicate detection
(SKILL-architecture.md Sections 3 and 5).

A real 3-agent debate needs every agent to have something real and citable, so a
non-primary agent never sits out. What it is given, best first (recorded per agent
as its "input basis" in the audit trail):

  scenario_rows     rows of its own domain that the scenario itself carries (a CERT
                    insider scenario tags logon, file and device rows together)
  same_user_window  its domain's rows for the SAME user(s) the scenario names, inside
                    the scenario's time window (padded by WINDOW_PAD)
  time_window       its domain's rows inside that window, for other users
  recent_sample     the newest rows of its domain, unrelated to the scenario

The last tier is a hard limit, not a bug: CICIDS2017 is July 2017 and CERT r4.2 is
2010-2011, so a network scenario has no CERT rows in its window. Peripheral awareness
for such a debate is structural only (row counts and event types).
"""

import difflib
from datetime import timedelta
from typing import Literal

from sqlalchemy import select

from backend.agents.registry import DOMAIN_SOURCES, EVENT_TYPE_TO_AGENT, INVESTIGATOR_IDS
from backend.db.models import RawLog
from backend.db.session import SessionLocal

# How a non-primary agent's data slice was chosen, best first (module docstring).
InputBasis = Literal["scenario_rows", "same_user_window", "time_window", "recent_sample"]

# The window around a scenario's first and last row inside which other domains are searched.
WINDOW_PAD = timedelta(hours=24)


def primary_agent_for_rows(rows: list[RawLog]) -> str:
    event_types = {r.event_type for r in rows}
    agents = {EVENT_TYPE_TO_AGENT[et] for et in event_types if et in EVENT_TYPE_TO_AGENT}
    if len(agents) != 1:
        raise ValueError(f"rows must belong to exactly one agent's domain, got {agents}")
    return next(iter(agents))


def dominant_agent_for_rows(rows: list[RawLog]) -> tuple[str, list[RawLog]]:
    """Returns (agent_id, rows_of_that_domain) for the agent with the most mapped rows.
    Rows with an unmapped event_type are ignored. No mapped rows raises ValueError. Ties on row count go to
    the earliest agent of INVESTIGATOR_IDS (plan section 3.3).
    """
    by_agent: dict[str, list[RawLog]] = {agent: [] for agent in INVESTIGATOR_IDS}
    for row in rows:
        agent = EVENT_TYPE_TO_AGENT.get(row.event_type)
        if agent is not None:
            by_agent[agent].append(row)
    if not any(by_agent.values()):
        raise ValueError("no rows map to an investigator agent's domain")
    # max() returns the first maximal item in iteration order, which is the tie-break.
    winner = max(INVESTIGATOR_IDS, key=lambda agent: len(by_agent[agent]))
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


def _window_sample(agent_id: str, scenario_rows: list[RawLog], limit: int) -> tuple[list[RawLog], InputBasis]:
    """The agent's own-domain rows inside the scenario's time window, preferring the users the scenario
    names. Empty when the datasets do not overlap in time. Only timestamps and user ids of the scenario's
    rows are used, never a label."""
    stamps = [row.timestamp for row in scenario_rows if row.timestamp is not None]
    if not stamps:
        return [], "time_window"
    start, end = min(stamps) - WINDOW_PAD, max(stamps) + WINDOW_PAD
    users = sorted({row.user_id for row in scenario_rows if row.user_id})
    in_window = (
        select(RawLog)
        .where(
            RawLog.source.in_(DOMAIN_SOURCES[agent_id]), RawLog.timestamp >= start, RawLog.timestamp <= end
        )
        .order_by(RawLog.timestamp)
        .limit(limit)
    )
    attempts = []
    if users:
        attempts.append(("same_user_window", in_window.where(RawLog.user_id.in_(users))))
    attempts.append(("time_window", in_window))

    session = SessionLocal()
    try:
        for basis, query in attempts:
            rows = session.execute(query).scalars().all()
            if rows:
                for row in rows:
                    session.refresh(row)
                return rows, basis
        return [], "time_window"
    finally:
        session.close()


def assemble_debate_inputs(
    primary_agent_id: str,
    primary_rows: list[RawLog],
    max_rows: int = 5,
    scenario_rows: list[RawLog] | None = None,
) -> tuple[dict[str, list[RawLog]], dict[str, InputBasis]]:
    """Returns (rows per agent, how each agent's rows were chosen).

    The primary agent gets the scenario's rows of its domain. Every other agent gets the best it can have
    (module docstring): the scenario's own rows of its domain, else rows of the same users in the scenario's
    time window, else rows in that window, else the newest rows of its domain.
    scenario_rows is everything the scenario carries (all domains); it defaults to primary_rows.
    """
    context = scenario_rows if scenario_rows else primary_rows
    inputs = {primary_agent_id: primary_rows[:max_rows]}
    basis: dict[str, InputBasis] = {primary_agent_id: "scenario_rows"}
    for agent_id in DOMAIN_SOURCES:
        if agent_id == primary_agent_id:
            continue
        own = [row for row in context if EVENT_TYPE_TO_AGENT.get(row.event_type) == agent_id]
        if own:
            inputs[agent_id], basis[agent_id] = own[:max_rows], "scenario_rows"
            continue
        rows, chosen = _window_sample(agent_id, context, max_rows)
        if rows:
            inputs[agent_id], basis[agent_id] = rows, chosen
        else:
            inputs[agent_id], basis[agent_id] = _contextual_sample(agent_id, limit=max_rows), "recent_sample"
    return inputs, basis


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
