"""The blind-boundary test (CLAUDE.md golden rule 6, SKILL-security.md Section 5). Three checks:

(a) A static scan: no identifier named ground_truth_label, scenario_label or a noise name in the agent,
    watchdog, debate and pipeline code, except the two documented allow-list entries.
(b) A seeded secret: rows labelled SECRET_X_LABEL run through the real start_investigation, noise dilution
    and run_debate, with fake investigators that record every argument. The secret and the noise never
    appear in what an investigator receives.
(c) The real prompt builders of the three investigators, given SECRET_X_LABEL rows, never print the secret.
"""

import ast
import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.agents import access_log, endpoint_behavior, network_traffic
from backend.agents.schemas import AgentResponse, CitedEvidence
from backend.api.rate_limit import get_redis
from backend.db.models import Investigation, RawLog
from backend.db.session import SessionLocal
from backend.debate import engine
from backend.debate.engine import start_investigation
from backend.debate.state import build_peripheral_digest, dominant_agent_for_rows
from backend.pipeline.log_streamer import get_rows_for_scenario
from backend.pipeline.noise import dilute_with_benign
from backend.watchdog.credibility import reset_agent

BACKEND = Path(__file__).resolve().parents[2]
SECRET = "SECRET_X_LABEL"
FORBIDDEN = frozenset({"ground_truth_label", "scenario_label", "noise", "noise_pct", "effective_noise_pct"})
SCANNED_DIRS = ("agents", "watchdog", "debate", "pipeline")
# Allow-list (documented; anything else is a violation).
#  - debate/engine.py: start_investigation() writes scenario_label and the noise values to the investigation
#    row and its audit detail. Nothing else in the module reads them.
#  - pipeline/: selects rows by label (get_rows_for_scenario) and carries the noise percentage into the
#    dilution call. No investigator call takes a label. Note: the RawLog objects an investigator is
#    handed still carry ground_truth_label as an ORM attribute; the agents read only raw_fields, and the
#    test below serialises the allow-listed view. Passing label-free projections would close this gap.
ALLOWED = {
    # start_investigation() writes scenario_label and the noise values to the investigation row and to its
    # audit detail. run_debate() and the agents never read them (checked by the grep in this module's docs).
    "debate/engine.py": frozenset({"scenario_label", "noise_pct", "effective_noise_pct"}),
    "pipeline/": frozenset({"ground_truth_label", "scenario_label", "noise_pct"}),
}
T0 = datetime(2017, 7, 5, 9, 0, tzinfo=timezone.utc)


def _allowed_for(relative: str) -> frozenset[str]:
    if relative in ALLOWED:
        return ALLOWED[relative]
    for prefix, names in ALLOWED.items():
        if prefix.endswith("/") and relative.startswith(prefix):
            return names
    return frozenset()


def _findings(source: str) -> list[tuple[int, str]]:
    """(line, identifier) for every forbidden identifier in the code. Docstrings and comments are not part
    of the AST, and docstrings are skipped explicitly, so prose never counts.
    """
    tree = ast.parse(source)
    docstring_nodes = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.ClassDef | ast.FunctionDef | ast.AsyncFunctionDef):
            body = node.body
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                docstring_nodes.add(id(body[0].value))
    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        names: list[str] = []
        if isinstance(node, ast.Name):
            names = [node.id]
        elif isinstance(node, ast.Attribute):
            names = [node.attr]
        elif isinstance(node, ast.arg):
            names = [node.arg]
        elif isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            names = [node.name]
        elif isinstance(node, ast.keyword) and node.arg:
            names = [node.arg]
        elif isinstance(node, ast.alias):
            names = [node.name, node.asname or ""]
        elif (
            isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstring_nodes
        ):
            names = [node.value]  # a string that is exactly a forbidden name (for example, a SQL column)
        for name in names:
            if name in FORBIDDEN:
                found.append((getattr(node, "lineno", 0), name))
    return found


def test_the_scanner_itself_flags_real_references_and_ignores_prose():
    assert _findings("x = row.ground_truth_label\n") == [(1, "ground_truth_label")]
    assert _findings("build(noise_pct=30)\n") == [(1, "noise_pct")]
    assert _findings('"""mentions scenario_label and noise"""\n# ground_truth_label\nvalue = 1\n') == []


def test_no_forbidden_identifier_in_the_agent_watchdog_debate_or_pipeline_code():
    violations: list[str] = []
    for sub in SCANNED_DIRS:
        for path in sorted((BACKEND / sub).rglob("*.py")):
            relative = path.relative_to(BACKEND).as_posix()
            allowed = _allowed_for(relative)
            for lineno, name in _findings(path.read_text(encoding="utf-8")):
                if name not in allowed:
                    violations.append(f"{relative}:{lineno}: {name}")
    assert violations == []


def test_the_allow_list_is_narrow():
    """The allow-list may not grow silently: exactly these entries, each with a named reason."""
    assert set(ALLOWED) == {"debate/engine.py", "pipeline/"}
    assert ALLOWED["debate/engine.py"] == {"scenario_label", "noise_pct", "effective_noise_pct"}


def test_the_write_only_fields_are_never_read_by_the_debate_or_the_agents():
    """Stronger than the allow-list: in engine.py, the write-only names appear only in start_investigation."""
    write_only = {"scenario_label", "noise_pct", "effective_noise_pct"}
    tree = ast.parse((BACKEND / "debate" / "engine.py").read_text(encoding="utf-8"))
    for func in (n for n in tree.body if isinstance(n, ast.FunctionDef)):
        mentions = set()
        for node in ast.walk(func):
            if isinstance(node, ast.Name):
                mentions.add(node.id)
            elif isinstance(node, ast.Attribute):
                mentions.add(node.attr)
        touched = mentions & write_only
        if touched:
            assert func.name == "start_investigation", f"{func.name} reads {sorted(touched)}"


