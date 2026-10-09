"""The label-to-class mapping (plan section 3.4 and 8, item 7). Every scenario label is mapped, every mapped
class is a real verdict class, and the insider rows match the event types in the CERT r4.2 answer files.
"""

import csv
import datetime as dt
from collections import Counter
from typing import get_args

import pytest

from backend.api.schemas.realtime import ScenarioLabel
from backend.evaluation.ground_truth_map import (
    ATTACK_CLASSES,
    CLASS_FAMILY,
    INSIDER_CLASSES,
    SCENARIO_GROUND_TRUTH,
    VERDICT_CLASSES,
)
from backend.pipeline.cert_ground_truth import ANSWERS_DIR


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


def test_documented_mapping():
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


def _answer_events(scenario: int) -> list[list[str]]:
    rows: list[list[str]] = []
    for path in sorted((ANSWERS_DIR / f"r4.2-{scenario}").glob(f"r4.2-{scenario}-*.csv")):
        with open(path, newline="", encoding="utf-8") as handle:
            rows.extend(row for row in csv.reader(handle) if row)
    return rows


@pytest.mark.skipif(not ANSWERS_DIR.is_dir(), reason="the CERT r4.2 answer files are not in this checkout")
def test_insider_rows_follow_the_event_types_in_the_cert_answer_files():
    """The evidence for the insider rows (ground_truth_map.py docstring): what each scenario's insiders do."""
    kinds = {scenario: Counter(row[0] for row in _answer_events(scenario)) for scenario in (1, 2, 3)}

    assert set(kinds[1]) == {"logon", "device", "http"}
    assert set(kinds[2]) == {"http", "email", "device"}  # no logon events: the footprint is the drive use
    assert set(kinds[3]) == {"logon", "device", "file", "email", "http"}
    assert kinds[3]["file"] > 0 and kinds[1]["file"] == kinds[2]["file"] == 0

    logons = [
        dt.datetime.strptime(row[2], "%m/%d/%Y %H:%M:%S") for row in _answer_events(1) if row[0] == "logon"
    ]
    off_hours = sum(1 for stamp in logons if stamp.hour < 7 or stamp.hour >= 19)
    assert off_hours / len(logons) > 0.9  # scenario 1 is mostly logons outside working hours
    assert SCENARIO_GROUND_TRUTH["insider_scenario_1"].expected == "insider_logon_anomaly"
    assert SCENARIO_GROUND_TRUTH["insider_scenario_2"].expected == "insider_file_exfiltration"
