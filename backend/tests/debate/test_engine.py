import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from backend.agents.schemas import AgentResponse
from backend.db.models import CredibilityLog, DebateTranscript, Investigation, RawLog
from backend.debate.engine import run_debate
from backend.watchdog.credibility import _client, _crs_key, get_crs, is_isolated


def _seed_domain(db_session, source: str, event_type: str, n: int = 2) -> list[RawLog]:
    rows = []
    now = datetime.now(timezone.utc)
    for i in range(n):
        row = RawLog(
            timestamp=now - timedelta(minutes=i),
            source=source,
            event_type=event_type,
            raw_fields={"f": i},
            ground_truth_label="benign",
        )
        db_session.add(row)
        rows.append(row)
    db_session.flush()
    return rows


def _make_fake_investigator(agent_id: str, theories_by_round: dict[int, str]):
    def _fake(rows, round_no, peripheral_digest=None, debate_context=None):
        theory = theories_by_round.get(round_no, f"round {round_no} default theory")
        response = AgentResponse(
            agent_id=agent_id,
            theory=theory,
            confidence=0.7,
            cited_evidence=[{"row_id": str(rows[0].row_id), "field": "f", "value": "0"}],
            round=round_no,
        )
        return response, "fake_provider"

    return _fake


def test_run_debate_persists_all_9_transcript_rows(db_session):
    network_rows = _seed_domain(db_session, "cicids2017", "network_flow")
    _seed_domain(db_session, "cert_r4.2_file", "file_access")
    _seed_domain(db_session, "cert_r4.2_logon", "logon")
    db_session.commit()

    investigators = {
        "network_traffic": _make_fake_investigator(
            "network_traffic",
            {1: "Traffic spike suggests DDoS.", 2: "CHALLENGE: still a DDoS flood pattern given volume.", 3: "Final: DDoS confirmed."},
        ),
        "access_log": _make_fake_investigator(
            "access_log",
            {1: "No anomaly in file access.", 2: "SUPPORT: agree traffic looks like DDoS externally.", 3: "Final: no insider signal."},
        ),
        "endpoint_behavior": _make_fake_investigator(
            "endpoint_behavior",
            {1: "Normal login pattern.", 2: "SUPPORT: consistent with external DDoS theory.", 3: "Final: normal behavior."},
        ),
    }

    result = run_debate("network_traffic", network_rows, investigators=investigators)

    transcripts = db_session.execute(select(DebateTranscript)).scalars().all()
    assert len(transcripts) == 9  # 3 agents x 3 rounds
    assert {t.round for t in transcripts} == {1, 2, 3}
    assert {t.agent_id for t in transcripts} == {"network_traffic", "access_log", "endpoint_behavior"}

    assert result["verdict"]["verdict_class"] == "ddos"

    investigation = db_session.get(Investigation, uuid.UUID(result["investigation_id"]))
    assert investigation.status == "verdict_reached"
    assert investigation.verdict_class == "ddos"


def test_run_debate_retries_on_near_duplicate_round2(db_session):
    network_rows = _seed_domain(db_session, "cicids2017", "network_flow")
    _seed_domain(db_session, "cert_r4.2_file", "file_access")
    _seed_domain(db_session, "cert_r4.2_logon", "logon")
    db_session.commit()

    call_count = {"network_traffic": 0}

    def flaky_investigator(rows, round_no, peripheral_digest=None, debate_context=None):
        call_count["network_traffic"] += 1
        # round 1 and round 2's FIRST attempt both say the same thing (near-dup);
        # only a retry (2nd call at round 2) gets a genuinely different answer
        if round_no == 2 and call_count["network_traffic"] == 3:
            theory = "REVISE: reconsidering given peripheral input."
        else:
            theory = "Traffic spike suggests DDoS."
        return (
            AgentResponse(
                agent_id="network_traffic",
                theory=theory,
                confidence=0.7,
                cited_evidence=[{"row_id": str(rows[0].row_id), "field": "f", "value": "0"}],
                round=round_no,
            ),
            "fake_provider",
        )

    investigators = {
        "network_traffic": flaky_investigator,
        "access_log": _make_fake_investigator("access_log", {1: "a", 2: "b different enough text here", 3: "c"}),
        "endpoint_behavior": _make_fake_investigator("endpoint_behavior", {1: "d", 2: "e different enough text here", 3: "f"}),
    }

    run_debate("network_traffic", network_rows, investigators=investigators)

    # round1 call (1) + round2 first attempt (2) + round2 retry (3) + round3 (4) = 4
    assert call_count["network_traffic"] == 4

    round2_transcript = db_session.execute(
        select(DebateTranscript).where(
            DebateTranscript.agent_id == "network_traffic", DebateTranscript.round == 2
        )
    ).scalar_one()
    assert round2_transcript.theory == "REVISE: reconsidering given peripheral input."


