import json
import sys
import types
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from backend.agents.schemas import AgentResponse
from backend.db.audit import verify_chain
from backend.db.models import (
    AgentQuarantine,
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    RawLog,
    ResponseAction,
)
from backend.debate import engine
from backend.debate.engine import (
    DebateFailedError,
    NotEnoughActiveAgents,
    parse_stance,
    run_debate,
    start_investigation,
)
from backend.watchdog.credibility import _client, _crs_key, reset_agent

DOMAIN_AGENTS = ("network_traffic", "access_log", "endpoint_behavior")
SETTINGS = SimpleNamespace(eta=0.15, isolation_threshold=0.30, verdict_confidence_threshold=0.80)


@pytest.fixture(autouse=True)
def _fresh_crs():
    """CrS lives in Redis and outlives each test, so every domain agent starts each test at the
    starting value.
    """
    for agent in DOMAIN_AGENTS:
        reset_agent(agent)
    yield
    for agent in DOMAIN_AGENTS:
        reset_agent(agent)


@pytest.fixture(autouse=True)
def _fake_runtime_settings(monkeypatch):
    """Injects a fake backend.db.runtime_settings so these tests never depend on that module's
    state. calls records every load() invocation.
    """
    fake = types.ModuleType("backend.db.runtime_settings")
    fake.calls = []

    def load(session=None):
        fake.calls.append(session)
        return SETTINGS

    fake.load = load
    monkeypatch.setitem(sys.modules, "backend.db.runtime_settings", fake)
    return fake


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


def _seed_all_domains(db_session) -> list[RawLog]:
    """Seeds one source per investigator and returns the network rows (the primary agent's rows)."""
    network_rows = _seed_domain(db_session, "cicids2017", "network_flow")
    _seed_domain(db_session, "cert_r4.2_file", "file_access")
    _seed_domain(db_session, "cert_r4.2_logon", "logon")
    db_session.commit()
    return network_rows


def _make_fake_investigator(agent_id: str, theories_by_round: dict[int, str], confidence: float = 0.7):
    def _fake(rows, round_no, peripheral_digest=None, debate_context=None):
        theory = theories_by_round.get(round_no, f"round {round_no} default theory")
        response = AgentResponse(
            agent_id=agent_id,
            theory=theory,
            confidence=confidence,
            cited_evidence=[{"row_id": str(rows[0].row_id), "field": "f", "value": "0"}],
            round=round_no,
        )
        return response, "fake_provider"

    return _fake


def _counting(investigator, calls: list[int]):
    def _wrapped(rows, round_no, peripheral_digest=None, debate_context=None):
        calls.append(round_no)
        return investigator(
            rows, round_no, peripheral_digest=peripheral_digest, debate_context=debate_context
        )

    return _wrapped


def _three_agents(confidence: float = 0.7) -> dict:
    """One real DDoS vote (network_traffic) against two non-votes: the verdict is ddos at `confidence`."""
    return {
        "network_traffic": _make_fake_investigator(
            "network_traffic",
            {
                1: "Traffic spike suggests DDoS.",
                2: "CHALLENGE: still a DDoS flood pattern.",
                3: "Final: DDoS confirmed.",
            },
            confidence,
        ),
        "access_log": _make_fake_investigator(
            "access_log",
            {
                1: "No anomaly in file access.",
                2: "SUPPORT: agree the traffic looks like DDoS.",
                3: "Final: no insider signal.",
            },
            confidence,
        ),
        "endpoint_behavior": _make_fake_investigator(
            "endpoint_behavior",
            {
                1: "Normal login pattern.",
                2: "Consistent with the DDoS theory.",
                3: "Final: normal behavior.",
            },
            confidence,
        ),
    }


def _start(**overrides) -> uuid.UUID:
    kwargs = dict(
        trigger_type="manual",
        trigger_reason="unit test",
        scenario_label=None,
        primary_agent="network_traffic",
        noise_pct=0,
        effective_noise_pct=0.0,
        injected_row_ids=[],
        started_by="test_analyst",
        max_rows_per_agent=5,
    )
    kwargs.update(overrides)
    return start_investigation(**kwargs)


def _debate(network_rows, investigators, *, settings=SETTINGS, **kwargs) -> dict:
    investigation_id = _start()
    return run_debate(
        "network_traffic",
        network_rows,
        investigation_id=investigation_id,
        investigators=investigators,
        settings=settings,
        **kwargs,
    )