def _row(index: int, label: str, *, source: str = "cicids2017", event_type: str = "network_flow") -> RawLog:
    return RawLog(
        timestamp=T0 + timedelta(seconds=index),
        source=source,
        event_type=event_type,
        user_id=None,
        host_id="10.0.0.5",
        raw_fields={"Destination Port": 445, "Flow Bytes/s": 1200.0 + index},
        ground_truth_label=label,
    )


def _public_view(row: RawLog) -> dict:
    """The fields an investigator is allowed to see: the same allow-list as GET /raw-logs."""
    return {
        "row_id": str(row.row_id),
        "timestamp": row.timestamp.isoformat(),
        "source": row.source,
        "source_file": row.source_file,
        "event_type": row.event_type,
        "user_id": row.user_id,
        "host_id": row.host_id,
        "severity": row.severity,
        "raw_fields": row.raw_fields,
    }


@pytest.fixture()
def _clean_state():
    redis_client = get_redis()
    redis_client.delete("verdictchain:debate:slot")
    for agent in ("network_traffic", "access_log", "endpoint_behavior"):
        reset_agent(agent)
    yield
    for agent in ("network_traffic", "access_log", "endpoint_behavior"):
        reset_agent(agent)


def test_investigators_receive_no_secret_label_and_no_noise(db_session, monkeypatch, _clean_state):
    db_session.add_all([_row(i, SECRET) for i in range(6)] + [_row(100 + i, "BENIGN") for i in range(10)])
    db_session.commit()

    # No LLM: the investigators are fakes, and the provider clients are not allowed to run.
    def _no_llm(*args, **kwargs):
        raise AssertionError("an LLM was called in the blind test")

    monkeypatch.setattr("backend.agents.llm_clients.GeminiClient.complete", _no_llm)
    monkeypatch.setattr("backend.agents.llm_clients.GroqClient.complete", _no_llm)

    captured: list[dict] = []

    def recorder(agent_id: str):
        def investigate(rows, **kwargs):
            round_no = kwargs["round_no"]
            captured.append(
                {
                    "agent": agent_id,
                    "round": round_no,
                    "rows": [_public_view(r) for r in rows],
                    "peripheral_digest": kwargs.get("peripheral_digest"),
                    "debate_context": kwargs.get("debate_context"),
                    "kwarg_names": sorted(kwargs),
                }
            )
            # An agent whose domain has no rows in this test gets an empty slice: it cites a fresh id, which
            # the Watchdog then counts as an invalid citation.
            cited_row = str(rows[0].row_id) if rows else str(uuid.uuid4())
            cited = CitedEvidence(row_id=cited_row, field="event_type", value="network_flow")
            return (
                AgentResponse(
                    agent_id=agent_id,
                    theory="ddos flood detected",
                    confidence=0.5,
                    cited_evidence=[cited],
                    round=round_no,
                ),
                "fake",
            )

        return investigate

    for agent in list(engine.INVESTIGATORS):
        monkeypatch.setitem(engine.INVESTIGATORS, agent, recorder(agent))

    rows = get_rows_for_scenario(SECRET)
    primary, primary_rows = dominant_agent_for_rows(rows)
    window, dropped, effective = dilute_with_benign(primary_rows, 30, 5)
    assert dropped, "30 % noise on a window of 5 must inject at least one benign row"
    investigation_id = start_investigation(
        trigger_type="manual",
        trigger_reason="blind test",
        scenario_label=SECRET,  # stored on the investigation row only
        primary_agent=primary,
        noise_pct=30,
        effective_noise_pct=effective,
        injected_row_ids=dropped,
        started_by="blind-test",
        max_rows_per_agent=5,
    )
    engine.run_debate(
        primary, window, investigation_id=investigation_id, max_rows_per_agent=5, on_update=None
    )

    assert captured, "the fake investigators were never called"
    serialised = json.dumps(captured, default=str, sort_keys=True)
    assert SECRET not in serialised
    assert "noise" not in serialised.lower()
    assert "effective" not in serialised.lower()
    for call in captured:
        assert not {"scenario_label", "noise_pct", "effective_noise_pct"} & set(call["kwarg_names"])

    # The noise did reach the agent as rows: a benign row is in the primary's round-1 input.
    scenario_ids = {str(r.row_id) for r in primary_rows}
    primary_round_one = [
        row["row_id"] for c in captured if c["agent"] == primary and c["round"] == 1 for row in c["rows"]
    ]
    assert set(primary_round_one) - scenario_ids, "the benign rows should be in the primary agent's input"

    session = SessionLocal()
    try:
        inv = session.get(Investigation, investigation_id)
        assert inv.scenario_label == SECRET  # the label lives on the investigation row (hidden ground truth)
        assert inv.noise_pct == 30
    finally:
        session.close()


@pytest.mark.parametrize("module", [network_traffic, access_log, endpoint_behavior], ids=lambda m: m.AGENT_ID)
@pytest.mark.parametrize("round_no", [1, 2])
def test_the_real_prompt_builders_never_print_the_label(module, round_no):
    rows = [_row(i, SECRET, event_type="network_flow") for i in range(3)]
    for row in rows:
        row.user_id = "jdoe"
    digest = build_peripheral_digest({"access_log": rows}, exclude_agent=module.AGENT_ID)
    debate_context = "access_log: theory='ddos flood detected' confidence=0.5" if round_no > 1 else None

    prompt = module.build_user_prompt(rows, round_no, digest, debate_context)

    assert SECRET not in prompt
    assert str(rows[0].row_id) in prompt  # sanity: the rows are there, only the label is not
