"""Investigation list and detail (plan sections 2.4 to 2.6, 3.4), and the agent read endpoints (plan 2.8, 3.4)
including the fleet and credibility history.
"""

import uuid

from fastapi.testclient import TestClient

from backend.agents import access_log, endpoint_behavior, llm_clients, network_traffic
from backend.api.main import app
from backend.api.routes.investigations import DATASET_BY_AGENT, matched_keywords, stance_of
from backend.tests.fixtures.read_seed import (
    add_action,
    add_credibility,
    add_investigation,
    add_raw,
    add_transcript,
    ago,
    audit,
    bearer_for,
    cite,
    clear_crs_keys,
    set_quarantine,
)

client = TestClient(app)
SECRET_LABEL = "DDoS"


def test_stance_is_the_first_token_or_null():
    assert stance_of("CHALLENGE: the flow bytes disagree") == "CHALLENGE"
    assert stance_of("SUPPORT the peer's scan finding") == "SUPPORT"
    assert stance_of("  REVISE my confidence downward") == "REVISE"
    assert stance_of("challenge: lower case is not a stance") is None
    assert stance_of("CHALLENGES everything") is None
    assert stance_of("I think this is a scan") is None


def test_matched_keywords_come_from_the_classifier_table():
    theory = "a brute force run with repeated patator logins"
    assert matched_keywords(theory, "brute_force") == ["brute force", "patator"]
    assert matched_keywords(theory, "unclassified") == []


def test_list_shape_filters_and_no_scenario_label(db_session):
    a = add_investigation(
        db_session,
        status="verdict_reached",
        verdict_class="ddos",
        confidence=0.9,
        scenario_label=SECRET_LABEL,
        primary_agent="network_traffic",
        created_at=ago(hours=3),
    )
    b = add_investigation(
        db_session,
        status="contained",
        verdict_class="insider_logon_anomaly",
        confidence=0.7,
        scenario_label="insider_scenario_1",
        primary_agent="endpoint_behavior",
        trigger_type="continuous",
        created_at=ago(hours=1),
    )
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    body = client.get("/investigations", headers=headers).json()

    assert [i["investigation_id"] for i in body] == [str(b.investigation_id), str(a.investigation_id)]
    first = body[0]
    assert set(first) == {
        "investigation_id",
        "trigger_type",
        "status",
        "verdict_class",
        "verdict_confidence",
        "primary_agent",
        "dataset",
        "noise_pct",
        "rounds_complete",
        "containment_count",
        "data_source",
        "created_at",
    }
    assert first["dataset"] == "CERT r4.2"
    text = client.get("/investigations", headers=headers).text
    assert "scenario_label" not in text
    assert "insider_scenario_1" not in text
    assert SECRET_LABEL not in text

    assert [i["status"] for i in client.get("/investigations?status=contained", headers=headers).json()] == [
        "contained"
    ]
    assert [
        i["verdict_class"] for i in client.get("/investigations?verdict_class=ddos", headers=headers).json()
    ] == ["ddos"]
    assert [
        i["investigation_id"]
        for i in client.get("/investigations?primary_agent=network_traffic", headers=headers).json()
    ] == [str(a.investigation_id)]
    assert [
        i["trigger_type"]
        for i in client.get("/investigations?trigger_type=continuous", headers=headers).json()
    ] == ["continuous"]


def test_search_q_matches_id_prefix_verdict_and_trigger(db_session):
    a = add_investigation(db_session, verdict_class="botnet_c2", trigger_type="manual")
    add_investigation(db_session, verdict_class="benign", trigger_type="continuous")
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    by_prefix = client.get(f"/investigations?q={str(a.investigation_id)[:8]}", headers=headers).json()
    by_verdict = client.get("/investigations?q=botnet", headers=headers).json()
    by_trigger = client.get("/investigations?q=continuous", headers=headers).json()
    by_wildcard = client.get("/investigations?q=%25", headers=headers).json()

    assert [i["investigation_id"] for i in by_prefix] == [str(a.investigation_id)]
    assert [i["verdict_class"] for i in by_verdict] == ["botnet_c2"]
    assert [i["trigger_type"] for i in by_trigger] == ["continuous"]
    assert by_wildcard == []


