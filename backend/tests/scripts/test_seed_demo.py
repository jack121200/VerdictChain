"""The demo seeder (backend/scripts/seed_demo.py): complete investigations with no provider call, and the
hallucination drill that makes the real Watchdog isolate an agent. Runs against the test database."""

import pytest
from sqlalchemy import func, select

from backend.api.rate_limit import DEBATE_SLOT_KEY, get_redis
from backend.db.models import AgentQuarantine, AuditTrail, DebateTranscript, Investigation
from backend.db.session import SessionLocal
from backend.scripts import seed_demo
from backend.testing import e2e_server as stub
from backend.watchdog.credibility import reset_agent

AGENTS = tuple(stub.AGENTS)


@pytest.fixture(autouse=True)
def clean_state():
    for agent in AGENTS:
        reset_agent(agent)
    get_redis().delete(DEBATE_SLOT_KEY)
    yield
    stub.uninstall()
    for agent in AGENTS:
        reset_agent(agent)


def _seed_rows(db_session) -> None:
    network = stub.sample_rows("network_traffic")
    for row in network:
        row.ground_truth_label = "DDoS"
    others = stub.sample_rows("access_log") + stub.sample_rows("endpoint_behavior")
    for row in others:
        row.ground_truth_label = "BENIGN"
    db_session.add_all(network + others)
    db_session.commit()


def _count(model) -> int:
    with SessionLocal() as session:
        return session.execute(select(func.count()).select_from(model)).scalar_one()


def _quarantined(agent_id: str) -> bool:
    with SessionLocal() as session:
        return session.get(AgentQuarantine, agent_id).active


def test_seeding_creates_a_complete_debate_labelled_as_stub(db_session, capsys):
    _seed_rows(db_session)
    assert seed_demo.main(["--scenarios", "DDoS"]) == 0

    assert _count(Investigation) == 1
    assert _count(DebateTranscript) == 9  # three agents, three rounds
    with SessionLocal() as session:
        providers = set(session.execute(select(DebateTranscript.provider)).scalars().all())
    assert providers == {"stub-openai"}
    assert "real provider calls: 0" in capsys.readouterr().out
    assert stub.get_fabricate() == {"agents": []}  # the harness is switched off again


def test_a_scenario_with_no_rows_is_skipped(db_session, capsys):
    assert seed_demo.main(["--scenarios", "DDoS"]) == 0
    assert _count(Investigation) == 0
    assert "skip DDoS" in capsys.readouterr().out


def test_the_drill_runs_until_the_watchdog_isolates_the_agent_and_leaves_it_quarantined(db_session, capsys):
    _seed_rows(db_session)
    assert seed_demo.main(["--scenarios", "DDoS", "--drill", "access_log"]) == 0

    assert _quarantined("access_log") is True  # persistent until an analyst restores it
    assert not _quarantined("network_traffic") and not _quarantined("endpoint_behavior")
    with SessionLocal() as session:
        isolated = (
            session.execute(select(AuditTrail).where(AuditTrail.action == "agent_isolated")).scalars().all()
        )
    assert [entry.detail["agent_id"] for entry in isolated] == ["access_log"]
    assert _count(Investigation) >= 3  # one honest seed, then drill debates until the isolation
    out = capsys.readouterr().out
    assert "isolated access_log" in out and "stays quarantined" in out
    assert stub.get_fabricate() == {"agents": []}


def test_the_drill_is_skipped_when_the_agent_is_already_quarantined(db_session, capsys):
    _seed_rows(db_session)
    with SessionLocal() as session:
        session.get(AgentQuarantine, "access_log").active = True
        session.commit()
    assert seed_demo.main(["--scenarios", "DDoS", "--drill", "access_log"]) == 0
    assert "drill skipped" in capsys.readouterr().out
    assert _count(Investigation) == 1  # only the honest seed ran (access_log sat out, the debate still ran)
