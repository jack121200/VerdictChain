"""GET /evaluation (plan section 3.4): labelled investigations only, mapped classes, abstentions never
correct, every number a Metric with its n, and the source of the insider mapping stated.
"""

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.tests.fixtures.read_seed import add_investigation, bearer_for

client = TestClient(app)


def _get(headers=None) -> dict:
    resp = client.get("/evaluation", headers=headers or bearer_for("forensic_analyst"))
    assert resp.status_code == 200
    return resp.json()


def test_empty_database_gives_null_rates_with_reasons(db_session):
    body = _get()

    assert body["labelled"]["value"] == 0
    assert body["scored"]["value"] == 0
    for key in ("accuracy", "acceptable_accuracy", "family_accuracy", "abstain_rate"):
        assert body[key]["value"] is None, key
        assert body[key]["reason"], key
    assert all(c["precision"]["value"] is None and c["precision"]["reason"] for c in body["per_class"])
    assert [g["noise_pct"] for g in body["by_noise"]] == [0, 15, 30]
    assert len(body["mapping"]) == 9
    assert "CERT r4.2 answer files" in body["mapping_status"]


def test_scores_only_labelled_verdicts_with_the_mapping(db_session):
    add_investigation(db_session, scenario_label="DDoS", verdict_class="ddos", confidence=0.9, noise_pct=0)
    add_investigation(
        db_session, scenario_label="DDoS", verdict_class="port_scan", confidence=0.8, noise_pct=15
    )
    add_investigation(
        db_session,
        scenario_label="insider_scenario_1",
        verdict_class="insider_file_exfiltration",
        confidence=0.7,
        noise_pct=30,
        primary_agent="access_log",
    )
    add_investigation(
        db_session,
        scenario_label="insider_scenario_2",
        status="ambiguous",
        verdict_class="ambiguous",
        confidence=0.5,
        noise_pct=30,
    )
    add_investigation(
        db_session, scenario_label="Botnet", status="investigating", verdict_class=None, confidence=None
    )
    add_investigation(db_session, scenario_label=None, verdict_class="ddos", confidence=0.9)
    db_session.commit()

    body = _get()

    assert body["labelled"]["value"] == 5
    assert body["labelled"]["n"] == 5
    assert body["scored"]["value"] == 4
    assert body["scored"]["n"] == 4
    assert body["accuracy"]["value"] == pytest.approx(1 / 4)  # only the DDoS->ddos is exact
    assert body["acceptable_accuracy"]["value"] == pytest.approx(2 / 4)  # plus insider_1's accepted class
    assert body["family_accuracy"]["value"] == pytest.approx(3 / 4)  # DDoS->port_scan is the same family
    assert body["abstain_rate"]["value"] == pytest.approx(1 / 4)
    assert body["accuracy"]["n"] == 4
    assert "ambiguous counts as wrong" in body["accuracy"]["definition"]
    assert "also accept the other insider class" in body["accuracy"]["definition"]


def test_per_class_and_confusion_matrix(db_session):
    add_investigation(db_session, scenario_label="DDoS", verdict_class="ddos", confidence=0.9)
    add_investigation(db_session, scenario_label="DDoS", verdict_class="port_scan", confidence=0.8)
    db_session.commit()

    body = _get()
    per_class = {c["verdict_class"]: c for c in body["per_class"]}
    cells = {(c["actual"], c["predicted"]): c["count"] for c in body["confusion_matrix"]["cells"]}

    assert per_class["ddos"]["precision"]["value"] == 1.0
    assert per_class["ddos"]["recall"]["value"] == pytest.approx(1 / 2)
    assert per_class["ddos"]["f1"]["value"] == pytest.approx(2 * 1 / (1 + 2))
    assert cells[("ddos", "ddos")]["value"] == 1
    assert cells[("ddos", "port_scan")]["value"] == 1
    assert cells[("ddos", "port_scan")]["n"] == 2
    assert "unclassified" in body["confusion_matrix"]["cols"]
    assert "ambiguous" not in body["confusion_matrix"]["rows"]


def test_by_noise_groups_are_separate_metrics(db_session):
    add_investigation(db_session, scenario_label="DDoS", verdict_class="ddos", confidence=0.9, noise_pct=0)
    add_investigation(db_session, scenario_label="DDoS", verdict_class="benign", confidence=0.4, noise_pct=30)
    db_session.commit()

    groups = {g["noise_pct"]: g for g in _get()["by_noise"]}

    assert groups[0]["accuracy"]["value"] == 1.0
    assert groups[30]["accuracy"]["value"] == 0.0
    assert groups[15]["accuracy"]["value"] is None
    assert groups[15]["accuracy"]["reason"]


def test_mapping_table_is_exposed(db_session):
    mapping = {m["scenario_label"]: m for m in _get()["mapping"]}

    assert mapping["insider_scenario_1"]["expected_class"] == "insider_logon_anomaly"
    assert mapping["insider_scenario_1"]["accepted_classes"] == ["insider_file_exfiltration"]
    assert mapping["SSH-Patator"]["expected_class"] == "brute_force"
    assert mapping["BENIGN"]["expected_class"] == "benign"
