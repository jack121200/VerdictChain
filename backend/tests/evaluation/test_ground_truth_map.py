"""The label-to-class mapping (plan section 3.4 and 8, item 7). Every scenario label is mapped, every mapped
class is a real verdict class, and the insider mapping is the documented default.
"""

from typing import get_args

from backend.api.schemas.realtime import ScenarioLabel
from backend.evaluation.ground_truth_map import (
    ATTACK_CLASSES,
    CLASS_FAMILY,
    INSIDER_CLASSES,
    SCENARIO_GROUND_TRUTH,
    VERDICT_CLASSES,
)


def test_every_scenario_label_is_mapped():
    assert set(get_args(ScenarioLabel)) <= set(SCENARIO_GROUND_TRUTH)


def test_benign_is_mapped_too():
    assert SCENARIO_GROUND_TRUTH["BENIGN"].expected == "benign"


def test_every_mapped_class_is_a_verdict_class():
    for label, truth in SCENARIO_GROUND_TRUTH.items():
        assert truth.expected in VERDICT_CLASSES, label
        for accepted in truth.accepted:
            assert accepted in VERDICT_CLASSES, label


def test_attack_and_insider_sets_are_verdict_classes():
    assert ATTACK_CLASSES <= set(VERDICT_CLASSES)
    assert INSIDER_CLASSES <= set(VERDICT_CLASSES)
    assert len(ATTACK_CLASSES) == 6


def test_ambiguous_is_never_a_mapped_expected_class():
    assert all(truth.expected != "ambiguous" for truth in SCENARIO_GROUND_TRUTH.values())


def test_family_covers_every_non_ambiguous_class():
    assert set(CLASS_FAMILY) == set(VERDICT_CLASSES) - {"ambiguous"}


def test_documented_default_mapping():
    expected = {
        "DDoS": ("ddos", ()),
        "Portscan": ("port_scan", ()),
        "FTP-Patator": ("brute_force", ()),
        "SSH-Patator": ("brute_force", ()),
        "Botnet": ("botnet_c2", ()),
        "BENIGN": ("benign", ()),
        "insider_scenario_1": ("insider_logon_anomaly", ("insider_file_exfiltration",)),
        "insider_scenario_2": ("insider_file_exfiltration", ("insider_logon_anomaly",)),
        "insider_scenario_3": ("insider_logon_anomaly", ("insider_file_exfiltration",)),
    }
    actual = {label: (t.expected, t.accepted) for label, t in SCENARIO_GROUND_TRUTH.items()}
    assert actual == expected
