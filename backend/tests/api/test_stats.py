"""GET /stats (plan sections 2 and 3.4). Empty database: every rate and average is null with a reason,
and every count is a real 0. Seeded database: each KPI matches a value worked out by hand.
"""

import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.api.main import app
from backend.tests.fixtures.read_seed import (
    BASE_TIME,
    add_action,
    add_credibility,
    add_feedback,
    add_investigation,
    add_raw,
    add_transcript,
    ago,
    audit,
    bearer_for,
    cite,
)

client = TestClient(app)


def _stats(role: str = "forensic_analyst") -> dict:
    resp = client.get("/stats", headers=bearer_for(role))
    assert resp.status_code == 200
    return resp.json()


def test_empty_database_nulls_rates_with_reasons_and_counts_are_real_zeros(db_session):
    body = _stats()

    for key in ("active", "stale", "threats_24h", "insider_count", "contained"):
        assert body[key]["value"] == 0, key
        assert body[key]["n"] == 0
        assert body[key]["reason"] is None
    assert body["by_status"]["investigating"]["value"] == 0
    assert body["mean_agent_confidence"]["value"] is None
    assert body["mean_agent_confidence"]["reason"]
    assert body["citations"]["verified_rate"]["value"] is None
    assert body["citations"]["verified_rate"]["reason"]
    assert body["citations"]["invalid_rate"]["value"] is None
    assert body["citations"]["total"]["value"] == 0
    for key in ("verified", "discrepancy", "invalid_row"):
        assert body["citations"][key]["value"] == 0, key  # counts are real zeros, never null
    # No credibility history yet: every investigator sits at the starting CrS, so the mean is real, n = 3.
    assert body["mean_crs"]["value"] == pytest.approx(0.5)
    assert body["mean_crs"]["n"] == 3
    assert body["chain"]["valid"] is True
    assert body["chain"]["entries"]["value"] == 0
    assert body["chain"]["head_seq"]["value"] is None
    assert body["chain"]["head_seq"]["reason"]
    assert body["self_healing"]["simulated_share"]["value"] is None
    assert body["self_healing"]["simulated_share"]["reason"]
    assert body["self_healing"]["actions_total"]["value"] == 0
    assert body["feedback"]["agreement_rate"]["value"] is None
    assert body["feedback"]["agreement_rate"]["reason"]
    assert body["brier"]["value"] is None
    assert body["brier"]["reason"] == "no analyst feedback yet"
    assert body["latency"]["mean_seconds"]["value"] is None
    assert body["latency"]["mean_seconds"]["reason"]
    assert "generated_at" in body