def test_engine_runs_three_rounds():
    assert engine.DEBATE_ROUNDS == 3


@pytest.mark.parametrize(
    "theory,expected",
    [
        ("CHALLENGE: state which agent", "CHALLENGE"),
        ("SUPPORT agree with access_log", "SUPPORT"),
        ("REVISE: updated view", "REVISE"),
        ("REVISED: not a stance token", None),
        ("Challenge: lowercase is not the stance token", None),
        ("No stance at the start, CHALLENGE later", None),
        ("", None),
    ],
)
def test_parse_stance_reads_only_a_leading_stance_token(theory, expected):
    assert parse_stance(theory) == expected


def test_start_investigation_creates_row_and_audit_entry_in_one_transaction(db_session):
    row_ids = [uuid.uuid4(), uuid.uuid4()]

    investigation_id = _start(
        noise_pct=15,
        effective_noise_pct=13.6,
        primary_agent="access_log",
        scenario_label="insider_scenario_1",
        injected_row_ids=row_ids,
    )

    investigation = db_session.get(Investigation, investigation_id)
    assert investigation.noise_pct == 15
    assert investigation.effective_noise_pct == pytest.approx(13.6)
    assert investigation.primary_agent == "access_log"
    assert investigation.scenario_label == "insider_scenario_1"
    assert investigation.status == "investigating"

    entries = db_session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all()
    assert [e.action for e in entries] == ["investigation_started"]  # appended last, the only entry
    started = entries[0]
    assert started.investigation_id == investigation_id
    assert started.actor == "test_analyst"
    assert started.detail["noise_pct"] == 15
    assert started.detail["injected_row_ids"] == [str(r) for r in row_ids]
    assert started.detail["settings"] == {
        "eta": 0.15,
        "isolation_threshold": 0.3,
        "verdict_confidence_threshold": 0.8,
    }
    assert verify_chain(entries) is True


def test_start_investigation_never_writes_the_scenario_label_into_audit(db_session):
    _start(scenario_label="DDoS")

    entries = db_session.execute(select(AuditTrail)).scalars().all()
    assert entries
    assert all("DDoS" not in json.dumps(e.detail or {}) for e in entries)


def test_start_investigation_rolls_back_the_row_when_the_audit_append_fails(db_session, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr(engine, "append_entry", boom)

    with pytest.raises(RuntimeError):
        _start()
    assert db_session.execute(select(Investigation)).scalars().all() == []


def test_run_debate_persists_all_9_transcript_rows_with_provider(db_session):
    network_rows = _seed_all_domains(db_session)

    result = _debate(network_rows, _three_agents())

    transcripts = db_session.execute(select(DebateTranscript)).scalars().all()
    assert len(transcripts) == 9  # 3 agents x 3 rounds
    assert {t.round for t in transcripts} == {1, 2, 3}
    assert {t.agent_id for t in transcripts} == {"network_traffic", "access_log", "endpoint_behavior"}
    assert {t.provider for t in transcripts} == {"fake_provider"}

    assert result["verdict"]["verdict_class"] == "ddos"
    assert result["status"] == "verdict_reached"
    assert result["actions_taken"] == []  # confidence 0.7 is below the 0.80 verdict threshold
    assert result["providers_used"]["network_traffic"] == ["fake_provider"] * 3

    investigation = db_session.get(Investigation, uuid.UUID(result["investigation_id"]))
    assert investigation.status == "verdict_reached"
    assert investigation.verdict_class == "ddos"


def test_run_debate_retries_on_near_duplicate_round2(db_session):
    network_rows = _seed_all_domains(db_session)

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
        "access_log": _make_fake_investigator(
            "access_log", {1: "a", 2: "b different enough text here", 3: "c"}
        ),
        "endpoint_behavior": _make_fake_investigator(
            "endpoint_behavior", {1: "d", 2: "e different enough text here", 3: "f"}
        ),
    }

    _debate(network_rows, investigators)

    # round1 call (1) + round2 first attempt (2) + round2 retry (3) + round3 (4) = 4
    assert call_count["network_traffic"] == 4

    round2_transcript = db_session.execute(
        select(DebateTranscript).where(
            DebateTranscript.agent_id == "network_traffic", DebateTranscript.round == 2
        )
    ).scalar_one()
    assert round2_transcript.theory == "REVISE: reconsidering given peripheral input."


