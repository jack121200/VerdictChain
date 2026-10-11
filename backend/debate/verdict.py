"""Deterministic verdict aggregation (SKILL-architecture.md Section 3) -
explicitly NOT another LLM call.

Where an agent's vote comes from (amendment 2026-10-11, checklist LG2): the class the agent STATES in its
answer (AgentResponse.vote_class). Only when it stated none, or something that is not one of the eight
classes, does classify_theory() read the free-text theory with a keyword list (the first design, from the
2026-09-07 session). The keyword reading is approximate - it takes "no clear attack, weakly like a botnet
beacon" for a botnet vote - which is why the agent now states its class itself.
"""

from collections import Counter
from statistics import mean

from backend.agents.schemas import VOTE_CLASSES, AgentResponse

# The keyword lists stay packed several to a line (one per line would be 90 lines), so black skips them.
# fmt: off
_CLASS_KEYWORDS = {
    "ddos": [
        "ddos", "flood", "volumetric", "traffic spike", "traffic flood", "denial of service",
        "packet flood", "syn flood", "amplification", "bandwidth exhaustion", "high packet rate",
        "traffic volume", "resource exhaustion",
    ],
    "port_scan": [
        "port scan", "portscan", "reconnaissance", "scanning", "port sweep", "service enumeration",
        "network mapping", "probe", "port probing", "syn scan", "stealth scan", "host discovery",
        "network reconnaissance",
    ],
    "brute_force": [
        "brute force", "brute-force", "patator", "credential guessing", "repeated login attempt",
        "password guessing", "dictionary attack", "credential stuffing", "login spray",
        "authentication attack", "ssh attack", "ftp attack", "failed login",
    ],
    "botnet_c2": [
        "botnet", "c2", "command and control", "beacon", "c&c", "beaconing",
        "periodic callback", "remote control", "bot activity", "malware communication",
        "command channel", "covert channel",
    ],
    "insider_file_exfiltration": [
        "exfiltration", "data theft", "unusual file access", "large file transfer",
        "data leakage", "unauthorized download", "mass file access", "bulk download",
        "sensitive file", "data extraction", "file copy", "removable media",
        "usb transfer", "abnormal file volume",
    ],
    "insider_logon_anomaly": [
        "off-hours", "off hours", "login anomaly", "unrecognized device", "unusual login",
        "abnormal logon", "after-hours", "after hours", "weekend login", "foreign device",
        "unusual device", "anomalous authentication", "suspicious logon", "irregular access",
        "unauthorized access time", "outside working hours",
    ],
    "benign": ["benign", "no anomaly", "no evidence", "normal", "typical activity", "legitimate"],
}
# fmt: on


def classify_theory(theory: str) -> str:
    text = theory.lower()
    scores = {cls: sum(1 for kw in kws if kw in text) for cls, kws in _CLASS_KEYWORDS.items()}
    best_class, best_score = max(scores.items(), key=lambda kv: kv[1])
    return best_class if best_score > 0 else "unclassified"


def vote_of(theory: str, stated: str | None) -> tuple[str, str]:
    """(class, source) of one agent's vote. source is "stated" when the agent named one of the eight classes
    and "keywords" when its theory had to be read. A stated "ambiguous" (the rows do not decide) is an
    abstention, so it comes back as "unclassified", exactly like a theory no keyword matched."""
    if stated in VOTE_CLASSES:
        return ("unclassified" if stated == "ambiguous" else stated), "stated"
    return classify_theory(theory), "keywords"


def aggregate_verdict(final_responses: list[AgentResponse], primary_agent_id: str | None = None) -> dict:
    """Combines the 3 agents' round-3 positions into one verdict.

    A clear majority (two or more agents on one class) wins. When the real votes
    split with no majority (for example one class each), the tie is broken by the
    PRIMARY agent's class if it cast a real vote - the primary agent is the one
    whose data slice actually matched the injected scenario, so it is the domain
    authority for that case. Only a split with no primary signal stays "ambiguous".
    An all-benign/unclassified set is "benign" (SKILL-architecture.md Section 3).
    """
    classified = [(r, vote_of(r.theory, r.vote_class)[0]) for r in final_responses]
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