def test_every_kpi_matches_a_hand_computed_value(db_session):
    row = add_raw(db_session, raw_fields={"Destination Port": 80})
    add_investigation(
        db_session, status="investigating", verdict_class=None, confidence=None, created_at=ago(minutes=5)
    )
    add_investigation(
        db_session, status="investigating", verdict_class=None, confidence=None, created_at=ago(hours=2)
    )
    ddos = add_investigation(
        db_session, status="verdict_reached", verdict_class="ddos", confidence=0.9, created_at=ago(hours=1)
    )
    insider = add_investigation(
        db_session,
        status="contained",
        verdict_class="insider_file_exfiltration",
        confidence=0.7,
        created_at=ago(hours=2),
        primary_agent="access_log",
    )
    benign = add_investigation(
        db_session, status="verdict_reached", verdict_class="benign", confidence=0.6, created_at=ago(hours=30)
    )
    add_investigation(
        db_session, status="ambiguous", verdict_class="ambiguous", confidence=0.5, created_at=ago(hours=3)
    )
    add_investigation(
        db_session, status="verdict_reached", verdict_class="ddos", confidence=0.9, created_at=ago(hours=30)
    )
    # Citations: ddos has one VERIFIED and one DISCREPANCY, insider has one INVALID_ROW.
    add_transcript(
        db_session,
        ddos.investigation_id,
        round_no=1,
        agent_id="network_traffic",
        theory="SUPPORT: ddos flood",
        cited=[cite(row, "Destination Port", "80"), cite(row, "Destination Port", "81")],
    )
    add_transcript(
        db_session,
        insider.investigation_id,
        round_no=1,
        agent_id="access_log",
        theory="CHALLENGE: exfiltration",
        cited=[cite(row, "Destination Port", "80", row_id=str(uuid.uuid4()))],
    )
    add_credibility(
        db_session,
        ddos.investigation_id,
        agent_id="network_traffic",
        round_no=1,
        before=0.5,
        after=0.4,
        rate=0.5,
        isolated=True,
    )
    add_credibility(
        db_session,
        insider.investigation_id,
        agent_id="access_log",
        round_no=1,
        before=0.5,
        after=0.5,
        rate=0.0,
    )
    add_action(db_session, ddos.investigation_id)
    add_action(db_session, insider.investigation_id, action_type="lock_account", target="U7")
    add_feedback(db_session, ddos.investigation_id, True)
    add_feedback(db_session, insider.investigation_id, False)
    add_feedback(db_session, benign.investigation_id, True)
    audit(db_session, "watchdog", "credibility_update", {"agent_id": "network_traffic"})
    audit(db_session, "system", "settings_changed", {"eta": 0.15})
    audit(db_session, "system", "settings_changed", {"eta": 0.2})
    audit(db_session, "system", "settings_changed", {"eta": 0.25})
    db_session.commit()

    body = _stats()

    assert body["active"]["value"] == 1
    assert body["stale"]["value"] == 1
    assert body["threats_24h"]["value"] == 2  # ddos and insider; the 30 h old ddos is outside 24 h
    assert body["insider_count"]["value"] == 1
    assert body["contained"]["value"] == 1
    assert body["by_status"]["investigating"]["value"] == 2
    assert body["by_status"]["verdict_reached"]["value"] == 3
    assert body["by_status"]["error"]["value"] == 0
    assert body["by_verdict_class"]["ddos"]["value"] == 2
    assert body["by_verdict_class"]["ambiguous"]["value"] == 1
    assert body["by_verdict_class"]["botnet_c2"]["value"] == 0

    # Verdict confidences: 0.9, 0.7, 0.6, 0.5, 0.9 (investigating rows have none).
    assert body["mean_agent_confidence"]["value"] == pytest.approx(0.72)
    assert body["mean_agent_confidence"]["n"] == 5

    assert body["citations"]["total"]["value"] == 3
    assert body["citations"]["verified_rate"]["value"] == pytest.approx(1 / 3)
    assert body["citations"]["invalid_rate"]["value"] == pytest.approx(2 / 3)
    assert body["citations"]["verified_rate"]["n"] == 3
    # ddos: one VERIFIED + one DISCREPANCY (wrong value); insider: one INVALID_ROW (row id not in raw_logs).
    assert body["citations"]["verified"]["value"] == 1
    assert body["citations"]["discrepancy"]["value"] == 1
    assert body["citations"]["invalid_row"]["value"] == 1

    assert body["chain"]["valid"] is True
    assert body["chain"]["entries"]["value"] == 4
    assert body["chain"]["head_seq"]["value"] == 4

    assert body["watchdog"]["checks_total"]["value"] == 2
    assert body["watchdog"]["citations_checked"]["value"] == 3
    assert body["watchdog"]["discrepancies"]["value"] == 2
    assert body["watchdog"]["isolations"]["value"] == 1

    assert body["self_healing"]["actions_total"]["value"] == 2
    assert body["self_healing"]["simulated_share"]["value"] == 1.0
    assert body["self_healing"]["simulated_share"]["n"] == 2
    assert body["self_healing"]["non_simulated"]["value"] == 0

    assert body["feedback"]["total"]["value"] == 3
    assert body["feedback"]["confirmed"]["value"] == 2
    assert body["feedback"]["false_positive"]["value"] == 1
    assert body["feedback"]["agreement_rate"]["value"] == pytest.approx(2 / 3)

    # Brier over feedback rows with a confidence: (0.9-1)^2, (0.6-1)^2 and (0.7-0)^2 are the three rows.
    assert body["brier"]["value"] == pytest.approx((0.01 + 0.16 + 0.49) / 3)
    assert body["brier"]["n"] == 3
    assert body["brier"]["reason"] is None


