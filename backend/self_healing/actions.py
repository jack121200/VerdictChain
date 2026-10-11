"""Self-Healing Response Agent (SKILL-architecture.md Section 7). The
containment decision (WHICH actions, on WHAT target) is rule-based - not an
LLM call. An LLM call (OpenAI, per SKILL-agent-prompts.md Section 7) is used
only to generate the human-readable justification logged alongside each
action, as SKILL-agent-prompts.md Section 6 specifies. One call writes the
sentence of every action of the verdict: the key behind it allows few requests.
"""

import re
import uuid
from collections import Counter

from sqlalchemy import select

from backend.agents.llm_clients import OpenAIClient
from backend.db.audit import append_entry
from backend.db.models import RawLog, ResponseAction
from backend.db.session import SessionLocal
from backend.self_healing import sandbox
from backend.watchdog.credibility import AUTONOMOUS_ACTION_MIN_CRS

# Defaults only. The debate engine passes the live verdict threshold and the credibility floor.
CONFIDENCE_THRESHOLD = 0.80
CREDIBILITY_THRESHOLD = AUTONOMOUS_ACTION_MIN_CRS

_EXTERNAL_CLASSES = {"ddos", "port_scan", "brute_force", "botnet_c2"}
_INSIDER_CLASSES = {"insider_file_exfiltration", "insider_logon_anomaly"}

_REASON_PROMPT_TEMPLATE = (
    'A verdict of "{attack_class}" was reached with confidence {confidence}, verified by\n'
    "agents with credibility scores {crs_list}. The system is about to take these\n"
    "sandboxed containment actions:\n{listed}\n"
    "For each action write one sentence (max 30 words) explaining why it is being taken, for the\n"
    "audit trail. Answer with exactly {count} lines, one sentence per line, in the order listed,\n"
    "each starting with its number and a period."
)
_NUMBERED_LINE = re.compile(r"^\s*(\d+)[.)]\s*(\S.*?)\s*$")


def should_respond(
    verdict: dict,
    agent_credibilities: dict[str, float],
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
    credibility_threshold: float = CREDIBILITY_THRESHOLD,
) -> bool:
    """Both conditions required (SKILL-architecture.md Section 7): verdict confidence >= the verdict
    threshold AND every contributing agent's CrS >= the autonomous-action floor (a fresh agent's 0.50).
    """
    if verdict["status"] != "verdict_reached":
        return False
    if verdict["verdict_confidence"] < confidence_threshold:
        return False
    if not agent_credibilities:
        return False
    return all(crs >= credibility_threshold for crs in agent_credibilities.values())


def most_common_value(values: list[str]) -> str | None:
    """The most frequent value. On a tie the smallest value wins, so the choice never depends on the order the
    database returned rows in (the console breaks subject ties the same way)."""
    if not values:
        return None
    counts = Counter(values)
    top = max(counts.values())
    return min(value for value, count in counts.items() if count == top)


def _most_common_target(row_ids: list[str], field: str) -> str | None:
    if not row_ids:
        return None
    session = SessionLocal()
    try:
        uuids = []
        for rid in row_ids:
            try:
                uuids.append(uuid.UUID(rid))
            except ValueError:
                continue
        if not uuids:
            return None
        rows = session.execute(select(RawLog).where(RawLog.row_id.in_(uuids))).scalars().all()
        values = [getattr(row, field) for row in rows if getattr(row, field, None)]
        return most_common_value(values)
    finally:
        session.close()


def _plan_actions(verdict_class: str, supporting_evidence: list[dict]) -> list[tuple[str, str]]:
    """Returns [(action_type, target), ...] - purely rule-based per
    SKILL-architecture.md Section 7.
    """
    row_ids = [e["row_id"] for e in supporting_evidence]

    if verdict_class in _EXTERNAL_CLASSES:
        target = _most_common_target(row_ids, "host_id") or "unknown_target"
        return [("block_ip_range", target), ("trigger_rate_limiting", target), ("trigger_audit", target)]

    if verdict_class in _INSIDER_CLASSES:
        target = _most_common_target(row_ids, "user_id") or "unknown_user"
        return [("lock_account", target), ("trigger_audit", target)]

    return []


_SANDBOX_FUNCTIONS = {
    "lock_account": sandbox.lock_account,
    "block_ip_range": sandbox.block_ip_range,
    "trigger_rate_limiting": sandbox.trigger_rate_limiting,
    "trigger_audit": sandbox.trigger_audit,
}


