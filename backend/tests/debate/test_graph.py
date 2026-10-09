"""The debate runs as a LangGraph state graph (backend/debate/graph.py, checklist ST11).

These tests check what only the graph adds: its shape, that the investigators of a round really run at
the same time (SKILL-architecture.md Section 1: "run in parallel via LangGraph"), that results do not
depend on who finishes first, and that a failing agent ends the debate the way it always did. What the
debate does with its results (verdicts, isolation, audit) is covered in test_engine.py through the same
graph."""

import threading
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from backend.agents.schemas import AgentResponse
from backend.config import settings as app_settings
from backend.db.models import DebateTranscript, Investigation, RawLog
from backend.debate import engine
from backend.debate.graph import DEBATE_GRAPH, RESET, DebateState, _collect
from backend.watchdog.credibility import reset_agent

AGENTS = ("network_traffic", "access_log", "endpoint_behavior")
SETTINGS = SimpleNamespace(eta=0.20, isolation_threshold=0.30, verdict_confidence_threshold=0.80)
THEORIES = {
    1: "Traffic spike suggests a DDoS flood against one host.",
    2: "CHALLENGE: the other agents only see background noise, the flood explanation still stands.",
    3: "Final position: the volumetric flood is confirmed by the packet rate.",
}


@pytest.fixture(autouse=True)
def _fresh_crs(monkeypatch):
    # The Self-Healing step writes its reason with an LLM; a test must never reach a real provider.
    monkeypatch.setattr("backend.self_healing.actions._generate_reason", lambda *a, **kw: "Mocked reason.")
    for agent in AGENTS:
        reset_agent(agent)
    yield
    for agent in AGENTS:
        reset_agent(agent)


def _seed(db_session) -> list[RawLog]:
    """One domain per investigator; returns the network rows (the primary agent's)."""
    now = datetime.now(timezone.utc)
    network = []
    for source, event_type in (
        ("cicids2017", "network_flow"),
        ("cert_r4.2_file", "file_access"),
        ("cert_r4.2_logon", "logon"),
    ):
        rows = [
            RawLog(
                timestamp=now - timedelta(minutes=i),
                source=source,
                event_type=event_type,
                raw_fields={"f": 0},
                ground_truth_label="benign",
            )
            for i in range(2)
        ]
        db_session.add_all(rows)
        if source == "cicids2017":
            network = rows
    db_session.commit()
    return network


