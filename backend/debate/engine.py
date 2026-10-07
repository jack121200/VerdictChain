"""3-round debate orchestration (SKILL-architecture.md Section 3).

start_investigation() creates the Investigation row and its investigation_started audit entry in
one transaction. run_debate() then runs DEBATE_ROUNDS rounds for the active investigators, and
aggregate_verdict() combines their final positions (deterministic, not an LLM call). Self-healing
runs last.

Isolation (decision D1, on): after an agent's round is scored, a CrS below the isolation threshold
sets its agent_quarantine row active. That agent takes no part in later rounds or in the verdict.
The quarantine persists across debates and is lifted only by the audited restore action.

See backend/debate/state.py's docstring for why non-primary agents reason over a contextual sample
from their own domain rather than sitting out, and why peripheral awareness is structural-only.
"""

import re
import uuid
from collections.abc import Callable
from statistics import mean
from typing import Protocol

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.agents import access_log, endpoint_behavior, network_traffic
from backend.agents.schemas import AgentResponse
from backend.db.audit import append_entry
from backend.db.models import AgentQuarantine, DebateTranscript, Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate.state import assemble_debate_inputs, build_peripheral_digest, is_near_duplicate
from backend.debate.verdict import aggregate_verdict
from backend.self_healing.actions import respond_to_verdict
from backend.watchdog.credibility import get_crs
from backend.watchdog.service import score_agent_round

DEBATE_ROUNDS = 3
MIN_ACTIVE_AGENTS = 2
_STANCE_RE = re.compile(r"\s*(CHALLENGE|SUPPORT|REVISE)\b")


class DebateFailedError(Exception):
    """Raised when a debate can't complete (e.g. all LLM provider retries
    exhausted). Carries investigation_id so the caller can report which
    Investigation was left in status='error'.
    """

    def __init__(self, investigation_id: str, reason: str):
        self.investigation_id = investigation_id
        self.reason = reason
        super().__init__(f"debate for investigation {investigation_id} failed: {reason}")


class NotEnoughActiveAgents(Exception):
    """Fewer than MIN_ACTIVE_AGENTS investigators are not quarantined, so no debate can run.
    The API maps this to 409.
    """


class EngineSettings(Protocol):
    """The runtime settings the engine reads (backend/db/runtime_settings.py, load())."""

    eta: float
    isolation_threshold: float
    verdict_confidence_threshold: float


InvestigatorFn = Callable[..., tuple[AgentResponse, str]]

INVESTIGATORS: dict[str, InvestigatorFn] = {
    "network_traffic": network_traffic.investigate,
    "access_log": access_log.investigate,
    "endpoint_behavior": endpoint_behavior.investigate,
}


def _load_settings(session: Session | None = None) -> EngineSettings:
    # Imported at call time, so importing the engine never depends on the settings module.
    from backend.db.runtime_settings import load

    return load(session=session)


def parse_stance(theory: str) -> str | None:
    """The theory's first token when it is CHALLENGE, SUPPORT or REVISE (the prompt requires it at
    the start), else None.
    """
    match = _STANCE_RE.match(theory)
    return match.group(1) if match else None


def start_investigation(
    *,
    trigger_type: str,
    trigger_reason: str | None,
    scenario_label: str | None,
    primary_agent: str,
    noise_pct: int,
    effective_noise_pct: float | None,
    injected_row_ids: list[uuid.UUID],
    started_by: str,
    max_rows_per_agent: int,
) -> uuid.UUID:
    """Creates the Investigation row and its investigation_started audit entry in one transaction.
    The audit detail holds the settings snapshot, the noise values and the injected row ids.
    scenario_label is stored on the Investigation row only, as hidden ground truth. It never goes
    into the audit detail, and no agent code reads it.
    """
    session = SessionLocal()
    try:
        snapshot = _load_settings(session)
        investigation = Investigation(
            trigger_type=trigger_type,
            trigger_reason=trigger_reason or f"debate for {primary_agent}",
            scenario_label=scenario_label,
            primary_agent=primary_agent,
            noise_pct=noise_pct,
            effective_noise_pct=effective_noise_pct,
        )
        session.add(investigation)
        session.flush()
        investigation_id = investigation.investigation_id
        # Domain row first, audit append last, same transaction (plan section 3.2).
        append_entry(
            session,
            actor=started_by,
            action="investigation_started",
            detail={
                "trigger_type": trigger_type,
                "primary_agent": primary_agent,
                "noise_pct": noise_pct,
                "effective_noise_pct": effective_noise_pct,
                "max_rows_per_agent": max_rows_per_agent,
                "injected_row_ids": [str(row_id) for row_id in injected_row_ids],
                "settings": {
                    "eta": snapshot.eta,
                    "isolation_threshold": snapshot.isolation_threshold,
                    "verdict_confidence_threshold": snapshot.verdict_confidence_threshold,
                },
            },
            investigation_id=investigation_id,
        )
        session.commit()
        return investigation_id
    finally:
        session.close()


def _persist_round(
    investigation_id: uuid.UUID,
    round_no: int,
    agent_id: str,
    response: AgentResponse,
    provider: str | None = None,
) -> None:
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
                provider=provider,
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