REASON_SYSTEM_PROMPT = (
    "You write concise, factual one-sentence audit-log justifications. No JSON, just the numbered lines."
)


def reasons_prompt(
    attack_class: str, confidence: float, crs_list: list[float], planned: list[tuple[str, str]]
) -> str:
    listed = "\n".join(
        f"{number}. {action_name} on target {target}"
        for number, (action_name, target) in enumerate(planned, 1)
    )
    return _REASON_PROMPT_TEMPLATE.format(
        attack_class=attack_class,
        confidence=confidence,
        crs_list=crs_list,
        listed=listed,
        count=len(planned),
    )


def parse_reasons(text: str, count: int) -> list[str] | None:
    """The numbered lines of the answer, in order, or None unless it holds exactly the numbers 1..count."""
    found: dict[int, str] = {}
    for line in text.splitlines():
        match = _NUMBERED_LINE.match(line)
        if match is not None:
            found[int(match.group(1))] = match.group(2)
    if sorted(found) != list(range(1, count + 1)):
        return None
    return [found[number] for number in range(1, count + 1)]


def fallback_reason(attack_class: str, confidence: float, action_name: str, target: str) -> str:
    """The sentence used when no model could write one: the facts of the action, nothing invented."""
    return (
        f"{action_name} on {target}: {attack_class} verdict at confidence {confidence} "
        "with credible supporting agents."
    )


def _generate_reasons(
    attack_class: str, confidence: float, crs_list: list[float], planned: list[tuple[str, str]]
) -> list[str]:
    """One sentence per planned action, from one OpenAI call. Whatever goes wrong (no key, a limit, an
    answer that is not one numbered line per action) the facts-only sentence is used: the reason text is
    a nice-to-have and must never block containment."""
    fallbacks = [fallback_reason(attack_class, confidence, action, target) for action, target in planned]
    try:
        answer = OpenAIClient().complete_text(
            REASON_SYSTEM_PROMPT,
            reasons_prompt(attack_class, confidence, crs_list, planned),
            max_output_tokens=400,
        )
    except Exception:  # noqa: BLE001
        return fallbacks
    return parse_reasons(answer, len(planned)) or fallbacks


def respond_to_verdict(
    investigation_id: uuid.UUID,
    verdict: dict,
    agent_credibilities: dict[str, float],
    *,
    confidence_threshold: float = CONFIDENCE_THRESHOLD,
    credibility_threshold: float = CREDIBILITY_THRESHOLD,
) -> list[dict]:
    """Returns the list of actions taken (empty if the trigger conditions
    weren't met). Every action is written to response_actions with
    is_simulated=True (also hardcoded at the schema level - see sandbox.py).
    """
    if not should_respond(verdict, agent_credibilities, confidence_threshold, credibility_threshold):
        return []

    verdict_class = verdict["verdict_class"]
    planned = _plan_actions(verdict_class, verdict["supporting_evidence"])
    if not planned:
        return []

    crs_list = list(agent_credibilities.values())
    # The LLM reason text is generated before the audit transaction opens, so the
    # advisory lock is never held across a provider call (plan section 3.2).
    reasons = _generate_reasons(verdict_class, verdict["verdict_confidence"], crs_list, planned)
    taken = []

    session = SessionLocal()
    try:
        for (action_type, target), reason in zip(planned, reasons, strict=True):
            sandbox_fn = _SANDBOX_FUNCTIONS[action_type]
            sandbox_fn(target)  # executes in the sandbox - see sandbox.py

            record = ResponseAction(
                investigation_id=investigation_id,
                action_type=action_type,
                target=target,
                reason=reason,
                is_simulated=True,
            )
            session.add(record)

            # SKILL-architecture.md Section 7: each action feeds both
            # response_actions AND the audit trail.
            append_entry(
                session,
                actor="self_healing",
                action=action_type,
                detail={
                    "target": target,
                    "reason": reason,
                    "verdict_class": verdict_class,
                    "is_simulated": True,
                },
                investigation_id=investigation_id,
            )

            # SessionLocal has autoflush=False (Module 1) - flush here so the
            # NEXT iteration's append_entry() can see this entry as the chain
            # tail. Without it every entry in this loop would see prev_hash as
            # empty and the chain would be broken.
            session.flush()

            taken.append({"action_type": action_type, "target": target, "reason": reason})
        session.commit()
    finally:
        session.close()

    return taken