def test_run_debate_marks_investigation_error_and_raises_on_provider_failure(db_session):
    """Observed live this session: both LLM providers exhausted mid-debate,
    which used to leave the Investigation stuck at status='investigating'
    forever and surface as a bare unhandled exception. Now it must be marked
    'error' and raise a typed DebateFailedError the API layer can catch.
    """
    network_rows = _seed_all_domains(db_session)

    def failing_investigator(rows, round_no, peripheral_digest=None, debate_context=None):
        raise RuntimeError("all providers exhausted")

    investigators = {
        "network_traffic": failing_investigator,
        "access_log": _make_fake_investigator("access_log", {1: "a"}),
        "endpoint_behavior": _make_fake_investigator("endpoint_behavior", {1: "b"}),
    }

    events = []
    with pytest.raises(DebateFailedError) as exc_info:
        _debate(network_rows, investigators, on_update=events.append)

    investigation = db_session.get(Investigation, uuid.UUID(exc_info.value.investigation_id))
    assert investigation.status == "error"
    error_events = [e for e in events if e["type"] == "error"]
    assert len(error_events) == 1
    assert error_events[0]["investigation_id"] == exc_info.value.investigation_id


def test_run_debate_requires_an_existing_investigation(db_session):
    network_rows = _seed_all_domains(db_session)

    with pytest.raises(ValueError):
        run_debate(
            "network_traffic",
            network_rows,
            investigation_id=uuid.uuid4(),
            investigators=_three_agents(),
            settings=SETTINGS,
        )


def test_scenario_label_stays_on_the_investigation_row_and_out_of_the_debate(db_session):
    network_rows = _seed_all_domains(db_session)
    investigation_id = _start(scenario_label="DDoS")

    run_debate(
        "network_traffic",
        network_rows,
        investigation_id=investigation_id,
        investigators=_three_agents(),
        settings=SETTINGS,
    )

    investigation = db_session.get(Investigation, investigation_id)
    assert investigation.scenario_label == "DDoS"
    entries = db_session.execute(select(AuditTrail)).scalars().all()
    assert all("DDoS" not in json.dumps(e.detail or {}) for e in entries)


def test_run_debate_emits_round_completed_events_with_stance_and_provider(db_session):
    network_rows = _seed_all_domains(db_session)

    events = []
    _debate(network_rows, _three_agents(), on_update=events.append)

    assert all("investigation_id" in e for e in events)
    round_events = [e for e in events if e["type"] == "round_completed"]
    assert [e["round"] for e in round_events] == [1, 2, 3]

    round2 = {a["agent_id"]: a for a in round_events[1]["agents"]}
    assert round2["network_traffic"]["stance"] == "CHALLENGE"
    assert round2["access_log"]["stance"] == "SUPPORT"
    assert round2["endpoint_behavior"]["stance"] is None
    assert round2["network_traffic"]["provider"] == "fake_provider"
    assert set(round2["network_traffic"]) == {
        "agent_id",
        "theory",
        "confidence",
        "stance",
        "provider",
        "cited_evidence",
        "credibility",
    }

    assert events[-1]["type"] == "verdict"
    assert events[-1]["status"] == "verdict_reached"
    assert events[-1]["actions_taken"] == []


def test_run_debate_writes_round_and_verdict_audit_in_order(db_session):
    network_rows = _seed_all_domains(db_session)

    _debate(network_rows, _three_agents())

    entries = db_session.execute(select(AuditTrail).order_by(AuditTrail.seq)).scalars().all()
    per_round = ["credibility_update"] * 3 + ["round_completed"]
    assert [e.action for e in entries] == (["investigation_started"] + per_round * 3 + ["verdict_reached"])
    assert verify_chain(entries) is True
    assert {e.actor for e in entries} >= {"test_analyst", "watchdog", "debate_engine"}