def _respond(
    investigators: dict[str, InvestigatorFn],
    agent_id: str,
    rows: list[RawLog],
    round_no: int,
    digest: dict,
    debate_context: str | None,
    previous: AgentResponse | None,
) -> tuple[AgentResponse, str]:
    """One investigator call, plus one retry if the answer repeats the agent's previous theory
    (SKILL-architecture.md Section 3).
    """
    response, provider = investigators[agent_id](
        rows, round_no=round_no, peripheral_digest=digest, debate_context=debate_context
    )
    if previous is not None and is_near_duplicate(response.theory, previous.theory):
        nudged_context = (
            (debate_context or "")
            + "\n\nYour previous answer was rejected as too similar to your prior round. "
            "You must meaningfully CHALLENGE, SUPPORT, or REVISE."
        )
        response, provider = investigators[agent_id](
            rows, round_no=round_no, peripheral_digest=digest, debate_context=nudged_context
        )
    return response, provider


def _quarantined_agents() -> set[str]:
    session = SessionLocal()
    try:
        ids = session.execute(select(AgentQuarantine.agent_id).where(AgentQuarantine.active.is_(True)))
        return set(ids.scalars().all())
    finally:
        session.close()


def _isolate_agent(investigation_id: uuid.UUID, agent_id: str, round_no: int, crs_after: float) -> None:
    """Sets the agent's quarantine and writes agent_isolated, in one transaction."""
    session = SessionLocal()
    try:
        quarantine = session.get(AgentQuarantine, agent_id)
        if quarantine is None:
            quarantine = AgentQuarantine(agent_id=agent_id)
            session.add(quarantine)
        quarantine.active = True
        quarantine.reason = f"CrS {crs_after:.4f} below the isolation threshold in round {round_no}"
        quarantine.set_by = "watchdog"
        quarantine.updated_at = func.now()
        append_entry(
            session,
            actor="watchdog",
            action="agent_isolated",
            detail={"agent_id": agent_id, "round": round_no, "crs_after": crs_after},
            investigation_id=investigation_id,
        )
        session.commit()
    finally:
        session.close()


def _audit_round(investigation_id: uuid.UUID, round_no: int, providers: dict[str, str]) -> None:
    session = SessionLocal()
    try:
        append_entry(
            session,
            actor="debate_engine",
            action="round_completed",
            detail={
                "round": round_no,
                "agents": [{"agent_id": agent, "provider": prov} for agent, prov in providers.items()],
            },
            investigation_id=investigation_id,
        )
        session.commit()
    finally:
        session.close()


def _set_status(investigation_id: uuid.UUID, status: str) -> None:
    session = SessionLocal()
    try:
        inv = session.get(Investigation, investigation_id)
        if inv is not None:
            inv.status = status
            inv.updated_at = func.now()
            session.commit()
    finally:
        session.close()


def _finalize_verdict(investigation_id: uuid.UUID, verdict: dict) -> None:
    """Writes the verdict to the Investigation and audits verdict_reached, in one transaction."""
    session = SessionLocal()
    try:
        inv = session.get(Investigation, investigation_id)
        inv.status = verdict["status"]
        inv.verdict_class = verdict["verdict_class"]
        inv.verdict_confidence = verdict["verdict_confidence"]
        inv.updated_at = func.now()
        append_entry(
            session,
            actor="debate_engine",
            action="verdict_reached",
            detail={
                "verdict_class": verdict["verdict_class"],
                "verdict_confidence": verdict["verdict_confidence"],
                "status": verdict["status"],
                "contributing_agents": verdict["contributing_agents"],
            },
            investigation_id=investigation_id,
        )
        session.commit()
    finally:
        session.close()


def _insufficient_verdict(final: list[AgentResponse]) -> dict:
    """Fewer than MIN_ACTIVE_AGENTS agents finished, so no class can be adjudicated. The verdict is
    ambiguous, never a forced class (SKILL-architecture.md Section 3). It triggers no containment.
    """
    return {
        "verdict_class": "ambiguous",
        "verdict_confidence": round(mean(r.confidence for r in final), 4) if final else None,
        "status": "ambiguous",
        "supporting_evidence": [],
        "contributing_agents": [r.agent_id for r in final],
    }


def _round_entry(agent_id: str, response: AgentResponse, provider: str, score: dict) -> dict:
    return {
        "agent_id": agent_id,
        "theory": response.theory,
        "confidence": response.confidence,
        "stance": parse_stance(response.theory),
        "provider": provider,
        "cited_evidence": [e.model_dump() for e in response.cited_evidence],
        "credibility": score,
    }


