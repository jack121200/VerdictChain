"""The debate as a LangGraph state graph (SKILL-architecture.md Sections 1 and 3).

    START -> route_round --Send x N--> investigate_agent (the agents run in parallel) -> close_round
                  ^                                                                         |
                  +---------------------------- next round -------------------------------+
    route_round -> aggregate -> respond -> END
                   (after the last round, or when fewer than two agents remain)

One superstep per round: route_round fans out one `investigate_agent` node per active investigator, LangGraph
runs them concurrently (config max_concurrency), and `close_round` joins them: it audits the round, emits
round_completed and drops the agents the Watchdog isolated, so the next round starts without them.

The graph holds the orchestration only. The work of each step (the model call, persistence, scoring,
isolation, the audit entries, the deterministic verdict, the sandboxed response) is in
backend/debate/engine.py and the Watchdog and Self-Healing modules, unchanged. Run-wide constants
(investigators, settings, the rows each agent reads, the event callback) travel in the run config, never in
the state, so the state stays plain data.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any, TypedDict

from langchain_core.runnables import RunnableConfig
from langgraph.graph import END, START, StateGraph
from langgraph.types import Send

from backend.agents.schemas import AgentResponse
from backend.config import settings as app_settings
from backend.db.models import RawLog
from backend.debate import engine, provider_stats
from backend.debate.failure import classify
from backend.debate.state import build_peripheral_digest
from backend.debate.verdict import aggregate_verdict
from backend.self_healing.actions import respond_to_verdict
from backend.watchdog.credibility import AUTONOMOUS_ACTION_MIN_CRS, get_crs
from backend.watchdog.service import score_agent_round


class RoundPhaseError(Exception):
    """A failure while the investigators were debating (a provider outage, a bad answer). run_debate turns
    it into DebateFailedError and marks the investigation `error`. A failure after the verdict is not wrapped.
    """

    def __init__(self, original: Exception) -> None:
        self.original = original
        super().__init__(str(original))


@dataclass(frozen=True)
class RunContext:
    """What stays the same for the whole run."""

    investigation_id: uuid.UUID
    primary_agent_id: str
    investigators: dict[str, engine.InvestigatorFn]
    settings: engine.EngineSettings
    inputs: dict[str, list[RawLog]]
    input_basis: dict[str, dict]
    on_update: Callable[[dict], None] | None = None

    def emit(self, event: dict) -> None:
        if self.on_update is not None:
            self.on_update({**event, "investigation_id": str(self.investigation_id)})


class AgentTurn(TypedDict):
    agent_id: str
    response: AgentResponse
    provider: str
    score: dict


class _Reset:
    """Update value that empties the per-round list of turns (see _collect)."""


RESET = _Reset()


def _collect(current: list[AgentTurn], update: list[AgentTurn] | _Reset) -> list[AgentTurn]:
    """Reducer for the turns the parallel agents return: each adds its own, close_round empties the list."""
    if isinstance(update, _Reset):
        return []
    return [*current, *update]


class DebateState(TypedDict):
    round_no: int  # the round about to run, 1-based
    active: list[str]  # the agents that take part in that round
    latest_by_agent: dict[str, AgentResponse]  # last round's answer of every agent still active
    providers_used: dict[str, list[str]]
    turns: Annotated[list[AgentTurn], _collect]
    verdict: dict | None
    status: str | None
    actions_taken: list[dict]


def _context(config: RunnableConfig) -> RunContext:
    return config["configurable"]["ctx"]


def route_round(state: DebateState) -> list[Send] | str:
    """Fan out one node per active agent for the next round, or go to the verdict."""
    if state["round_no"] > engine.DEBATE_ROUNDS or len(state["active"]) < engine.MIN_ACTIVE_AGENTS:
        return "aggregate"
    return [
        Send(
            "investigate_agent",
            {
                "agent_id": agent_id,
                "round_no": state["round_no"],
                "round_agents": list(state["active"]),
                "latest_by_agent": state["latest_by_agent"],
            },
        )
        for agent_id in state["active"]
    ]


def investigate_agent(task: dict[str, Any], config: RunnableConfig) -> dict:
    """One investigator, one round: the answer (with one retry if it repeats itself), its transcript row,
    the Watchdog's score and, if the score isolates it, the quarantine. Runs next to the other agents."""
    ctx = _context(config)
    agent_id: str = task["agent_id"]
    round_no: int = task["round_no"]
    latest: dict[str, AgentResponse] = task["latest_by_agent"]
    try:
        digest = build_peripheral_digest(
            {agent: ctx.inputs[agent] for agent in task["round_agents"]}, exclude_agent=agent_id
        )
        debate_context = engine._debate_context_for(agent_id, latest) if round_no > 1 else None
        response, provider = engine._respond(
            ctx.investigators,
            agent_id,
            ctx.inputs[agent_id],
            round_no,
            digest,
            debate_context,
            latest.get(agent_id),
        )
        engine._persist_round(ctx.investigation_id, round_no, agent_id, response, provider)
        score = score_agent_round(
            ctx.investigation_id,
            round_no,
            response,
            eta=ctx.settings.eta,
            isolation_threshold=ctx.settings.isolation_threshold,
        )
        if score["isolated"]:
            engine._isolate_agent(ctx.investigation_id, agent_id, round_no, score["crs_after"])
            ctx.emit(
                {
                    "type": "agent_isolated",
                    "agent_id": agent_id,
                    "round": round_no,
                    "crs_after": score["crs_after"],
                }
            )
    except Exception as exc:
        provider_stats.record_failure(classify(exc))
        raise RoundPhaseError(exc) from exc
    return {"turns": [{"agent_id": agent_id, "response": response, "provider": provider, "score": score}]}


