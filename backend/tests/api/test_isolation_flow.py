"""Isolation end to end through the HTTP API (checklist LG1 and LG9).

Only the LLM call is stubbed: backend/scripts/e2e_server.py in fabricate mode makes one investigator cite
real rows with values that do not match them, the way a hallucinating model would. The investigator agents,
the debate engine, the Watchdog's verification, CrS in Redis, quarantine, self-healing and the audit chain
are the real code, driven through POST /investigations/simulate.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from backend.api.main import app
from backend.api.rate_limit import get_redis
from backend.db.audit import verify_chain
from backend.db.models import AuditTrail
from backend.db.session import SessionLocal
from backend.scripts import e2e_server as stub
from backend.tests.fixtures.auth import auth_headers
from backend.watchdog.credibility import get_crs, reset_agent

client = TestClient(app)
AGENTS = ("network_traffic", "access_log", "endpoint_behavior")
HALLUCINATOR = "access_log"
HONEST = ("network_traffic", "endpoint_behavior")


def _clear_state() -> None:
    redis_client = get_redis()
    redis_client.delete("verdictchain:debate:slot")
    for key in redis_client.scan_iter("verdictchain:cap:*"):
        redis_client.delete(key)
    for agent in AGENTS:
        reset_agent(agent)


@pytest.fixture(autouse=True)
def stubbed_llm():
    _clear_state()
    stub.install()
    yield
    stub.uninstall()  # also switches fabricate mode off
    _clear_state()


def _seed(db_session) -> None:
    """A DDoS scenario for the network agent plus rows the two CERT agents can cite."""
    network = stub.sample_rows("network_traffic")
    for row in network:
        row.ground_truth_label = "DDoS"
    others = stub.sample_rows("access_log") + stub.sample_rows("endpoint_behavior")
    for row in others:
        row.ground_truth_label = "BENIGN"
    db_session.add_all(network + others)
    db_session.commit()


def _simulate(headers) -> str:
    response = client.post("/investigations/simulate", json={"scenario_label": "DDoS"}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["investigation_id"]


def _detail(headers, investigation_id: str) -> dict:
    return client.get(f"/investigations/{investigation_id}", headers=headers).json()


def _scored(detail: dict) -> dict[str, list[dict]]:
    return {agent: [c for c in detail["credibility"] if c["agent_id"] == agent] for agent in AGENTS}


def _audit_details(action: str) -> list[dict]:
    with SessionLocal() as session:
        rows = session.execute(select(AuditTrail).where(AuditTrail.action == action).order_by(AuditTrail.seq))
        return [row.detail for row in rows.scalars().all()]


def _chain_is_valid() -> bool:
    with SessionLocal() as session:
        return verify_chain(session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all())


def test_a_hallucinating_agent_is_isolated_when_round_three_is_scored_then_restored(db_session):
    _seed(db_session)
    lead = auth_headers("secops_lead")
    stub.set_fabricate([HALLUCINATOR])

    # ---- debate 1: access_log cites wrong values in every round --------------------------------------
    first = _simulate(lead)
    detail = _detail(lead, first)
    scored = _scored(detail)

    bad = scored[HALLUCINATOR]
    assert [round(c["crs_after"], 3) for c in bad] == [0.4, 0.32, 0.256]  # 0.5 * 0.8 each failing round
    assert [c["isolated"] for c in bad] == [False, False, True]  # crosses 0.30 only at round 3
    assert all(c["verification_match_rate"] == 0.0 for c in bad)
    for agent in HONEST:
        assert [round(c["crs_after"], 3) for c in scored[agent]] == [0.6, 0.72, 0.864]
        assert all(c["verification_match_rate"] == 1.0 and not c["isolated"] for c in scored[agent])

    assert detail["rounds_complete"] == 3
    assert len(detail["debate"]) == 9  # the isolated agent still spoke in all three rounds
    assert detail["citations"]["total"] == 18 and detail["citations"]["discrepancy"] == 6
    # Its last transcript is shown but not counted, because the engine left it out of the verdict.
    assert {v["agent_id"]: v["counted"] for v in detail["votes"]} == {
        "network_traffic": True,
        "access_log": False,
        "endpoint_behavior": True,
    }
    (verdict_entry,) = _audit_details("verdict_reached")
    assert verdict_entry["verdict_class"] == "ddos"
    assert HALLUCINATOR not in verdict_entry["contributing_agents"]

    # ---- the isolation is real, persistent and audited ------------------------------------------------
    fleet = {entry["agent_id"]: entry for entry in client.get("/agents/fleet", headers=lead).json()}
    assert fleet[HALLUCINATOR]["isolated"] is True
    assert fleet[HALLUCINATOR]["crs"]["value"] == pytest.approx(0.256)
    assert not fleet["network_traffic"]["isolated"] and not fleet["endpoint_behavior"]["isolated"]
    isolated_entries = _audit_details("agent_isolated")
    assert [(d["agent_id"], d["round"]) for d in isolated_entries] == [(HALLUCINATOR, 3)]

    # ---- debate 2 runs without the quarantined agent, and its rounds still count as complete ---------
    second_detail = _detail(lead, _simulate(lead))
    assert {turn["agent_id"] for turn in second_detail["debate"]} == set(HONEST)
    assert second_detail["rounds_complete"] == 3
    assert not _scored(second_detail)[HALLUCINATOR]

    # ---- an analyst restores it (audited), CrS goes back to the starting value ------------------------
    restore = client.post(
        f"/agents/{HALLUCINATOR}/restore", json={"note": "hallucination drill over"}, headers=lead
    )
    assert restore.status_code == 200, restore.text
    assert restore.json()["active"] is False
    assert get_crs(HALLUCINATOR) == 0.5
    restored = _audit_details("agent_restored")
    assert [d["agent_id"] for d in restored] == [HALLUCINATOR]
    fleet = {entry["agent_id"]: entry for entry in client.get("/agents/fleet", headers=lead).json()}
    assert fleet[HALLUCINATOR]["isolated"] is False

    # ---- honest again: debate 3 has all three agents and nobody is isolated ---------------------------
    stub.set_fabricate([])
    third_detail = _detail(lead, _simulate(lead))
    assert len(third_detail["debate"]) == 9
    assert not any(c["isolated"] for c in third_detail["credibility"])
    assert all(v["counted"] for v in third_detail["votes"])

    assert _chain_is_valid()


def test_emergency_containment_leaves_the_isolated_primary_agent_out_of_the_re_derived_verdict(db_session):
    """The network agent holds the DDoS rows (it is the primary agent) and hallucinates, so it is isolated
    at round 3 and the engine's verdict is a tie between the two CERT agents: ambiguous. Re-deriving the
    verdict for a manual containment must give the same answer. Counting the isolated agent would let its
    primary-agent tie-break turn that into a ddos containment the engine never reached."""
    _seed(db_session)
    lead = auth_headers("secops_lead")
    stub.set_fabricate(["network_traffic"])
    investigation_id = _simulate(lead)

    detail = _detail(lead, investigation_id)
    assert (detail["status"], detail["verdict_class"]) == ("ambiguous", "ambiguous")
    assert {v["agent_id"]: v["counted"] for v in detail["votes"]} == {
        "network_traffic": False,
        "access_log": True,
        "endpoint_behavior": True,
    }
    assert detail["actions"] == []

    response = client.post(
        f"/investigations/{investigation_id}/emergency-containment", json={"confirm": True}, headers=lead
    )
    assert response.status_code == 409, response.text
    assert "No containment plan for a 'ambiguous' verdict" in response.json()["detail"]
    assert _detail(lead, investigation_id)["actions"] == []  # nothing was contained