def run_debate(
    primary_agent_id: str,
    primary_rows: list[RawLog],
    *,
    investigation_id: uuid.UUID,
    investigators: dict[str, InvestigatorFn] = INVESTIGATORS,
    max_rows_per_agent: int = 5,
    on_update: Callable[[dict], None] | None = None,
    settings: EngineSettings | None = None,
) -> dict:
    """Runs the debate on an existing investigation (create it with start_investigation first).
    Returns {investigation_id, status, verdict, providers_used, actions_taken}.

    Agents whose agent_quarantine row is active are excluded. NotEnoughActiveAgents is raised if
    fewer than MIN_ACTIVE_AGENTS remain. settings=None loads the runtime settings once.

    on_update receives events, each with investigation_id: round_completed (once per round),
    agent_isolated, verdict (once, at the end), and error. It is called synchronously, so the
    WebSocket layer can broadcast as the debate runs.
    """
    session = SessionLocal()
    try:
        exists = session.get(Investigation, investigation_id) is not None
    finally:
        session.close()
    if not exists:
        raise ValueError(f"investigation {investigation_id} does not exist; call start_investigation() first")

    quarantined = _quarantined_agents()
    active = [agent for agent in investigators if agent not in quarantined]
    if len(active) < MIN_ACTIVE_AGENTS:
        _set_status(investigation_id, "error")
        message = f"{len(active)} investigator(s) active, at least {MIN_ACTIVE_AGENTS} required"
        if on_update:
            on_update({"type": "error", "investigation_id": str(investigation_id), "detail": message})
        raise NotEnoughActiveAgents(message)

    if settings is None:
        settings = _load_settings()
    assembled = assemble_debate_inputs(primary_agent_id, primary_rows, max_rows=max_rows_per_agent)
    inputs = {agent: assembled[agent] for agent in active}

    latest_by_agent: dict[str, AgentResponse] = {}
    providers_used: dict[str, list[str]] = {agent: [] for agent in active}

    try:
        for round_no in range(1, DEBATE_ROUNDS + 1):
            if len(active) < MIN_ACTIVE_AGENTS:
                break
            round_agents = list(active)
            round_responses: dict[str, AgentResponse] = {}
            round_providers: dict[str, str] = {}
            round_scores: dict[str, dict] = {}

            for agent_id in round_agents:
                digest = build_peripheral_digest({a: inputs[a] for a in round_agents}, exclude_agent=agent_id)
                debate_context = _debate_context_for(agent_id, latest_by_agent) if round_no > 1 else None
                response, provider = _respond(
                    investigators,
                    agent_id,
                    inputs[agent_id],
                    round_no,
                    digest,
                    debate_context,
                    latest_by_agent.get(agent_id),
                )
                _persist_round(investigation_id, round_no, agent_id, response, provider)
                round_responses[agent_id] = response
                round_providers[agent_id] = provider
                providers_used[agent_id].append(provider)

                score = score_agent_round(
                    investigation_id,
                    round_no,
                    response,
                    eta=settings.eta,
                    isolation_threshold=settings.isolation_threshold,
                )
                round_scores[agent_id] = score
                if score["isolated"]:
                    _isolate_agent(investigation_id, agent_id, round_no, score["crs_after"])
                    active.remove(agent_id)
                    if on_update:
                        on_update(
                            {
                                "type": "agent_isolated",
                                "investigation_id": str(investigation_id),
                                "agent_id": agent_id,
                                "round": round_no,
                                "crs_after": score["crs_after"],
                            }
                        )

            latest_by_agent = {a: r for a, r in round_responses.items() if a in active}
            _audit_round(investigation_id, round_no, round_providers)
            if on_update:
                on_update(
                    {
                        "type": "round_completed",
                        "investigation_id": str(investigation_id),
                        "round": round_no,
                        "agents": [
                            _round_entry(a, round_responses[a], round_providers[a], round_scores[a])
                            for a in round_agents
                        ],
                    }
                )
    except Exception as exc:
        # A mid-debate failure (e.g. both LLM providers down at once - observed
        # live this session) must not leave the Investigation stuck at
        # status='investigating' forever. Mark it and let the caller (the API
        # route) decide how to surface this to the client/WebSocket.
        _set_status(investigation_id, "error")
        if on_update:
            on_update({"type": "error", "investigation_id": str(investigation_id), "detail": str(exc)})
        raise DebateFailedError(str(investigation_id), str(exc)) from exc

    final = list(latest_by_agent.values())
    verdict = aggregate_verdict(final) if len(final) >= MIN_ACTIVE_AGENTS else _insufficient_verdict(final)
    _finalize_verdict(investigation_id, verdict)

    # Self-Healing (SKILL-architecture.md Section 7): respond_to_verdict() enforces the verdict
    # threshold and the CrS gate, using the live settings. Any action taken means "contained".
    contributing_crs = {agent: get_crs(agent) for agent in verdict["contributing_agents"]}
    actions_taken = respond_to_verdict(
        investigation_id,
        verdict,
        contributing_crs,
        confidence_threshold=settings.verdict_confidence_threshold,
        credibility_threshold=settings.isolation_threshold,
    )
    status = verdict["status"]
    if actions_taken:
        status = "contained"
        _set_status(investigation_id, status)

    if on_update:
        on_update(
            {
                "type": "verdict",
                "investigation_id": str(investigation_id),
                "verdict": verdict,
                "status": status,
                "actions_taken": actions_taken,
            }
        )

    return {
        "investigation_id": str(investigation_id),
        "status": status,
        "verdict": verdict,
        "providers_used": providers_used,
        "actions_taken": actions_taken,
    }
