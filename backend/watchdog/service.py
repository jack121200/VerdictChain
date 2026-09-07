"""Watchdog's per-round entry point: ties verification + credibility scoring +
Postgres audit logging together (SKILL-architecture.md Section 6). This is what
backend/debate/engine.py calls after persisting each round's transcript.
"""

import uuid

from backend.agents.schemas import AgentResponse
from backend.db.models import CredibilityLog
from backend.db.session import SessionLocal
from backend.watchdog.credibility import update_crs
from backend.watchdog.verification import verify_cited_evidence


def score_agent_round(investigation_id: uuid.UUID, round_no: int, response: AgentResponse) -> dict:
    match_rate = verify_cited_evidence(response.cited_evidence)
    crs_before, crs_after, isolated = update_crs(response.agent_id, match_rate)

    session = SessionLocal()
    try:
        session.add(
            CredibilityLog(
                investigation_id=investigation_id,
                agent_id=response.agent_id,
                round=round_no,
                crs_before=crs_before,
                crs_after=crs_after,
                verification_match_rate=match_rate,
                isolated=isolated,
            )
        )
        session.commit()
    finally:
        session.close()

    return {
        "agent_id": response.agent_id,
        "crs_before": crs_before,
        "crs_after": crs_after,
        "verification_match_rate": match_rate,
        "isolated": isolated,
    }