def test_list_validates_paging(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.get("/investigations?limit=0", headers=headers).status_code == 422
    assert client.get("/investigations?limit=201", headers=headers).status_code == 422
    assert client.get("/investigations?offset=-1", headers=headers).status_code == 422


def test_rounds_complete_and_containment_count(db_session):
    inv = add_investigation(db_session)
    for agent in ("network_traffic", "access_log", "endpoint_behavior"):
        add_transcript(db_session, inv.investigation_id, round_no=1, agent_id=agent, theory="SUPPORT x")
    add_transcript(
        db_session, inv.investigation_id, round_no=2, agent_id="network_traffic", theory="SUPPORT y"
    )
    # The engine audits a round only after every active agent answered: round 1 is done, round 2 is not.
    audit(db_session, "debate_engine", "round_completed", {"round": 1}, inv.investigation_id)
    add_action(db_session, inv.investigation_id)
    add_action(db_session, inv.investigation_id, action_type="trigger_audit")
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    summary = client.get("/investigations", headers=headers).json()[0]
    detail = client.get(f"/investigations/{inv.investigation_id}", headers=headers).json()

    assert summary["rounds_complete"] == 1
    assert summary["containment_count"] == 2
    assert detail["rounds_complete"] == 1
    assert len(detail["actions"]) == 2
    assert all(a["is_simulated"] is True and a["id"] for a in detail["actions"])


def test_detail_reports_how_each_agents_rows_were_chosen(db_session):
    inv = add_investigation(db_session)
    basis = {
        "network_traffic": {"basis": "scenario_rows", "row_count": 5},
        "access_log": {"basis": "same_user_window", "row_count": 2},
    }
    audit(
        db_session,
        "debate_engine",
        "round_completed",
        {"round": 1, "input_basis": basis},
        inv.investigation_id,
    )
    audit(db_session, "debate_engine", "round_completed", {"round": 2}, inv.investigation_id)
    db_session.commit()

    detail = client.get(
        f"/investigations/{inv.investigation_id}", headers=bearer_for("forensic_analyst")
    ).json()

    assert detail["input_basis"] == basis


def test_detail_has_no_input_basis_for_an_investigation_that_predates_the_record(db_session):
    inv = add_investigation(db_session)
    audit(db_session, "debate_engine", "round_completed", {"round": 1}, inv.investigation_id)
    db_session.commit()

    detail = client.get(
        f"/investigations/{inv.investigation_id}", headers=bearer_for("forensic_analyst")
    ).json()

    assert detail["input_basis"] == {}


def test_dataset_mapping_is_per_primary_agent():
    assert DATASET_BY_AGENT == {
        "network_traffic": "CICIDS2017",
        "access_log": "CERT r4.2",
        "endpoint_behavior": "CERT r4.2",
    }


def test_detail_has_stance_provider_votes_and_citation_summary(db_session):
    inv = add_investigation(db_session, status="verdict_reached", verdict_class="brute_force", confidence=0.8)
    row = add_raw(db_session, raw_fields={"Destination Port": 22})
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="network_traffic",
        theory="CHALLENGE: a brute force run with patator logins",
        cited=[cite(row, "Destination Port", "22"), cite(row, "Destination Port", "99")],
        provider="groq",
    )
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=3,
        agent_id="network_traffic",
        theory="SUPPORT: brute force persists",
        cited=[cite(row, "Destination Port", "22")],
        provider="groq",
    )
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="endpoint_behavior",
        theory="a logon pattern was observed",
        cited=[cite(row, "Destination Port", "22")],
        provider="gemini",
    )
    db_session.commit()

    detail = client.get(
        f"/investigations/{inv.investigation_id}", headers=bearer_for("forensic_analyst")
    ).json()

    stances = [(d["round"], d["agent_id"], d["stance"], d["provider"]) for d in detail["debate"]]
    assert stances == [
        (1, "endpoint_behavior", None, "gemini"),
        (1, "network_traffic", "CHALLENGE", "groq"),
        (3, "network_traffic", "SUPPORT", "groq"),
    ]
    votes = {v["agent_id"]: v for v in detail["votes"]}
    assert votes["network_traffic"]["round"] == 3
    assert votes["network_traffic"]["vote_class"] == "brute_force"
    assert votes["endpoint_behavior"]["vote_class"] == "unclassified"
    assert votes["endpoint_behavior"]["matched_keywords"] == []
    assert detail["citations"]["total"] == 4
    assert detail["citations"]["verified"] == 3
    assert detail["citations"]["match_rate"]["value"] == 0.75
    assert "scenario_label" not in str(detail)


def test_unknown_investigation_detail_is_404(db_session):
    resp = client.get(f"/investigations/{uuid.uuid4()}", headers=bearer_for("forensic_analyst"))
    assert resp.status_code == 404


def test_fleet_has_exactly_the_three_investigators(db_session):
    clear_crs_keys()
    fleet = client.get("/agents/fleet", headers=bearer_for("forensic_analyst")).json()

    assert [a["agent_id"] for a in fleet] == ["network_traffic", "access_log", "endpoint_behavior"]


