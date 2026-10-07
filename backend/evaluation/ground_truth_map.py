"""Scenario label -> verdict class mapping used by /evaluation (plan section 3.4 and section 8, item 7).

The insider mapping is a DEFAULT. It is not confirmed by the project owner yet. Insider scenarios
1 to 3 are mapped to one primary class each, and the other insider class is accepted as well.
`ambiguous` is an abstention and is never counted as correct.
"""

from collections.abc import Mapping
from types import MappingProxyType
from typing import NamedTuple

# The verdict classes the deterministic aggregator can produce (backend/debate/verdict.py), plus
# the benign class. `unclassified` is a per-agent vote only and is never a verdict.
VERDICT_CLASSES: tuple[str, ...] = (
    "ddos",
    "port_scan",
    "brute_force",
    "botnet_c2",
    "insider_file_exfiltration",
    "insider_logon_anomaly",
    "benign",
    "ambiguous",
)

# The six attack classes (`threats_24h` counts these; `benign` and `ambiguous` are not threats).
ATTACK_CLASSES: frozenset[str] = frozenset(VERDICT_CLASSES[:6])
INSIDER_CLASSES: frozenset[str] = frozenset({"insider_file_exfiltration", "insider_logon_anomaly"})

# Coarse family of a class. Family accuracy compares families, so a correct family with the wrong
# insider sub-class still counts there. Ambiguous has no family and is never a family match.
CLASS_FAMILY: Mapping[str, str] = MappingProxyType(
    {
        "ddos": "network",
        "port_scan": "network",
        "brute_force": "network",
        "botnet_c2": "network",
        "insider_file_exfiltration": "insider",
        "insider_logon_anomaly": "insider",
        "benign": "benign",
    }
)


class GroundTruth(NamedTuple):
    expected: str
    accepted: tuple[str, ...] = ()


SCENARIO_GROUND_TRUTH: Mapping[str, GroundTruth] = MappingProxyType(
    {
        "DDoS": GroundTruth("ddos"),
        "Portscan": GroundTruth("port_scan"),
        "FTP-Patator": GroundTruth("brute_force"),
        "SSH-Patator": GroundTruth("brute_force"),
        "Botnet": GroundTruth("botnet_c2"),
        "BENIGN": GroundTruth("benign"),
        "insider_scenario_1": GroundTruth("insider_logon_anomaly", ("insider_file_exfiltration",)),
        "insider_scenario_2": GroundTruth("insider_file_exfiltration", ("insider_logon_anomaly",)),
        "insider_scenario_3": GroundTruth("insider_logon_anomaly", ("insider_file_exfiltration",)),
    }
)
