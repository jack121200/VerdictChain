"""GET /scenarios (plan section 3.4): the eight labels, their dataset, the agent domain their rows belong to,
and real row counts (0 is a real count). The label is for analysts only.
"""

from collections import Counter
from typing import get_args

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.routes.scenarios import dominant_agent
from backend.api.schemas.realtime import ScenarioLabel
from backend.tests.fixtures.read_seed import add_raw, bearer_for

client = TestClient(app)


def _by_label(headers) -> dict:
    resp = client.get("/scenarios", headers=headers)
    assert resp.status_code == 200
    return {s["label"]: s for s in resp.json()}


def test_lists_exactly_the_eight_scenario_labels(db_session):
    scenarios = _by_label(bearer_for("forensic_analyst"))

    assert set(scenarios) == set(get_args(ScenarioLabel))
    assert len(scenarios) == 8


def test_dataset_and_row_counts_come_from_raw_logs(db_session):
    for _ in range(3):
        add_raw(db_session, source="cicids2017", event_type="network_flow", label="DDoS")
    add_raw(db_session, source="cicids2017", event_type="network_flow", label="Botnet")
    db_session.commit()

    scenarios = _by_label(bearer_for("forensic_analyst"))

    assert scenarios["DDoS"]["dataset"] == "CICIDS2017"
    assert scenarios["DDoS"]["row_count"]["value"] == 3
    assert scenarios["DDoS"]["row_count"]["n"] == 3
    assert scenarios["Portscan"]["row_count"]["value"] == 0
    assert scenarios["Portscan"]["row_count"]["reason"] is None
    assert scenarios["insider_scenario_1"]["dataset"] == "CERT r4.2"


def test_primary_agent_is_the_domain_the_rows_belong_to(db_session):
    add_raw(db_session, source="cicids2017", event_type="network_flow", label="DDoS")
    for _ in range(2):
        add_raw(db_session, source="cert_r4.2_logon", event_type="logon", label="insider_scenario_1")
    add_raw(db_session, source="cert_r4.2_device", event_type="device_event", label="insider_scenario_1")
    add_raw(db_session, source="cert_r4.2_file", event_type="file_access", label="insider_scenario_2")
    add_raw(db_session, source="cert_r4.2_file", event_type="file_access", label="insider_scenario_3")
    add_raw(db_session, source="cert_r4.2_logon", event_type="logon", label="insider_scenario_3")
    db_session.commit()

    scenarios = _by_label(bearer_for("forensic_analyst"))

    assert scenarios["DDoS"]["primary_agent"] == "network_traffic"
    assert scenarios["insider_scenario_1"]["primary_agent"] == "endpoint_behavior"
    assert scenarios["insider_scenario_2"]["primary_agent"] == "access_log"
    # A tie (one file row, one logon row) goes to access_log, the earlier agent in the tie order.
    assert scenarios["insider_scenario_3"]["primary_agent"] == "access_log"
    assert scenarios["Portscan"]["primary_agent"] is None


def test_dominant_agent_tie_order():
    assert dominant_agent(Counter()) is None
    assert dominant_agent(Counter({"network_flow": 2})) == "network_traffic"
    assert dominant_agent(Counter({"file_access": 1, "logon": 1})) == "access_log"
    assert dominant_agent(Counter({"logon": 1, "device_event": 1})) == "endpoint_behavior"


def test_benign_rows_are_not_a_scenario(db_session):
    add_raw(db_session, source="cicids2017", event_type="network_flow", label="BENIGN")
    db_session.commit()

    labels = set(_by_label(bearer_for("forensic_analyst")))

    assert "BENIGN" not in labels