def test_run_debate_scores_every_round_and_persists_credibility_log(db_session):
    network_rows = _seed_all_domains(db_session)

    def lying_investigator(rows, round_no, peripheral_digest=None, debate_context=None):
        response = AgentResponse(
            agent_id="network_traffic",
            theory=f"Unfounded claim, round {round_no}.",
            confidence=0.7,
            cited_evidence=[{"row_id": str(rows[0].row_id), "field": "f", "value": "definitely_wrong_value"}],
            round=round_no,
        )
        return response, "fake_provider"

    investigators = {
        "network_traffic": lying_investigator,
        "access_log": _make_fake_investigator("access_log", {1: "a", 2: "b different enough", 3: "c"}),
        "endpoint_behavior": _make_fake_investigator(
            "endpoint_behavior", {1: "d", 2: "e different enough", 3: "f"}
        ),
    }

    _debate(network_rows, investigators)

    logs = (
        db_session.execute(
            select(CredibilityLog)
            .where(CredibilityLog.agent_id == "network_traffic")
            .order_by(CredibilityLog.round)
        )
        .scalars()
        .all()
    )
    assert [log.round for log in logs] == [1, 2, 3]
    assert all(log.verification_match_rate == 0.0 for log in logs)
    # 0.5 -> 0.425 -> 0.361 -> 0.307: three failing rounds stay above the 0.30 threshold
    assert logs[-1].crs_after == pytest.approx(0.5 * 0.85**3)
    assert all(not log.isolated for log in logs)


def test_isolated_agent_is_excluded_from_later_rounds_and_from_the_verdict(db_session):
    network_rows = _seed_all_domains(db_session)
    # 0.20 * 0.85 = 0.17 after one failing round, which is below the 0.30 threshold
    _client().set(_crs_key("network_traffic"), 0.20)
    network_calls: list[int] = []

    def failing_network(rows, round_no, peripheral_digest=None, debate_context=None):
        network_calls.append(round_no)
        response = AgentResponse(
            agent_id="network_traffic",
            theory="Traffic spike suggests DDoS.",
            confidence=0.9,
            cited_evidence=[{"row_id": str(rows[0].row_id), "field": "f", "value": "definitely_wrong_value"}],
            round=round_no,
        )
        return response, "fake_provider"

    investigators = {
        "network_traffic": failing_network,
        "access_log": _make_fake_investigator(
            "access_log", {1: "No anomaly in file access.", 2: "SUPPORT: no anomaly.", 3: "Final: normal."}
        ),
        "endpoint_behavior": _make_fake_investigator(
            "endpoint_behavior",
            {1: "Normal login pattern.", 2: "SUPPORT: normal login.", 3: "Final: normal."},
        ),
    }

    events = []
    result = _debate(network_rows, investigators, on_update=events.append)

    assert network_calls == [1]  # isolated after round 1: no round 2 or 3 call

    quarantine = db_session.get(AgentQuarantine, "network_traffic")
    assert quarantine.active is True
    assert quarantine.set_by == "watchdog"
    assert quarantine.reason

    isolated_events = [e for e in events if e["type"] == "agent_isolated"]
    assert len(isolated_events) == 1
    assert isolated_events[0]["agent_id"] == "network_traffic"
    assert isolated_events[0]["round"] == 1
    assert isolated_events[0]["crs_after"] == pytest.approx(0.17)
    assert isolated_events[0]["investigation_id"] == result["investigation_id"]

    round_events = [e for e in events if e["type"] == "round_completed"]
    assert "network_traffic" in {a["agent_id"] for a in round_events[0]["agents"]}
    for later in round_events[1:]:
        assert {a["agent_id"] for a in later["agents"]} == {"access_log", "endpoint_behavior"}

    assert set(result["verdict"]["contributing_agents"]) == {"access_log", "endpoint_behavior"}

    isolation_audit = (
        db_session.execute(select(AuditTrail).where(AuditTrail.action == "agent_isolated")).scalars().all()
    )
    assert len(isolation_audit) == 1
    assert isolation_audit[0].actor == "watchdog"
    assert isolation_audit[0].detail["agent_id"] == "network_traffic"
    assert isolation_audit[0].detail["round"] == 1


