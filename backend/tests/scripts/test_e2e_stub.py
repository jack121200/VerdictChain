"""Tests for the offline E2E stub (backend/scripts/e2e_server.py). No network and no provider calls."""

import difflib
import json
import re
import socket
from pathlib import Path

import pytest
from fastapi import FastAPI

from backend.agents.base_agent import parse_and_validate
from backend.agents.llm_clients import GeminiClient, GroqClient
from backend.agents.schemas import AgentResponse
from backend.scripts import e2e_server as stub

AGENT_IDS = list(stub.AGENTS)
BACKEND_DIR = Path(__file__).resolve().parents[2]
_REAL_GROQ_COMPLETE = GroqClient.__dict__["complete"]
_REAL_GEMINI_COMPLETE = GeminiClient.__dict__["complete"]


@pytest.fixture(autouse=True)
def stub_installed():
    stub.CALLS.update({"groq": 0, "gemini": 0})
    stub.install()
    yield
    stub.uninstall()


def _build(agent_id: str, rows, round_no: int) -> str:
    context = None if round_no == 1 else "Prior round context: (test)"
    return stub.AGENTS[agent_id].build_user_prompt(rows, round_no, debate_context=context)


def _reply(agent_id: str, round_no: int, rows=None) -> tuple[str, str]:
    """(raw stub output, prompt) for one investigator call through the patched GroqClient."""
    rows = stub.sample_rows(agent_id) if rows is None else rows
    prompt = _build(agent_id, rows, round_no)
    return GroqClient().complete(stub.AGENTS[agent_id].SYSTEM_PROMPT, prompt), prompt


@pytest.mark.parametrize("agent_id", AGENT_IDS)
@pytest.mark.parametrize("round_no", [1, 2, 3])
def test_output_validates_against_agent_response(agent_id, round_no):
    rows = stub.sample_rows(agent_id)
    raw, _ = _reply(agent_id, round_no, rows)
    AgentResponse.model_validate_json(raw)
    response = parse_and_validate(raw, agent_id, round_no, {str(r.row_id) for r in rows})
    assert response.agent_id == agent_id and response.round == round_no
    assert 0.0 <= response.confidence <= 1.0


@pytest.mark.parametrize("agent_id", AGENT_IDS)
@pytest.mark.parametrize("round_no", [1, 2, 3])
def test_every_cited_row_id_appears_in_the_prompt(agent_id, round_no):
    rows = stub.sample_rows(agent_id)
    raw, prompt = _reply(agent_id, round_no, rows)
    response = AgentResponse.model_validate_json(raw)
    row_ids = {str(r.row_id) for r in rows}
    assert response.cited_evidence
    for entry in response.cited_evidence:
        assert entry.row_id in row_ids
        assert f'"row_id": "{entry.row_id}"' in prompt


@pytest.mark.parametrize("agent_id", AGENT_IDS)
def test_cited_values_are_copied_verbatim_from_the_prompt(agent_id):
    raw, prompt = _reply(agent_id, 1)
    response = AgentResponse.model_validate_json(raw)
    slice_by_id = {row["row_id"]: row for row in stub._data_slice(prompt)}
    for entry in response.cited_evidence:
        assert str(slice_by_id[entry.row_id][entry.field]) == entry.value


@pytest.mark.parametrize("agent_id", AGENT_IDS)
def test_rounds_two_and_three_open_with_a_stance(agent_id):
    for round_no in (2, 3):
        raw, _ = _reply(agent_id, round_no)
        theory = AgentResponse.model_validate_json(raw).theory
        assert re.match(r"(SUPPORT|CHALLENGE|REVISE):", theory), theory


@pytest.mark.parametrize("agent_id", AGENT_IDS)
def test_each_round_differs_from_the_last_below_the_duplicate_threshold(agent_id):
    # debate/state.py rejects a round as a near-duplicate at ratio >= 0.9.
    theories = [AgentResponse.model_validate_json(_reply(agent_id, r)[0]).theory for r in (1, 2, 3)]
    for earlier, later in ((0, 1), (1, 2)):
        ratio = difflib.SequenceMatcher(None, theories[earlier].lower(), theories[later].lower()).ratio()
        assert ratio < 0.9, ratio


