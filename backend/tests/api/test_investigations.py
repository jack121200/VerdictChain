import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.db.models import Investigation, RawLog
from backend.db.session import SessionLocal

client = TestClient(app)


def _auth_headers() -> dict:
    username = f"test_user_{uuid.uuid4().hex[:8]}"
    password = "a_strong_password_123"
    client.post("/auth/register", json={"username": username, "password": password})
    token = client.post("/auth/login", json={"username": username, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_simulate_scenario_returns_404_for_unknown_scenario(db_session):
    headers = _auth_headers()
    resp = client.post("/investigations/simulate", json={"scenario_label": "DDoS"}, headers=headers)
    assert resp.status_code == 404  # no DDoS rows seeded in this clean test DB


def test_simulate_scenario_runs_debate_and_returns_verdict(db_session, monkeypatch):
    row = RawLog(
        timestamp=datetime.now(timezone.utc),
        source="cicids2017",
        event_type="network_flow",
        raw_fields={"Destination Port": 445},
        ground_truth_label="DDoS",
    )
    db_session.add(row)
    db_session.commit()

    def fake_run_debate(*args, **kwargs):
        return {
            "investigation_id": str(uuid.uuid4()),
            "verdict": {"verdict_class": "ddos", "verdict_confidence": 0.9, "status": "verdict_reached"},
            "providers_used": {},
            "actions_taken": [],
        }

    monkeypatch.setattr("backend.api.routes.investigations.run_debate", fake_run_debate)

    headers = _auth_headers()
    resp = client.post("/investigations/simulate", json={"scenario_label": "DDoS"}, headers=headers)
    assert resp.status_code == 201
    assert resp.json()["verdict"]["verdict_class"] == "ddos"


def test_simulate_scenario_returns_502_when_debate_fails(db_session, monkeypatch):
    from backend.debate.engine import DebateFailedError

    row = RawLog(
        timestamp=datetime.now(timezone.utc),
        source="cicids2017",
        event_type="network_flow",
        raw_fields={},
        ground_truth_label="DDoS",
    )
    db_session.add(row)
    db_session.commit()

    def failing_run_debate(*args, **kwargs):
        raise DebateFailedError("some-id", "all providers exhausted")

    monkeypatch.setattr("backend.api.routes.investigations.run_debate", failing_run_debate)

    headers = _auth_headers()
    resp = client.post("/investigations/simulate", json={"scenario_label": "DDoS"}, headers=headers)
    assert resp.status_code == 502
    assert "all providers exhausted" in resp.json()["detail"]


def test_list_and_get_investigation(db_session):
    session = SessionLocal()
    try:
        inv = Investigation(trigger_type="manual", status="verdict_reached", verdict_class="ddos", verdict_confidence=0.9)
        session.add(inv)
        session.commit()
        session.refresh(inv)
        inv_id = inv.investigation_id
    finally:
        session.close()

    headers = _auth_headers()

    list_resp = client.get("/investigations", headers=headers)
    assert list_resp.status_code == 200
    assert any(i["investigation_id"] == str(inv_id) for i in list_resp.json())

    detail_resp = client.get(f"/investigations/{inv_id}", headers=headers)
    assert detail_resp.status_code == 200
    assert detail_resp.json()["verdict_class"] == "ddos"
    assert detail_resp.json()["debate"] == []


def test_get_investigation_404_for_unknown_id(db_session):
    headers = _auth_headers()
    resp = client.get(f"/investigations/{uuid.uuid4()}", headers=headers)
    assert resp.status_code == 404


def test_submit_feedback(db_session):
    session = SessionLocal()
    try:
        inv = Investigation(trigger_type="manual")
        session.add(inv)
        session.commit()
        session.refresh(inv)
        inv_id = inv.investigation_id
    finally:
        session.close()

    headers = _auth_headers()
    resp = client.post(f"/investigations/{inv_id}/feedback", json={"verdict_was_correct": True}, headers=headers)
    assert resp.status_code == 204


def test_agent_fleet_returns_all_three_agents(db_session):
    headers = _auth_headers()
    resp = client.get("/agents/fleet", headers=headers)
    assert resp.status_code == 200
    agent_ids = {a["agent_id"] for a in resp.json()}
    assert agent_ids == {"network_traffic", "access_log", "endpoint_behavior"}
