"""Pure accuracy arithmetic (backend/evaluation/metrics.py). No DB: these pin the definitions."""

import pytest

from backend.evaluation.metrics import NOISE_LEVELS, LabelledVerdict, evaluate


def _v(label, verdict, noise=0, status="verdict_reached"):
    return LabelledVerdict(scenario_label=label, verdict_class=verdict, status=status, noise_pct=noise)


def test_empty_input_gives_null_rates_with_reasons():
    ev = evaluate([])

    assert ev.scored == 0
    assert ev.accuracy.value is None
    assert ev.accuracy.n == 0
    assert ev.accuracy.reason == "no labelled verdicts yet"
    assert all(scores.precision.value is None for scores in ev.per_class)
    assert ev.confusion == {}


def test_exact_acceptable_family_and_abstention():
    verdicts = [
        _v("DDoS", "ddos"),  # exact
        _v("Portscan", "brute_force"),  # wrong, network family
        _v("insider_scenario_1", "insider_logon_anomaly"),  # exact
        _v("insider_scenario_1", "insider_file_exfiltration"),  # accepted alternative, insider family
        _v("insider_scenario_2", "ambiguous"),  # abstained: never correct
        _v("Botnet", "benign"),  # wrong, benign family
    ]

    ev = evaluate(verdicts)

    assert ev.scored == 6
    assert ev.accuracy.value == pytest.approx(2 / 6)
    assert ev.acceptable_accuracy.value == pytest.approx(3 / 6)
    assert ev.family_accuracy.value == pytest.approx(4 / 6)  # Portscan->brute_force is in the network family
    assert ev.abstain_rate.value == pytest.approx(1 / 6)
    assert ev.accuracy.n == 6


def test_status_ambiguous_is_an_abstention_even_with_a_class():
    ev = evaluate([_v("DDoS", "ddos", status="ambiguous")])

    assert ev.accuracy.value == 0.0
    assert ev.abstain_rate.value == 1.0


def test_per_class_precision_recall_and_f1():
    verdicts = [
        _v("DDoS", "ddos"),  # TP for ddos
        _v("DDoS", "port_scan"),  # actual ddos, predicted port_scan
        _v("Portscan", "port_scan"),  # TP for port_scan
        _v("Botnet", "port_scan"),  # FP for port_scan
    ]

    ev = evaluate(verdicts)
    scores = {s.verdict_class: s for s in ev.per_class}

    assert scores["port_scan"].precision.value == pytest.approx(1 / 3)  # TP 1 of 3 predicted port_scan
    assert scores["port_scan"].precision.n == 3
    assert scores["port_scan"].recall.value == pytest.approx(1 / 1)  # TP 1 of 1 expected port_scan
    assert scores["port_scan"].f1.value == pytest.approx(2 * 1 / (3 + 1))  # 2TP / (predicted + expected)
    assert scores["ddos"].recall.value == pytest.approx(1 / 2)
    assert scores["ddos"].precision.value == pytest.approx(1.0)
    assert scores["benign"].precision.value is None
    assert "no investigation was given the verdict benign" in scores["benign"].precision.reason


def test_confusion_counts_and_unclassified_column():
    verdicts = [_v("DDoS", "ddos"), _v("DDoS", "ddos"), _v("DDoS", "benign")]

    ev = evaluate(verdicts)

    assert ev.confusion[("ddos", "ddos")] == 2
    assert ev.confusion[("ddos", "benign")] == 1
    assert ev.confusion.get(("ddos", "port_scan"), 0) == 0


def test_by_noise_groups_every_level():
    verdicts = [_v("DDoS", "ddos", noise=0), _v("DDoS", "benign", noise=30)]

    ev = evaluate(verdicts)

    assert set(ev.by_noise) == set(NOISE_LEVELS)
    assert ev.by_noise[0]["accuracy"].value == 1.0
    assert ev.by_noise[30]["accuracy"].value == 0.0
    assert ev.by_noise[15]["accuracy"].value is None
    assert ev.by_noise[15]["accuracy"].n == 0