def test_run_debate_scores_every_round_and_persists_credibility_log(db_session):
    """Every round's response gets watchdog-scored (SKILL-architecture.md
    Section 6), regardless of whether it happens to be isolation-triggering -
    see test below for the isolation+reset path specifically, and
    backend/watchdog/credibility.py's docstring for why an agent starting at
    the spec's own CrS=0.5 can't organically reach isolation via this formula.
    """
    network_rows = _seed_domain(db_session, "cicids2017", "network_flow")
    _seed_domain(db_session, "cert_r4.2_file", "file_access")
    _seed_domain(db_session, "cert_r4.2_logon", "logon")
    db_session.commit()

    fake_agent_id = f"test_liar_{uuid.uuid4().hex[:8]}"

    def lying_investigator(rows, round_no, peripheral_digest=None, debate_context=None):
        response = AgentResponse(
            agent_id="network_traffic",
            theory=f"round {round_no} theory, always different {uuid.uuid4().hex[:6]}",
            confidence=0.9,
            cited_evidence=[{"row_id": str(rows[0].row_id), "field": "f", "value": "definitely_wrong_value"}],
            round=round_no,
        )
        response.agent_id = fake_agent_id  # decouple from "network_traffic"'s shared Redis state
        return response, "fake_provider"

    investigators = {
        "network_traffic": lying_investigator,
        "access_log": _make_fake_investigator("access_log", {1: "a", 2: "b different enough", 3: "c"}),
        "endpoint_behavior": _make_fake_investigator("endpoint_behavior", {1: "d", 2: "e different enough", 3: "f"}),
    }

    run_debate("network_traffic", network_rows, investigators=investigators)

    logs = db_session.execute(
        select(CredibilityLog).where(CredibilityLog.agent_id == fake_agent_id).order_by(CredibilityLog.round)
    ).scalars().all()
    assert len(logs) == 3
    assert all(log.verification_match_rate == 0.0 for log in logs)
    assert all(not log.isolated for log in logs)  # can't reach isolation from CrS=0.5 - see docstring above


def test_run_debate_resets_agent_immediately_when_watchdog_isolates_it(db_session):
    """Simulates an agent whose CrS is already below threshold when the debate
    starts (bypassing the formula defect directly, same technique as
    test_watchdog/test_credibility.py) to prove the engine's isolate-then-reset
    wiring itself is correct, independent of whether the formula can reach
    that state on its own.
    """
    network_rows = _seed_domain(db_session, "cicids2017", "network_flow")
    _seed_domain(db_session, "cert_r4.2_file", "file_access")
    _seed_domain(db_session, "cert_r4.2_logon", "logon")
    db_session.commit()

    fake_agent_id = f"test_liar_{uuid.uuid4().hex[:8]}"
    _client().set(_crs_key(fake_agent_id), 0.20)  # pre-seed below the 0.30 threshold

    def lying_investigator(rows, round_no, peripheral_digest=None, debate_context=None):
        response = AgentResponse(
            agent_id="network_traffic",
            theory=f"round {round_no} theory {uuid.uuid4().hex[:6]}",
            confidence=0.9,
            cited_evidence=[{"row_id": str(rows[0].row_id), "field": "f", "value": "definitely_wrong_value"}],
            round=round_no,
        )
        response.agent_id = fake_agent_id
        return response, "fake_provider"

    investigators = {
        "network_traffic": lying_investigator,
        "access_log": _make_fake_investigator("access_log", {1: "a", 2: "b different enough", 3: "c"}),
        "endpoint_behavior": _make_fake_investigator("endpoint_behavior", {1: "d", 2: "e different enough", 3: "f"}),
    }

    run_debate("network_traffic", network_rows, investigators=investigators)

    logs = db_session.execute(
        select(CredibilityLog).where(CredibilityLog.agent_id == fake_agent_id).order_by(CredibilityLog.round)
    ).scalars().all()
    assert logs[0].isolated is True  # round 1 caught the pre-seeded low CrS

    # reset_agent() fires immediately on detection, so by the end of the debate
    # (rounds 2 and 3 ran on the reset state) the agent is clean again
    assert is_isolated(fake_agent_id) is False
    assert get_crs(fake_agent_id) >= 0.5