def test_latency_is_investigation_started_to_verdict_reached(db_session):
    first = add_investigation(db_session, verdict_class="ddos", confidence=0.9)
    second = add_investigation(db_session, verdict_class="ddos", confidence=0.9)
    audit(db_session, "engine", "investigation_started", None, first.investigation_id, created_at=BASE_TIME)
    audit(
        db_session,
        "engine",
        "verdict_reached",
        {"verdict": "ddos"},
        first.investigation_id,
        created_at=BASE_TIME + timedelta(seconds=30),
    )
    audit(db_session, "engine", "investigation_started", None, second.investigation_id, created_at=BASE_TIME)
    audit(
        db_session,
        "engine",
        "verdict_reached",
        {"verdict": "ddos"},
        second.investigation_id,
        created_at=BASE_TIME + timedelta(seconds=90),
    )
    db_session.commit()

    body = _stats()

    assert body["latency"]["mean_seconds"]["value"] == pytest.approx(60.0)
    assert body["latency"]["mean_seconds"]["n"] == 2
    assert "investigation_started" in body["latency"]["definition"]
    assert "verdict_reached" in body["latency"]["definition"]


def test_stats_requires_authentication(db_session):
    assert client.get("/stats").status_code == 401


def _tamper_audit_row(db_session, seq: int) -> None:
    db_session.execute(
        text("UPDATE audit_trail SET detail = CAST(:detail AS jsonb) WHERE seq = :seq"),
        {"detail": '{"tampered": true}', "seq": seq},
    )
    db_session.commit()


def test_chain_is_verified_incrementally_after_the_first_pass_and_says_so(db_session):
    for n in range(4):
        audit(db_session, "watchdog", "credibility_update", {"n": n})
    db_session.commit()

    first = _stats()["chain"]
    audit(db_session, "watchdog", "credibility_update", {"n": 4})
    db_session.commit()
    second = _stats()["chain"]

    assert first["valid"] is True and "whole chain was walked" in first["entries"]["definition"]
    assert first["entries"]["value"] == 4
    assert second["valid"] is True and second["entries"]["value"] == 5 and second["head_seq"]["value"] == 5
    assert "incrementally" in second["entries"]["definition"]
    assert (
        "(seq 4)" in second["entries"]["definition"]
    )  # it started at the checkpoint written by the first pass
    assert "2 entries, that one included" in second["entries"]["definition"]


def test_a_row_changed_after_the_checkpoint_turns_the_chain_invalid(db_session):
    for n in range(3):
        audit(db_session, "watchdog", "credibility_update", {"n": n})
    db_session.commit()
    assert _stats()["chain"]["valid"] is True  # writes the checkpoint at seq 3
    audit(db_session, "watchdog", "credibility_update", {"n": 3})
    db_session.commit()
    _tamper_audit_row(db_session, 4)

    chain = _stats()["chain"]

    assert chain["valid"] is False
    assert "break found at seq 4 (hash_mismatch)" in chain["entries"]["definition"]


def test_an_old_row_changed_is_not_seen_by_stats_but_is_by_a_full_verify(db_session):
    for n in range(4):
        audit(db_session, "watchdog", "credibility_update", {"n": n})
    db_session.commit()
    assert _stats()["chain"]["valid"] is True  # checkpoint at seq 4
    _tamper_audit_row(db_session, 1)
    headers = bearer_for("forensic_analyst")

    chain = _stats()["chain"]
    verified = client.post("/audit-trail/verify?full=true", headers=headers).json()

    assert (
        chain["valid"] is True
    )  # honest: the definition says entries before the checkpoint are not re-walked
    assert "were not re-walked here" in chain["entries"]["definition"]
    assert verified["chain_valid"] is False and verified["first_break_seq"] == 1
