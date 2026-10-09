"""Emergency containment and its release (plan sections 3.4 and 3.5).

Manual containment runs the same sandbox functions as the automatic Self-Healing path, but it never calls
an LLM: the reason is a fixed template. The verdict is re-derived from the round-3 transcripts with
aggregate_verdict (no LLM). Every write goes to response_actions with is_simulated TRUE, and every step is
audited. The active state is derived from response_actions (a containment row minus its release row),
never from memory.
"""

import uuid
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.agents.schemas import AgentResponse
from backend.api.auth import CurrentAnalyst, require_capability
from backend.api.routes.investigations import isolated_agents
from backend.api.schemas.ops import (
    ContainmentActionOut,
    ContainmentOut,
    EmergencyContainmentRequest,
    ReleaseContainmentOut,
)
from backend.db.audit import RELEASE_PREFIX, append_entry
from backend.db.models import AgentQuarantine, DebateTranscript, Investigation, RawLog, ResponseAction
from backend.db.session import SessionLocal
from backend.debate.engine import MIN_ACTIVE_AGENTS
from backend.debate.verdict import aggregate_verdict
from backend.self_healing import sandbox

router = APIRouter(prefix="/investigations", tags=["containment"])

# The same verdict classes as the automatic path (self_healing/actions.py, SKILL-architecture.md Section 7).
EXTERNAL_CLASSES = frozenset({"ddos", "port_scan", "brute_force", "botnet_c2"})
INSIDER_CLASSES = frozenset({"insider_file_exfiltration", "insider_logon_anomaly"})
MANUAL_TRIGGER = "manual_override"
SELF_HEALING_ACTOR = "self_healing"


@router.post("/{investigation_id}/emergency-containment", response_model=ContainmentOut)
def emergency_containment(
    investigation_id: uuid.UUID,
    body: EmergencyContainmentRequest,
    actor: CurrentAnalyst = Depends(require_capability("trigger_emergency_containment")),
) -> ContainmentOut:
    with SessionLocal() as session:
        inv = _lock_investigation(session, investigation_id)
        if _active_containment(session, investigation_id):
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Investigation is already contained.")

        positions = _final_positions(session, investigation_id)
        if not positions:
            raise HTTPException(
                status.HTTP_409_CONFLICT, detail="The verdict has not been reached: no round-3 transcripts."
            )
        if len(positions) < MIN_ACTIVE_AGENTS:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=(
                    f"Only {len(positions)} agent counted in this verdict (the rest were isolated); "
                    f"at least {MIN_ACTIVE_AGENTS} are required."
                ),
            )
        # Same inputs the engine used, so a tie broken by the primary agent re-derives to the same class.
        verdict = aggregate_verdict(positions, primary_agent_id=inv.primary_agent)
        verdict_class = verdict["verdict_class"]

        plan = _plan(session, verdict_class, verdict["supporting_evidence"])
        if plan is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=(
                    f"No containment plan for a {verdict_class!r} verdict "
                    "(plans cover insider and external classes)."
                ),
            )
        quarantined = _quarantined(session, verdict["contributing_agents"])
        if quarantined:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail=f"Contributing agent(s) are quarantined: {', '.join(quarantined)}.",
            )

        executed: list[ContainmentActionOut] = []
        for action, target in plan:
            sandbox.FORWARD_ACTIONS[action](target)  # sandboxed: in-memory state only
            reason = (
                f"Manual containment by {actor.username}: sandboxed {action} on {target} for a "
                f"{verdict_class} verdict at confidence {verdict['verdict_confidence']:.2f}."
            )
            session.add(
                ResponseAction(
                    investigation_id=investigation_id,
                    action_type=action,
                    target=target,
                    reason=reason,
                    is_simulated=True,
                )
            )
            executed.append(
                ContainmentActionOut(action_type=action, target=target, reason=reason, is_simulated=True)
            )
        inv.status = "contained"

        # Domain rows first, audit entries last, in the same transaction (plan section 3.2).
        for item in executed:
            append_entry(
                session,
                actor=SELF_HEALING_ACTOR,
                action=item.action_type,
                detail={
                    "target": item.target,
                    "reason": item.reason,
                    "verdict_class": verdict_class,
                    "is_simulated": True,
                    "trigger": MANUAL_TRIGGER,
                },
                investigation_id=investigation_id,
            )
        append_entry(
            session,
            actor=actor.username,
            action="emergency_containment",
            detail={
                "verdict_class": verdict_class,
                "actions": [item.action_type for item in executed],
                "is_simulated": True,
            },
            investigation_id=investigation_id,
        )
        session.commit()

    return ContainmentOut(
        investigation_id=str(investigation_id),
        status="contained",
        verdict_class=verdict_class,
        actions=executed,
    )