def test_agent_quarantined_before_the_debate_is_never_called(db_session):
    network_rows = _seed_all_domains(db_session)
    quarantine = db_session.get(AgentQuarantine, "access_log")
    quarantine.active = True
    db_session.commit()

    access_calls: list[int] = []
    investigators = {
        "network_traffic": _make_fake_investigator(
            "network_traffic", {1: "Traffic spike suggests DDoS.", 2: "CHALLENGE: DDoS.", 3: "Final: DDoS."}
        ),
        "access_log": _counting(_make_fake_investigator("access_log", {1: "a"}), access_calls),
        "endpoint_behavior": _make_fake_investigator(
            "endpoint_behavior", {1: "Normal login.", 2: "SUPPORT: normal.", 3: "Final: normal."}
        ),
    }

    events = []
    _debate(network_rows, investigators, on_update=events.append)

    assert access_calls == []
    round_events = [e for e in events if e["type"] == "round_completed"]
    assert len(round_events) == 3
    for event in round_events:
        assert {a["agent_id"] for a in event["agents"]} == {"network_traffic", "endpoint_behavior"}
    assert not [e for e in events if e["type"] == "agent_isolated"]
    assert len(db_session.execute(select(DebateTranscript)).scalars().all()) == 6  # two active agents x 3


def test_fewer_than_two_active_agents_raises_not_enough_active_agents(db_session):
    network_rows = _seed_all_domains(db_session)
    for agent in ("access_log", "endpoint_behavior"):
        db_session.get(AgentQuarantine, agent).active = True
    db_session.commit()
    investigation_id = _start()

    events = []
    with pytest.raises(NotEnoughActiveAgents):
        run_debate(
            "network_traffic",
            network_rows,
            investigation_id=investigation_id,
            investigators=_three_agents(),
            settings=SETTINGS,
            on_update=events.append,
        )

    assert db_session.get(Investigation, investigation_id).status == "error"
    assert events[0]["type"] == "error"
    assert events[0]["investigation_id"] == str(investigation_id)
    assert db_session.execute(select(DebateTranscript)).scalars().all() == []


def test_settings_none_loads_runtime_settings_once(db_session, _fake_runtime_settings):
    network_rows = _seed_all_domains(db_session)
    investigation_id = _start()  # start_investigation loads the settings for its snapshot
    _fake_runtime_settings.calls.clear()

    run_debate(
        "network_traffic",
        network_rows,
        investigation_id=investigation_id,
        investigators=_three_agents(),
    )

    assert len(_fake_runtime_settings.calls) == 1


def test_verdict_at_threshold_is_contained_and_status_becomes_contained(db_session, monkeypatch):
    network_rows = _seed_all_domains(db_session)
    monkeypatch.setattr(
        "backend.self_healing.actions._generate_reason",
        lambda *a, **kw: "Mocked reason text.",
    )
    investigators = {
        agent: _make_fake_investigator(
            agent,
            {1: "Traffic spike suggests DDoS.", 2: "CHALLENGE: DDoS flood.", 3: "Final: DDoS flood."},
            confidence=0.9,
        )
        for agent in DOMAIN_AGENTS
    }

    events = []
    result = _debate(network_rows, investigators, on_update=events.append)

    assert result["verdict"]["verdict_class"] == "ddos"
    assert result["status"] == "contained"
    assert {a["action_type"] for a in result["actions_taken"]} == {
        "block_ip_range",
        "trigger_rate_limiting",
        "trigger_audit",
    }
    investigation = db_session.get(Investigation, uuid.UUID(result["investigation_id"]))
    assert investigation.status == "contained"
    assert len(db_session.execute(select(ResponseAction)).scalars().all()) == 3

    assert events[-1]["type"] == "verdict"
    assert events[-1]["status"] == "contained"
    assert len(events[-1]["actions_taken"]) == 3

    verdict_entry = db_session.execute(
        select(AuditTrail).where(AuditTrail.action == "verdict_reached")
    ).scalar_one()
    assert verdict_entry.detail["status"] == "verdict_reached"


def test_verdict_below_a_higher_threshold_is_not_contained(db_session, monkeypatch):
    network_rows = _seed_all_domains(db_session)
    monkeypatch.setattr(
        "backend.self_healing.actions._generate_reason",
        lambda *a, **kw: "Mocked reason text.",
    )
    strict = SimpleNamespace(eta=0.15, isolation_threshold=0.30, verdict_confidence_threshold=0.95)

    result = _debate(network_rows, _three_agents(confidence=0.9), settings=strict)

    assert result["status"] == "verdict_reached"
    assert result["actions_taken"] == []
    assert db_session.execute(select(ResponseAction)).scalars().all() == []