def close_round(state: DebateState, config: RunnableConfig) -> dict:
    """Joins the agents of the round: audits it, announces it, removes the isolated agents."""
    ctx = _context(config)
    round_no = state["round_no"]
    round_agents = list(state["active"])
    by_agent = {turn["agent_id"]: turn for turn in state["turns"]}
    try:
        turns = [by_agent[agent_id] for agent_id in round_agents]  # in agent order, not in finishing order
        still_active = [turn["agent_id"] for turn in turns if not turn["score"]["isolated"]]
        engine._audit_round(
            ctx.investigation_id,
            round_no,
            {turn["agent_id"]: turn["provider"] for turn in turns},
            ctx.input_basis if round_no == 1 else None,
        )
        ctx.emit(
            {
                "type": "round_completed",
                "round": round_no,
                "agents": [
                    engine._round_entry(turn["agent_id"], turn["response"], turn["provider"], turn["score"])
                    for turn in turns
                ],
                **({"input_basis": ctx.input_basis} if round_no == 1 else {}),
            }
        )
    except Exception as exc:
        raise RoundPhaseError(exc) from exc
    providers_used = {agent: list(used) for agent, used in state["providers_used"].items()}
    for turn in turns:
        providers_used.setdefault(turn["agent_id"], []).append(turn["provider"])
    return {
        "round_no": round_no + 1,
        "active": still_active,
        "latest_by_agent": {agent_id: by_agent[agent_id]["response"] for agent_id in still_active},
        "providers_used": providers_used,
        "turns": RESET,
    }


def aggregate(state: DebateState, config: RunnableConfig) -> dict:
    """The deterministic verdict from the last positions of the agents still active (not an LLM call)."""
    ctx = _context(config)
    final = list(state["latest_by_agent"].values())
    verdict = (
        aggregate_verdict(final, primary_agent_id=ctx.primary_agent_id)
        if len(final) >= engine.MIN_ACTIVE_AGENTS
        else engine._insufficient_verdict(final)
    )
    engine._finalize_verdict(ctx.investigation_id, verdict)
    return {"verdict": verdict}


def respond(state: DebateState, config: RunnableConfig) -> dict:
    """Self-Healing (SKILL-architecture.md Section 7): the verdict threshold and the CrS gate decide; any
    action taken makes the investigation `contained`."""
    ctx = _context(config)
    verdict = state["verdict"]
    assert verdict is not None  # aggregate always runs first
    contributing_crs = {agent: get_crs(agent) for agent in verdict["contributing_agents"]}
    actions_taken = respond_to_verdict(
        ctx.investigation_id,
        verdict,
        contributing_crs,
        confidence_threshold=ctx.settings.verdict_confidence_threshold,
        credibility_threshold=AUTONOMOUS_ACTION_MIN_CRS,
    )
    status = verdict["status"]
    if actions_taken:
        status = "contained"
        engine._set_status(ctx.investigation_id, status)
    ctx.emit({"type": "verdict", "verdict": verdict, "status": status, "actions_taken": actions_taken})
    return {"status": status, "actions_taken": actions_taken}


def build_debate_graph():
    graph = StateGraph(DebateState)
    graph.add_node("investigate_agent", investigate_agent)
    graph.add_node("close_round", close_round)
    graph.add_node("aggregate", aggregate)
    graph.add_node("respond", respond)
    graph.add_conditional_edges(START, route_round, ["investigate_agent", "aggregate"])
    graph.add_edge("investigate_agent", "close_round")
    graph.add_conditional_edges("close_round", route_round, ["investigate_agent", "aggregate"])
    graph.add_edge("aggregate", "respond")
    graph.add_edge("respond", END)
    return graph.compile()


DEBATE_GRAPH = build_debate_graph()


def run_graph(ctx: RunContext, active: list[str]) -> DebateState:
    """Runs the debate graph for the given active agents and returns its final state."""
    initial: DebateState = {
        "round_no": 1,
        "active": list(active),
        "latest_by_agent": {},
        "providers_used": {agent: [] for agent in active},
        "turns": [],
        "verdict": None,
        "status": None,
        "actions_taken": [],
    }
    return DEBATE_GRAPH.invoke(
        initial,
        config={
            "configurable": {"ctx": ctx},
            "max_concurrency": max(1, app_settings.debate_max_parallel_agents),
            "recursion_limit": 40,
        },
    )
