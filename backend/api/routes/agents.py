"""Agent read endpoints (plan sections 2.8, 3.4): the investigator fleet and each agent's credibility history.

Read only. The fault-injection, quarantine and restore routes live in agent_ops.py.
Signals, provider chains and temperature are read from the agent and client source code, not typed here.
"""

import ast
import inspect
from datetime import datetime
from types import ModuleType
from typing import Any, get_args

import redis
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.agents import access_log, endpoint_behavior, llm_clients, network_traffic
from backend.agents.schemas import AgentId
from backend.api.auth import get_current_user
from backend.api.metrics import Metric, make_metric
from backend.api.routes.evidence import load_investigation_citations
from backend.api.schemas.read import AgentFleetEntryOut, CredibilityPointOut
from backend.db.models import AgentQuarantine, CredibilityLog, DebateTranscript, Investigation
from backend.db.session import SessionLocal
from backend.debate.verdict import classify_theory
from backend.watchdog.credibility import get_crs

router = APIRouter(prefix="/agents", tags=["agents"])

SOURCE = "/agents/fleet"
INVESTIGATOR_IDS: tuple[str, ...] = get_args(AgentId)

# Human-facing identity and data domain. The signal names come from the agent's own prompt (see _signals).
AGENT_PROFILE: dict[str, dict] = {
    "network_traffic": {
        "display_name": "Network-Traffic Investigator",
        "domain": "External network traffic (CICIDS2017 flows)",
        "module": network_traffic,
        "signals": [
            "Flow Bytes/s",
            "Flow Packets/s",
            "SYN/RST/ACK flag ratios",
            "Flow IAT patterns",
            "Active/Idle mean-std-max-min",
        ],
    },
    "access_log": {
        "display_name": "Access-Log Investigator",
        "domain": "File access (CERT r4.2 file.csv)",
        "module": access_log,
        "signals": ["file_access_count", "distinct_filenames", "user_department"],
    },
    "endpoint_behavior": {
        "display_name": "Endpoint-Behavior Investigator",
        "domain": "Logon and device activity (CERT r4.2 logon.csv, device.csv)",
        "module": endpoint_behavior,
        "signals": ["off_hours", "connect_count", "distinct_pcs_with_device_activity"],
    },
}

_PROVIDER_CLASS_NAMES = {"GroqClient": "groq", "GeminiClient": "gemini"}
_MODEL_BY_PROVIDER = {"groq": llm_clients.GROQ_MODEL, "gemini": llm_clients.GEMINI_MODEL}


def _signals(agent_id: str) -> list[str]:
    """Only the signals whose name appears verbatim in the agent's SYSTEM_PROMPT. A signal removed from
    the prompt is dropped here, so the fleet never describes a signal the agent no longer uses.
    """
    module: ModuleType = AGENT_PROFILE[agent_id]["module"]
    prompt: str = module.SYSTEM_PROMPT
    return [signal for signal in AGENT_PROFILE[agent_id]["signals"] if signal in prompt]


def _provider_chain(agent_id: str) -> list[str]:
    """Providers in call order, read from the agent module's call_with_fallback(primary, fallback, ...)."""
    tree = ast.parse(inspect.getsource(AGENT_PROFILE[agent_id]["module"]))
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "call_with_fallback"
        ):
            chain = []
            for arg in node.args[:2]:
                if isinstance(arg, ast.Call) and isinstance(arg.func, ast.Name):
                    chain.append(_PROVIDER_CLASS_NAMES[arg.func.id])
            if len(chain) == 2:
                return chain
    raise RuntimeError(f"no call_with_fallback(...) found in the source of agent {agent_id!r}")


def _declared_temperatures() -> list[float]:
    """Every `"temperature": <number>` literal in the LLM client source (one per provider call)."""
    tree = ast.parse(inspect.getsource(llm_clients))
    values: list[float] = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Dict):
            continue
        for key, value in zip(node.keys, node.values, strict=True):
            if (
                isinstance(key, ast.Constant)
                and key.value == "temperature"
                and isinstance(value, ast.Constant)
                and isinstance(value.value, int | float)
                and not isinstance(value.value, bool)
            ):
                values.append(float(value.value))
    return values


def _temperature_metric() -> Metric[Any]:
    values = _declared_temperatures()
    definition = "temperature literal(s) declared in backend/agents/llm_clients.py (n = declaration sites)"
    if values and all(v == values[0] for v in values):
        return make_metric(values[0], len(values), "backend/agents/llm_clients.py", definition)
    return make_metric(
        None,
        0,
        "backend/agents/llm_clients.py",
        definition,
        reason="temperature declarations missing or disagree",
    )