def test_domain_theories_name_the_agreed_domain():
    def round_one(agent_id: str) -> str:
        return AgentResponse.model_validate_json(_reply(agent_id, 1)[0]).theory.lower()

    assert "flood" in round_one("network_traffic")
    assert "exfiltration" in round_one("access_log")
    assert "off-hours" in round_one("endpoint_behavior")


def test_output_ignores_label_and_noise_keys():
    rows = stub.sample_rows("network_traffic")
    plain, _ = _reply("network_traffic", 1, rows)
    for row in rows:
        row.raw_fields = {
            **row.raw_fields,
            "ground_truth_label": "ddos",
            "scenario_label": "DDoS",
            "noise_pct": 30,
        }
    labelled, prompt = _reply("network_traffic", 1, rows)
    assert "ground_truth_label" in prompt and "scenario_label" in prompt
    assert labelled == plain
    assert all(e["field"] not in stub._NEVER_CITED for e in json.loads(labelled)["cited_evidence"])


def test_stub_never_opens_a_socket(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("the stub attempted a network call")

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    _, prompt = _reply("access_log", 1)
    system = stub.AGENTS["access_log"].SYSTEM_PROMPT
    assert json.loads(GroqClient().complete(system, prompt))["agent_id"] == "access_log"
    assert json.loads(GeminiClient().complete(system, prompt))["round"] == 1


def test_non_investigator_prompt_gets_plain_text():
    reply = GeminiClient().complete("You write concise audit-log justifications.", "anything")
    assert reply == stub._FALLBACK_TEXT


def test_counter_increments_per_provider_and_is_served_by_the_route():
    _, prompt = _reply("network_traffic", 1)
    GroqClient().complete(stub.AGENTS["network_traffic"].SYSTEM_PROMPT, prompt)
    GeminiClient().complete(stub.AGENTS["network_traffic"].SYSTEM_PROMPT, prompt)
    assert stub.CALLS == {"groq": 2, "gemini": 1}
    app = FastAPI()
    stub.add_stub_route(app)
    (route,) = [r for r in app.routes if getattr(r, "path", "") == "/__e2e/stub-calls"]
    assert "GET" in route.methods
    assert route.endpoint() == {"groq": 2, "gemini": 1}


def test_install_is_reversible():
    stub.uninstall()
    assert GroqClient.__dict__["complete"] is _REAL_GROQ_COMPLETE
    assert GeminiClient.__dict__["complete"] is _REAL_GEMINI_COMPLETE
    stub.install()
    assert GroqClient.__dict__["complete"] is not _REAL_GROQ_COMPLETE


def test_stub_output_is_labelled_as_stub_and_the_names_come_back():
    # The debate engine stores provider.name on every transcript row, so stub data must say it is stub.
    assert (GroqClient.name, GeminiClient.name) == ("stub-groq", "stub-gemini")
    stub.install()  # a second install must not stack the prefix
    assert (GroqClient.name, GeminiClient.name) == ("stub-groq", "stub-gemini")
    stub.uninstall()
    assert (GroqClient.name, GeminiClient.name) == ("groq", "gemini")
    assert GroqClient.__dict__["complete"] is _REAL_GROQ_COMPLETE


def test_selftest_prints_ok(capsys):
    stub.selftest()
    assert capsys.readouterr().out.strip().endswith("OK")


def test_application_code_never_imports_the_harness():
    for path in BACKEND_DIR.rglob("*.py"):
        if path.relative_to(BACKEND_DIR).parts[0] in ("scripts", "tests"):
            continue
        text = path.read_text(encoding="utf-8")
        assert "e2e_server" not in text and "__e2e" not in text, str(path)
