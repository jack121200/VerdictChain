"""Deterministic verdict aggregation (SKILL-architecture.md Section 3) -
explicitly NOT another LLM call.

Design decision (2026-09-07 session, flagged for review): AgentResponse.theory
is free text - the locked schema in SKILL-agent-prompts.md has no structured
class field to aggregate on. classify_theory() is a deterministic keyword
classifier used as a substitute, not something either skill file specifies.
It's necessarily approximate; a future revision could add a structured field
to AgentResponse instead (a real schema change, so flagged here rather than
done silently).
"""

from collections import Counter
from statistics import mean

from backend.agents.schemas import AgentResponse

_CLASS_KEYWORDS = {
    "ddos": ["ddos", "flood", "volumetric", "traffic spike"],
    "port_scan": ["port scan", "portscan", "reconnaissance", "scanning"],
    "brute_force": ["brute force", "brute-force", "patator", "credential guessing", "repeated login attempt"],
    "botnet_c2": ["botnet", "c2", "command and control", "beacon"],
    "insider_file_exfiltration": ["exfiltration", "data theft", "unusual file access", "large file transfer"],
    "insider_logon_anomaly": [
        "off-hours",
        "off hours",
        "login anomaly",
        "unrecognized device",
        "unusual login",
    ],
    "benign": ["benign", "no anomaly", "no evidence", "normal", "typical activity"],
}


def classify_theory(theory: str) -> str:
    text = theory.lower()
    scores = {cls: sum(1 for kw in kws if kw in text) for cls, kws in _CLASS_KEYWORDS.items()}
    best_class, best_score = max(scores.items(), key=lambda kv: kv[1])
    return best_class if best_score > 0 else "unclassified"


def aggregate_verdict(final_responses: list[AgentResponse], primary_agent_id: str | None = None) -> dict:
    """Combines the 3 agents' round-3 positions into one verdict.

    A clear majority (two or more agents on one class) wins. When the real votes
    split with no majority (for example one class each), the tie is broken by the
    PRIMARY agent's class if it cast a real vote - the primary agent is the one
    whose data slice actually matched the injected scenario, so it is the domain
    authority for that case. Only a split with no primary signal stays "ambiguous".
    An all-benign/unclassified set is "benign" (SKILL-architecture.md Section 3).
    """
    classified = [(r, classify_theory(r.theory)) for r in final_responses]
    real_votes = [(r, cls) for r, cls in classified if cls not in ("benign", "unclassified")]

    if not real_votes:
        confidences = [r.confidence for r in final_responses]
        return {
            "verdict_class": "benign",
            "verdict_confidence": round(mean(confidences), 4) if confidences else 0.0,
            "status": "verdict_reached",
            "supporting_evidence": [],
            "contributing_agents": [r.agent_id for r in final_responses],
        }

    vote_counts = Counter(cls for _, cls in real_votes)
    ranked = vote_counts.most_common()
    top_class, top_count = ranked[0]
    tie = len(ranked) > 1 and ranked[1][1] == top_count

    if tie and primary_agent_id is not None:
        primary_class = next(
            (
                cls
                for r, cls in classified
                if r.agent_id == primary_agent_id and cls not in ("benign", "unclassified")
            ),
            None,
        )
        if primary_class is not None:
            top_class = primary_class
            tie = False

    supporters = [r for r, cls in real_votes if cls == top_class]
    confidence = round(mean(r.confidence for r in supporters), 4)
    evidence = [e.model_dump() for r in supporters for e in r.cited_evidence]

    return {
        "verdict_class": "ambiguous" if tie else top_class,
        "verdict_confidence": confidence,
        "status": "ambiguous" if tie else "verdict_reached",
        "supporting_evidence": evidence,
        "contributing_agents": [r.agent_id for r in supporters],
    }
