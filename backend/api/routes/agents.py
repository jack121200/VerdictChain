"""Agent Fleet view (SKILL-design-system.md's "Agent Fleet" page): current
credibility per investigator agent, read straight from Watchdog's Redis state.
"""

from fastapi import APIRouter, Depends

from backend.api.auth import get_current_user
from backend.api.schemas import AgentFleetEntryOut
from backend.watchdog.credibility import get_crs, is_isolated

router = APIRouter(prefix="/agents", tags=["agents"])

_AGENT_IDS = ("network_traffic", "access_log", "endpoint_behavior")


@router.get("/fleet", response_model=list[AgentFleetEntryOut])
def agent_fleet(username: str = Depends(get_current_user)) -> list[AgentFleetEntryOut]:
    return [
        AgentFleetEntryOut(
            agent_id=agent_id, credibility_score=get_crs(agent_id), isolated=is_isolated(agent_id)
        )
        for agent_id in _AGENT_IDS
    ]