@router.post("/{investigation_id}/release-containment", response_model=ReleaseContainmentOut)
def release_containment(
    investigation_id: uuid.UUID,
    actor: CurrentAnalyst = Depends(require_capability("trigger_emergency_containment")),
) -> ReleaseContainmentOut:
    with SessionLocal() as session:
        inv = _lock_investigation(session, investigation_id)
        active = _active_containment(session, investigation_id)
        if not active:
            raise HTTPException(status.HTTP_409_CONFLICT, detail="Investigation is not contained.")

        released: list[ContainmentActionOut] = []
        for (action, target), count in sorted(active.items()):
            for _ in range(count):
                sandbox.INVERSE_ACTIONS[action](target)  # sandboxed inverse
                action_type = f"{RELEASE_PREFIX}{action}"
                reason = f"Containment released by {actor.username}: sandboxed {action} on {target} reverted."
                session.add(
                    ResponseAction(
                        investigation_id=investigation_id,
                        action_type=action_type,
                        target=target,
                        reason=reason,
                        is_simulated=True,
                    )
                )
                released.append(
                    ContainmentActionOut(
                        action_type=action_type, target=target, reason=reason, is_simulated=True
                    )
                )
        inv.status = "verdict_reached"

        for item in released:
            append_entry(
                session,
                actor=actor.username,
                action=item.action_type,
                detail={"target": item.target, "reason": item.reason, "is_simulated": True},
                investigation_id=investigation_id,
            )
        append_entry(
            session,
            actor=actor.username,
            action="containment_released",
            detail={"released": [{"action_type": r.action_type, "target": r.target} for r in released]},
            investigation_id=investigation_id,
        )
        session.commit()

    return ReleaseContainmentOut(
        investigation_id=str(investigation_id),
        status="verdict_reached",
        released=released,
    )


def _lock_investigation(session: Session, investigation_id: uuid.UUID) -> Investigation:
    """Row lock, so two containment writes for one investigation cannot interleave."""
    inv = session.execute(
        select(Investigation).where(Investigation.investigation_id == investigation_id).with_for_update()
    ).scalar_one_or_none()
    if inv is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Investigation not found")
    return inv


def _active_containment(session: Session, investigation_id: uuid.UUID) -> Counter:
    """(action, target) -> count of reversible containment rows not yet matched by a release row."""
    rows = session.execute(
        select(ResponseAction.action_type, ResponseAction.target).where(
            ResponseAction.investigation_id == investigation_id
        )
    ).all()
    net: Counter = Counter()
    for action_type, target in rows:
        if action_type.startswith(RELEASE_PREFIX):
            net[(action_type[len(RELEASE_PREFIX) :], target)] -= 1
        elif action_type in sandbox.INVERSE_ACTIONS:
            net[(action_type, target)] += 1
    return Counter({key: n for key, n in net.items() if n > 0})


def _final_positions(session: Session, investigation_id: uuid.UUID) -> list[AgentResponse]:
    """Round-3 positions of the agents the engine counted: one isolated during the investigation (for
    example when round 3 was scored) is left out, exactly as in the verdict the engine stored."""
    skip = isolated_agents(session, investigation_id)
    rows = (
        session.execute(
            select(DebateTranscript)
            .where(DebateTranscript.investigation_id == investigation_id, DebateTranscript.round == 3)
            .order_by(DebateTranscript.agent_id)
        )
        .scalars()
        .all()
    )
    return [
        AgentResponse(
            agent_id=r.agent_id,
            theory=r.theory,
            confidence=r.confidence,
            cited_evidence=r.cited_evidence,
            round=3,
        )
        for r in rows
        if r.agent_id not in skip
    ]


def _plan(
    session: Session, verdict_class: str, supporting_evidence: list[dict]
) -> list[tuple[str, str]] | None:
    """The sandbox actions and targets for a verdict class, or None when no plan exists. Mirrors
    self_healing/actions.py's rule: the target is the most-cited host (external) or user (insider).
    """
    if verdict_class in EXTERNAL_CLASSES:
        target = _most_common(session, supporting_evidence, RawLog.host_id) or "unknown_target"
        return [("block_ip_range", target), ("trigger_rate_limiting", target), ("trigger_audit", target)]
    if verdict_class in INSIDER_CLASSES:
        target = _most_common(session, supporting_evidence, RawLog.user_id) or "unknown_user"
        return [("lock_account", target), ("trigger_audit", target)]
    return None


def _most_common(session: Session, evidence: list[dict], column) -> str | None:
    ids = []
    for item in evidence:
        try:
            ids.append(uuid.UUID(item["row_id"]))
        except (KeyError, ValueError):
            continue
    if not ids:
        return None
    values = [v for v in session.execute(select(column).where(RawLog.row_id.in_(ids))).scalars().all() if v]
    return Counter(values).most_common(1)[0][0] if values else None


def _quarantined(session: Session, agent_ids: list[str]) -> list[str]:
    return sorted(
        session.execute(
            select(AgentQuarantine.agent_id).where(
                AgentQuarantine.agent_id.in_(agent_ids), AgentQuarantine.active.is_(True)
            )
        )
        .scalars()
        .all()
    )