def test_fleet_signals_are_in_the_agent_prompts(db_session):
    clear_crs_keys()
    prompts = {
        "network_traffic": network_traffic.SYSTEM_PROMPT,
        "access_log": access_log.SYSTEM_PROMPT,
        "endpoint_behavior": endpoint_behavior.SYSTEM_PROMPT,
    }
    fleet = {
        a["agent_id"]: a for a in client.get("/agents/fleet", headers=bearer_for("forensic_analyst")).json()
    }

    for agent_id, prompt in prompts.items():
        assert fleet[agent_id]["signals"], agent_id
        for signal in fleet[agent_id]["signals"]:
            assert signal in prompt, (agent_id, signal)


def test_fleet_provider_chain_and_model_come_from_source(db_session):
    clear_crs_keys()
    fleet = {
        a["agent_id"]: a for a in client.get("/agents/fleet", headers=bearer_for("forensic_analyst")).json()
    }

    assert fleet["network_traffic"]["provider_chain"] == ["groq", "gemini"]
    assert fleet["access_log"]["provider_chain"] == ["groq", "gemini"]
    assert fleet["endpoint_behavior"]["provider_chain"] == ["gemini", "groq"]
    assert fleet["network_traffic"]["model"] == llm_clients.GROQ_MODEL
    assert fleet["endpoint_behavior"]["model"] == llm_clients.GEMINI_MODEL


def test_fleet_temperature_is_read_from_the_client_source(db_session):
    clear_crs_keys()
    fleet = client.get("/agents/fleet", headers=bearer_for("forensic_analyst")).json()

    temperature = fleet[0]["temperature"]
    assert temperature["value"] == 0.2
    assert temperature["n"] == 2
    assert temperature["reason"] is None


def test_fleet_crs_starts_neutral_with_a_reason_and_isolation_reads_quarantine(db_session):
    clear_crs_keys()
    set_quarantine(db_session, "access_log", True)
    db_session.commit()

    fleet = {
        a["agent_id"]: a for a in client.get("/agents/fleet", headers=bearer_for("forensic_analyst")).json()
    }

    assert fleet["network_traffic"]["crs"]["value"] == 0.5
    assert fleet["network_traffic"]["crs"]["n"] == 0
    assert fleet["network_traffic"]["crs"]["reason"] == "starting value; no rounds scored yet"
    assert fleet["access_log"]["isolated"] is True
    assert fleet["network_traffic"]["isolated"] is False
    assert fleet["network_traffic"]["invalid_rate"]["value"] is None
    assert fleet["network_traffic"]["invalid_rate"]["reason"] == "no citations yet"
    assert fleet["network_traffic"]["rounds_scored"]["value"] == 0
    assert fleet["network_traffic"]["last_vote"] is None


def test_fleet_counts_and_last_vote_from_the_agent_transcripts(db_session):
    clear_crs_keys()
    inv = add_investigation(db_session)
    row = add_raw(db_session, raw_fields={"Destination Port": 80})
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="network_traffic",
        theory="SUPPORT: ddos flood on port 80",
        cited=[cite(row, "Destination Port", "80"), cite(row, "Destination Port", "81")],
    )
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=2,
        agent_id="network_traffic",
        theory="SUPPORT: volumetric flood continues",
        cited=[cite(row, "Destination Port", "80")],
    )
    add_credibility(
        db_session,
        inv.investigation_id,
        agent_id="network_traffic",
        round_no=1,
        before=0.5,
        after=0.6,
        rate=0.5,
    )
    db_session.commit()

    nt = {
        a["agent_id"]: a for a in client.get("/agents/fleet", headers=bearer_for("forensic_analyst")).json()
    }["network_traffic"]

    assert nt["citations_total"]["value"] == 3
    assert nt["citations_verified"]["value"] == 2
    assert nt["invalid_rate"]["value"] == 1 / 3
    assert nt["rounds_scored"]["value"] == 1
    assert nt["last_vote"] == "ddos"


def test_credibility_history_is_the_latest_points_oldest_first(db_session):
    inv = add_investigation(db_session)
    for hours, round_no in ((3, 1), (2, 2), (1, 3)):
        add_credibility(
            db_session,
            inv.investigation_id,
            agent_id="access_log",
            round_no=round_no,
            before=0.5,
            after=0.5 + round_no / 10,
            rate=1.0,
            created_at=ago(hours=hours),
        )
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    points = client.get("/agents/access_log/credibility-history?limit=2", headers=headers).json()
    since = client.get(
        "/agents/access_log/credibility-history",
        params={"since": ago(hours=1, minutes=30).isoformat()},
        headers=headers,
    ).json()

    assert [p["round"] for p in points] == [2, 3]
    assert [p["round"] for p in since] == [3]
    assert set(points[0]) >= {
        "investigation_id",
        "round",
        "crs_before",
        "crs_after",
        "verification_match_rate",
    }


def test_credibility_history_rejects_unknown_agents(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.get("/agents/nobody/credibility-history", headers=headers).status_code == 404
    assert client.get("/agents/access_log/credibility-history?limit=0", headers=headers).status_code == 422