class Tracker:
    """Counts how many investigators are inside a call at the same moment."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.running = 0
        self.peak = 0
        self.finished: list[tuple[str, int]] = []

    def enter(self) -> None:
        with self.lock:
            self.running += 1
            self.peak = max(self.peak, self.running)

    def leave(self, agent_id: str, round_no: int) -> None:
        with self.lock:
            self.running -= 1
            self.finished.append((agent_id, round_no))


def _investigator(agent_id: str, tracker: Tracker, delay: float, fail_in_round: int | None = None):
    def call(rows, round_no, peripheral_digest=None, debate_context=None):
        tracker.enter()
        try:
            time.sleep(delay)
            if fail_in_round == round_no:
                raise RuntimeError(f"{agent_id} provider is down")
            response = AgentResponse(
                agent_id=agent_id,
                theory=THEORIES[round_no],
                confidence=0.8,
                cited_evidence=[
                    {"row_id": str(rows[0].row_id), "field": "f", "value": str(rows[0].raw_fields["f"])}
                ],
                round=round_no,
            )
            return response, "fake_provider"
        finally:
            tracker.leave(agent_id, round_no)

    return call


def _run(db_session, investigators, on_update=None) -> dict:
    network_rows = _seed(db_session)
    investigation_id = engine.start_investigation(
        trigger_type="manual",
        trigger_reason="graph test",
        scenario_label=None,
        primary_agent="network_traffic",
        noise_pct=0,
        effective_noise_pct=0.0,
        injected_row_ids=[],
        started_by="test_analyst",
        max_rows_per_agent=5,
    )
    return engine.run_debate(
        "network_traffic",
        network_rows,
        investigation_id=investigation_id,
        investigators=investigators,
        settings=SETTINGS,
        on_update=on_update,
    )


def test_the_graph_has_the_nodes_and_edges_of_the_protocol():
    drawn = DEBATE_GRAPH.get_graph()
    nodes = set(drawn.nodes)
    assert {"investigate_agent", "close_round", "aggregate", "respond"} <= nodes
    edges = {(edge.source, edge.target) for edge in drawn.edges}
    assert ("__start__", "investigate_agent") in edges  # round 1 fans out from the start
    assert ("investigate_agent", "close_round") in edges  # every agent joins before the round closes
    assert ("close_round", "investigate_agent") in edges  # the next round
    assert ("close_round", "aggregate") in edges  # after the last round
    assert ("aggregate", "respond") in edges and ("respond", "__end__") in edges


def test_the_turns_reducer_collects_what_each_agent_returns_and_a_reset_empties_it():
    first, second = {"agent_id": "a"}, {"agent_id": "b"}
    collected = _collect(_collect([], [first]), [second])
    assert [turn["agent_id"] for turn in collected] == ["a", "b"]
    assert _collect(collected, RESET) == []
    assert "turns" in DebateState.__annotations__


def test_the_investigators_of_a_round_run_at_the_same_time(db_session):
    tracker = Tracker()
    delay = 0.4
    investigators = {agent: _investigator(agent, tracker, delay) for agent in AGENTS}

    started = time.monotonic()
    result = _run(db_session, investigators)
    elapsed = time.monotonic() - started

    assert tracker.peak == 3  # all three were inside a call together
    # Three rounds of one 0.4 s call each, not nine in a row (3.6 s).
    assert elapsed < 3 * delay * 2.2
    assert result["status"] in ("verdict_reached", "contained")
    assert len(db_session.execute(select(DebateTranscript)).scalars().all()) == 9


def test_one_at_a_time_when_the_parallelism_is_set_to_one(db_session, monkeypatch):
    monkeypatch.setattr(app_settings, "debate_max_parallel_agents", 1)
    tracker = Tracker()
    investigators = {agent: _investigator(agent, tracker, 0.05) for agent in AGENTS}

    _run(db_session, investigators)

    assert tracker.peak == 1


def test_events_and_results_follow_the_agent_order_not_the_finishing_order(db_session):
    tracker = Tracker()
    # network_traffic is the slowest, endpoint_behavior the fastest: they finish in the opposite order.
    delays = {"network_traffic": 0.3, "access_log": 0.15, "endpoint_behavior": 0.02}
    investigators = {agent: _investigator(agent, tracker, delays[agent]) for agent in AGENTS}
    events: list[dict] = []

    result = _run(db_session, investigators, on_update=events.append)

    first_round_finish = [agent for agent, round_no in tracker.finished if round_no == 1]
    assert first_round_finish == ["endpoint_behavior", "access_log", "network_traffic"]
    rounds = [event for event in events if event["type"] == "round_completed"]
    assert [[entry["agent_id"] for entry in event["agents"]] for event in rounds] == [list(AGENTS)] * 3
    assert list(result["providers_used"]) == list(AGENTS)


def test_a_failing_agent_ends_the_debate_as_before(db_session):
    tracker = Tracker()
    investigators = {
        "network_traffic": _investigator("network_traffic", tracker, 0.01),
        "access_log": _investigator("access_log", tracker, 0.01, fail_in_round=2),
        "endpoint_behavior": _investigator("endpoint_behavior", tracker, 0.01),
    }
    events: list[dict] = []

    with pytest.raises(engine.DebateFailedError) as failure:
        _run(db_session, investigators, on_update=events.append)

    assert "access_log provider is down" in failure.value.reason
    investigation = db_session.execute(select(Investigation)).scalars().one()
    db_session.refresh(investigation)
    assert investigation.status == "error"
    assert [event["type"] for event in events if event["type"] == "error"] == ["error"]
    assert any(event["type"] == "round_completed" and event["round"] == 1 for event in events)
    assert not any(event["type"] == "verdict" for event in events)  # no verdict after a failed debate