def _crs_metric(agent_id: str, rounds_scored: int) -> Metric[Any]:
    definition = "current Credibility Score in Redis (verdictchain:crs:<agent>); n = rounds scored"
    try:
        crs = get_crs(agent_id)
    except redis.RedisError:
        return make_metric(None, rounds_scored, "redis", definition, reason="Redis unavailable")
    reason = None if rounds_scored else "starting value; no rounds scored yet"
    return make_metric(crs, rounds_scored, "redis", definition, reason=reason)


def _is_isolated(session: Session, agent_id: str) -> bool:
    active = session.execute(
        select(AgentQuarantine.active).where(AgentQuarantine.agent_id == agent_id)
    ).scalar_one_or_none()
    return bool(active)


def _fleet_entry(session: Session, agent_id: str) -> AgentFleetEntryOut:
    profile = AGENT_PROFILE[agent_id]
    chain = _provider_chain(agent_id)
    rounds_scored_n = session.execute(
        select(func.count()).select_from(CredibilityLog).where(CredibilityLog.agent_id == agent_id)
    ).scalar_one()

    transcripts = list(
        session.execute(
            select(DebateTranscript)
            .where(DebateTranscript.agent_id == agent_id)
            .order_by(DebateTranscript.round, DebateTranscript.created_at)
        )
        .scalars()
        .all()
    )
    checked = load_investigation_citations(session, transcripts)
    statuses = [check.status for _, check in checked]
    total = len(statuses)
    verified = statuses.count("VERIFIED")
    invalid = total - verified
    last = session.execute(
        select(DebateTranscript)
        .join(Investigation, Investigation.investigation_id == DebateTranscript.investigation_id)
        .where(DebateTranscript.agent_id == agent_id)
        .order_by(Investigation.created_at.desc(), DebateTranscript.round.desc())
        .limit(1)
    ).scalar_one_or_none()

    return AgentFleetEntryOut(
        agent_id=agent_id,
        display_name=profile["display_name"],
        domain=profile["domain"],
        signals=_signals(agent_id),
        provider_chain=chain,
        model=_MODEL_BY_PROVIDER[chain[0]],
        temperature=_temperature_metric(),
        crs=_crs_metric(agent_id, rounds_scored_n),
        isolated=_is_isolated(session, agent_id),
        rounds_scored=make_metric(
            rounds_scored_n,
            rounds_scored_n,
            SOURCE,
            "credibility_log rows for this agent (one per scored round)",
        ),
        citations_verified=make_metric(
            verified, total, SOURCE, "citations of this agent that check as VERIFIED (n = citations)"
        ),
        citations_total=make_metric(
            total, total, SOURCE, "cited evidence entries of this agent across all rounds"
        ),
        invalid_rate=make_metric(
            invalid / total if total else None,
            total,
            SOURCE,
            "citations that do not check as VERIFIED / total citations (DISCREPANCY or INVALID_ROW)",
            reason=None if total else "no citations yet",
        ),
        last_vote=classify_theory(last.theory) if last is not None else None,
    )


@router.get("/fleet", response_model=list[AgentFleetEntryOut])
def agent_fleet(username: str = Depends(get_current_user)) -> list[AgentFleetEntryOut]:
    session = SessionLocal()
    try:
        return [_fleet_entry(session, agent_id) for agent_id in INVESTIGATOR_IDS]
    finally:
        session.close()


@router.get("/{agent_id}/credibility-history", response_model=list[CredibilityPointOut])
def credibility_history(
    agent_id: str,
    limit: int = Query(60, ge=1, le=500),
    since: datetime | None = None,
    username: str = Depends(get_current_user),
) -> list[CredibilityPointOut]:
    """The latest `limit` credibility points, oldest first."""
    if agent_id not in INVESTIGATOR_IDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=f"Unknown agent {agent_id!r}")
    session = SessionLocal()
    try:
        query = select(CredibilityLog).where(CredibilityLog.agent_id == agent_id)
        if since is not None:
            query = query.where(CredibilityLog.created_at >= since)
        rows = list(
            reversed(
                session.execute(
                    query.order_by(CredibilityLog.created_at.desc(), CredibilityLog.id.desc()).limit(limit)
                )
                .scalars()
                .all()
            )
        )
        return [
            CredibilityPointOut(
                investigation_id=str(r.investigation_id) if r.investigation_id else None,
                round=r.round,
                agent_id=r.agent_id,
                crs_before=r.crs_before,
                crs_after=r.crs_after,
                verification_match_rate=r.verification_match_rate,
                isolated=r.isolated,
                created_at=r.created_at,
            )
            for r in rows
        ]
    finally:
        session.close()
