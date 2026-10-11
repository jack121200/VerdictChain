"""Scenario catalogue (plan section 3.4): the eight labels, their dataset, the domain their rows belong to
and the number of labelled rows.

Analyst-facing only. This read-only analytics endpoint and /evaluation are the only places that read
raw_logs.ground_truth_label. No investigator agent reads it (SKILL-architecture.md Section 4).
"""

from collections import Counter
from typing import get_args

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from backend.agents.registry import CERT, CICIDS, EVENT_TYPE_TO_AGENT, INVESTIGATOR_IDS
from backend.api.auth import get_current_user
from backend.api.metrics import make_metric
from backend.api.schemas.realtime import ScenarioLabel
from backend.api.schemas.stats import ScenarioOut
from backend.db.models import RawLog
from backend.db.session import SessionLocal

router = APIRouter(prefix="/scenarios", tags=["scenarios"])

# Label -> (dataset, description). The descriptions state what each dataset contains, not measured results.
SCENARIO_INFO: dict[str, tuple[str, str]] = {
    "DDoS": (CICIDS, "Denial-of-service flood rows from the CICIDS2017 network flows."),
    "Portscan": (CICIDS, "Port-scan rows from the CICIDS2017 network flows."),
    "FTP-Patator": (CICIDS, "FTP brute-force login rows from the CICIDS2017 network flows."),
    "SSH-Patator": (CICIDS, "SSH brute-force login rows from the CICIDS2017 network flows."),
    "Botnet": (CICIDS, "Botnet command-and-control rows from the CICIDS2017 network flows."),
    "insider_scenario_1": (CERT, "CERT r4.2 answer-key insider scenario 1 (logon, device and file events)."),
    "insider_scenario_2": (CERT, "CERT r4.2 answer-key insider scenario 2 (logon, device and file events)."),
    "insider_scenario_3": (CERT, "CERT r4.2 answer-key insider scenario 3 (logon, device and file events)."),
}


def dominant_agent(event_counts: Counter) -> str | None:
    """The agent that owns the most rows of a scenario. Ties go to the earliest agent of INVESTIGATOR_IDS.
    Returns None when no row maps to an agent.
    """
    per_agent: Counter = Counter()
    for event_type, count in event_counts.items():
        agent = EVENT_TYPE_TO_AGENT.get(event_type)
        if agent is not None:
            per_agent[agent] += count
    if not per_agent:
        return None
    best = max(per_agent.values())
    return next(agent for agent in INVESTIGATOR_IDS if per_agent.get(agent, 0) == best)


@router.get("", response_model=list[ScenarioOut])
def list_scenarios(username: str = Depends(get_current_user)) -> list[ScenarioOut]:
    labels = get_args(ScenarioLabel)
    session = SessionLocal()
    try:
        rows = session.execute(
            select(RawLog.ground_truth_label, RawLog.event_type, func.count())
            .where(RawLog.ground_truth_label.in_(labels))
            .group_by(RawLog.ground_truth_label, RawLog.event_type)
        ).all()
    finally:
        session.close()

    by_label: dict[str, Counter] = {label: Counter() for label in labels}
    for label, event_type, count in rows:
        by_label[label][event_type] += count

    out = []
    for label in labels:
        counts = by_label[label]
        total = sum(counts.values())
        dataset, description = SCENARIO_INFO[label]
        out.append(
            ScenarioOut(
                label=label,
                dataset=dataset,
                primary_agent=dominant_agent(counts),
                row_count=make_metric(
                    total,
                    total,
                    "/scenarios",
                    "rows in raw_logs with this ground_truth_label (analyst view only)",
                ),
                description=description,
            )
        )
    return out
