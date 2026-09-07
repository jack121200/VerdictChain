"""3-round debate orchestration (SKILL-architecture.md Section 3): Round 1
states theories, Round 2 challenges/supports/revises (rejecting near-duplicates
of Round 1 via one retry), Round 3 finalizes, then aggregate_verdict() combines
the 3 agents' final positions - not another LLM call.

See backend/debate/state.py's docstring for why non-primary agents reason over
a contextual sample from their own domain rather than sitting out, and why
peripheral awareness is structural-only for now.
"""

from typing import Callable
from uuid import UUID

from backend.agents import access_log, endpoint_behavior, network_traffic
from backend.agents.schemas import AgentResponse
from backend.db.models import DebateTranscript, Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate.state import assemble_debate_inputs, build_peripheral_digest, is_near_duplicate
from backend.debate.verdict import aggregate_verdict
from backend.self_healing.actions import respond_to_verdict
from backend.watchdog.credibility import get_crs, reset_agent
from backend.watchdog.service import score_agent_round

InvestigatorFn = Callable[..., tuple[AgentResponse, str]]

INVESTIGATORS: dict[str, InvestigatorFn] = {
    "network_traffic": network_traffic.investigate,
    "access_log": access_log.investigate,
    "endpoint_behavior": endpoint_behavior.investigate,
}


def _persist_round(investigation_id: UUID, round_no: int, agent_id: str, response: AgentResponse) -> None:
    session = SessionLocal()
    try:
        session.add(
            DebateTranscript(
                investigation_id=investigation_id,
                round=round_no,
                agent_id=agent_id,
                theory=response.theory,
                confidence=response.confidence,
                cited_evidence=[e.model_dump() for e in response.cited_evidence],
            )
        )
        session.commit()
    finally:
        session.close()


def _debate_context_for(agent_id: str, latest_by_agent: dict[str, AgentResponse]) -> str:
    parts = [
        f"{other_id}: theory={resp.theory!r} confidence={resp.confidence}"
        for other_id, resp in latest_by_agent.items()
        if other_id != agent_id
    ]
    return "\n".join(parts) if parts else "(no other agent responses yet)"


def run_debate(
    primary_agent_id: str,
    primary_rows: list[RawLog],
    investigators: dict[str, InvestigatorFn] = INVESTIGATORS,
    max_rows_per_agent: int = 5,
    trigger_reason: str | None = None,
) -> dict:
    """Creates a new Investigation, runs all 3 rounds for all 3 agents, persists
    the full transcript, and updates the Investigation with the final verdict.
    Returns {investigation_id, verdict, providers_used}.
    """
    inputs = assemble_debate_inputs(primary_agent_id, primary_rows, max_rows=max_rows_per_agent)

    session = SessionLocal()
    try:
        investigation = Investigation(
            trigger_type="manual",
            trigger_reason=trigger_reason or f"debate for {primary_agent_id}",
        )
        session.add(investigation)
        session.commit()
        session.refresh(investigation)
        investigation_id = investigation.investigation_id
    finally:
        session.close()

    latest_by_agent: dict[str, AgentResponse] = {}
    providers_used: dict[str, list[str]] = {agent_id: [] for agent_id in inputs}

    for round_no in (1, 2, 3):
        round_responses: dict[str, AgentResponse] = {}
        for agent_id, rows in inputs.items():
            digest = build_peripheral_digest(inputs, exclude_agent=agent_id)
            debate_context = _debate_context_for(agent_id, latest_by_agent) if round_no > 1 else None

            response, provider = investigators[agent_id](
                rows, round_no=round_no, peripheral_digest=digest, debate_context=debate_context
            )

            if round_no > 1 and agent_id in latest_by_agent:
                if is_near_duplicate(response.theory, latest_by_agent[agent_id].theory):
                    nudged_context = (
                        (debate_context or "")
                        + "\n\nYour previous answer was rejected as too similar to your prior round. "
                        "You must meaningfully CHALLENGE, SUPPORT, or REVISE."
                    )
                    response, provider = investigators[agent_id](
                        rows, round_no=round_no, peripheral_digest=digest, debate_context=nudged_context
                    )

            _persist_round(investigation_id, round_no, agent_id, response)
            round_responses[agent_id] = response
            providers_used[agent_id].append(provider)

            # Watchdog scores every round (SKILL-architecture.md Section 6). If
            # this drops the agent below the isolation threshold, "activate a
            # backup instance" is represented as an immediate reset (fresh CrS,
            # isolation cleared) - see watchdog/credibility.py's docstring for
            # why - so the agent continues participating in subsequent rounds
            # under a reset trust score rather than sitting out entirely.
            score = score_agent_round(investigation_id, round_no, response)
            if score["isolated"]:
                # reset the identity score_agent_round actually scored
                # (response.agent_id), not the loop's domain key - they're
                # always equal for real agents (enforced by
                # base_agent.parse_and_validate), but this stays correct even
                # if that invariant is ever bypassed.
                reset_agent(response.agent_id)

        latest_by_agent = round_responses

    verdict = aggregate_verdict(list(latest_by_agent.values()))

    session = SessionLocal()
    try:
        inv = session.get(Investigation, investigation_id)
        inv.status = verdict["status"]
        inv.verdict_class = verdict["verdict_class"]
        inv.verdict_confidence = verdict["verdict_confidence"]
        session.commit()
    finally:
        session.close()

    # Self-Healing (SKILL-architecture.md Section 7): fires only if confidence
    # >= 0.80 AND every agent that actually contributed to the verdict has
    # CrS >= 0.30 - respond_to_verdict() enforces both, this just supplies
    # their current (post-debate) credibility scores.
    contributing_crs = {agent_id: get_crs(agent_id) for agent_id in verdict.get("contributing_agents", [])}
    actions_taken = respond_to_verdict(investigation_id, verdict, contributing_crs)

    return {
        "investigation_id": str(investigation_id),
        "verdict": verdict,
        "providers_used": providers_used,
        "actions_taken": actions_taken,
    }
