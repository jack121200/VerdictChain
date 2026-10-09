"""Scenario label -> verdict class mapping used by /evaluation (plan section 3.4 and section 8, item 7).

The insider rows come from the CERT r4.2 answer files (data/raw_data/insider_raw_data/answers_extracted/
answers/r4.2-N/), which list every event of each insider. Their event types decide the primary class
(counts from those files; test_ground_truth_map.py re-derives them when the dataset is present):
  scenario 1, 30 insiders: logon, device, http. 126 of 138 logons are before 07:00 or from 19:00, each with
      a removable-drive connect, and the http events are wikileaks.org pages  -> insider_logon_anomaly
  scenario 2, 30 insiders: http, email, device. Job-site pages and email, then 2607 device events (no logon
      events at all)  -> insider_file_exfiltration
  scenario 3, 10 insiders: logon, device, file, email, http. 60 logons, 34 of them off-hours, plus the only
      file events of the three scenarios  -> insider_logon_anomaly
The other insider class is accepted in every case, so acceptable accuracy and family accuracy do not depend
on which class is primary; only exact accuracy does. `ambiguous` is an abstention and is never counted as
correct.
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
