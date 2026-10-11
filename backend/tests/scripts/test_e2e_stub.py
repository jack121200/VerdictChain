"""Tests for the offline E2E stub (backend/testing/e2e_server.py). No network and no provider calls."""

import difflib
import json
import os
import re
import socket
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.agents import openai_usage
from backend.agents.base_agent import parse_and_validate
from backend.agents.llm_clients import OpenAIClient
from backend.agents.schemas import AgentResponse
from backend.testing import e2e_server as stub

AGENT_IDS = list(stub.AGENTS)
BACKEND_DIR = Path(__file__).resolve().parents[2]
_REAL_COMPLETE = OpenAIClient.__dict__["complete"]
_REAL_COMPLETE_TEXT = OpenAIClient.__dict__["complete_text"]


@pytest.fixture(autouse=True)
def stub_installed():
    stub.CALLS.update({"openai": 0})
    stub.install()
    yield
    stub.uninstall()


def _build(agent_id: str, rows, round_no: int) -> str:
    context = None if round_no == 1 else "Prior round context: (test)"
    return stub.AGENTS[agent_id].build_user_prompt(rows, round_no, debate_context=context)


def _reply(agent_id: str, round_no: int, rows=None) -> tuple[str, str]:
    """(raw stub output, prompt) for one investigator call through the patched OpenAIClient."""
    rows = stub.sample_rows(agent_id) if rows is None else rows
    prompt = _build(agent_id, rows, round_no)
    return OpenAIClient().complete(stub.AGENTS[agent_id].SYSTEM_PROMPT, prompt), prompt


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
    # The access-log prompt shows every field of a row, so the injected keys really are in front of the stub.
    rows = stub.sample_rows("access_log")
    plain, _ = _reply("access_log", 1, rows)
    for row in rows:
        row.raw_fields = {
            **row.raw_fields,
            "ground_truth_label": "ddos",
            "scenario_label": "DDoS",
            "noise_pct": 30,
        }
    labelled, prompt = _reply("access_log", 1, rows)
    assert "ground_truth_label" in prompt and "scenario_label" in prompt
    assert labelled == plain
    assert all(e["field"] not in stub._NEVER_CITED for e in json.loads(labelled)["cited_evidence"])


def test_the_network_prompt_is_an_allow_list_so_a_label_key_cannot_reach_the_model_at_all():
    rows = stub.sample_rows("network_traffic")
    for row in rows:
        row.raw_fields = {**row.raw_fields, "ground_truth_label": "ddos", "scenario_label": "DDoS"}

    _, prompt = _reply("network_traffic", 1, rows)

    assert (
        "ground_truth_label" not in prompt and "scenario_label" not in prompt and "ddos" not in prompt.lower()
    )


def test_stub_never_opens_a_socket(monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("the stub attempted a network call")

    monkeypatch.setattr(socket, "socket", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    _, prompt = _reply("access_log", 1)
    system = stub.AGENTS["access_log"].SYSTEM_PROMPT
    assert json.loads(OpenAIClient().complete(system, prompt))["agent_id"] == "access_log"
    assert json.loads(OpenAIClient().complete(system, prompt))["round"] == 1


def test_non_investigator_prompt_gets_plain_text():
    assert (
        OpenAIClient().complete("You write concise audit-log justifications.", "anything")
        == stub._FALLBACK_TEXT
    )
    assert (
        OpenAIClient().complete_text("You write concise audit-log justifications.", "anything")
        == stub._FALLBACK_TEXT
    )


def test_counter_increments_per_call_and_is_served_by_the_route():
    _, prompt = _reply("network_traffic", 1)
    OpenAIClient().complete(stub.AGENTS["network_traffic"].SYSTEM_PROMPT, prompt)
    OpenAIClient().complete_text("reason", "anything")
    assert stub.CALLS == {"openai": 3}
    app = FastAPI()
    stub.add_stub_route(app)
    (route,) = [r for r in app.routes if getattr(r, "path", "") == "/__e2e/stub-calls"]
    assert "GET" in route.methods
    assert route.endpoint() == {"openai": 3}


def test_install_is_reversible():
    stub.uninstall()
    assert OpenAIClient.__dict__["complete"] is _REAL_COMPLETE
    assert OpenAIClient.__dict__["complete_text"] is _REAL_COMPLETE_TEXT
    stub.install()
    assert OpenAIClient.__dict__["complete"] is not _REAL_COMPLETE
    assert OpenAIClient.__dict__["complete_text"] is not _REAL_COMPLETE_TEXT


def test_stub_output_is_labelled_as_stub_and_the_names_come_back():
    # The debate engine stores provider.name on every transcript row, so stub data must say it is stub.
    assert OpenAIClient.name == "stub-openai"
    stub.install()  # a second install must not stack the prefix
    assert OpenAIClient.name == "stub-openai"
    stub.uninstall()
    assert OpenAIClient.name == "openai"
    assert OpenAIClient.__dict__["complete"] is _REAL_COMPLETE


def test_fabricate_mode_corrupts_only_the_named_agents_values():
    rows = stub.sample_rows("access_log")
    honest, _ = _reply("access_log", 1, rows)
    assert stub.set_fabricate(["access_log"]) == ["access_log"]
    fabricated, _ = _reply("access_log", 1, rows)
    other, _ = _reply("network_traffic", 1)

    honest_cited = json.loads(honest)["cited_evidence"]
    fabricated_cited = json.loads(fabricated)["cited_evidence"]
    assert [e["row_id"] for e in fabricated_cited] == [e["row_id"] for e in honest_cited]  # real rows
    assert all(e["value"] == stub._FABRICATED_VALUE for e in fabricated_cited)  # wrong values
    assert all(e["value"] != stub._FABRICATED_VALUE for e in json.loads(other)["cited_evidence"])
    # The agent layer only checks that the cited row ids are in its slice, so this reaches the Watchdog.
    parse_and_validate(fabricated, "access_log", 1, {str(r.row_id) for r in rows})

    stub.uninstall()  # also switches fabricate mode off
    assert stub.get_fabricate() == {"agents": []}


def test_set_fabricate_rejects_names_that_are_not_investigators():
    with pytest.raises(ValueError, match="unknown investigator"):
        stub.set_fabricate(["watchdog"])
    assert stub.get_fabricate() == {"agents": []}


def test_fabricate_route_round_trip():
    app = FastAPI()
    stub.add_stub_route(app)
    http = TestClient(app)
    assert http.post("/__e2e/fabricate", json={"agents": ["endpoint_behavior"]}).json() == {
        "agents": ["endpoint_behavior"]
    }
    assert http.get("/__e2e/fabricate").json() == {"agents": ["endpoint_behavior"]}
    assert http.post("/__e2e/fabricate", json={"agents": ["nobody"]}).status_code == 422
    assert http.post("/__e2e/fabricate", json={"agents": []}).json() == {"agents": []}


def test_quota_mode_fails_the_model_call_like_an_account_with_no_quota_left_and_turns_off_again():
    from backend.agents.llm_clients import ProviderRateLimited
    from backend.debate.failure import explain_failure

    rows = stub.sample_rows("network_traffic")
    system = stub.AGENTS["network_traffic"].SYSTEM_PROMPT
    prompt = _build("network_traffic", rows, 1)

    stub.set_quota_exhausted(True)
    with pytest.raises(ProviderRateLimited) as raised:
        OpenAIClient().complete(system, prompt)
    assert raised.value.daily is True  # a daily limit is not retried: the debate fails at once
    # The sentence the analyst reads is the real code's.
    assert explain_failure(raised.value) == (
        "The openai account has no quota or credit left. Add credit in the OpenAI account, then try again."
    )

    stub.set_quota_exhausted(False)
    AgentResponse.model_validate_json(OpenAIClient().complete(system, prompt))  # normal again
    stub.set_quota_exhausted(True)
    stub.uninstall()  # also switches quota mode off
    assert stub.get_quota() == {"exhausted": False}


def test_quota_route_round_trip():
    app = FastAPI()
    stub.add_stub_route(app)
    http = TestClient(app)
    assert http.get("/__e2e/quota").json() == {"exhausted": False}
    assert http.post("/__e2e/quota", json={"exhausted": True}).json() == {"exhausted": True}
    assert http.get("/__e2e/quota").json() == {"exhausted": True}
    assert http.post("/__e2e/quota", json={"exhausted": False}).json() == {"exhausted": False}


def test_serving_the_stub_forgets_a_limit_that_real_runs_recorded():
    """The offline demo (Plan B) must work after a real run met the key's limit: the stub calls no one."""
    openai_usage.record_limits(
        {"x-ratelimit-limit-requests": "50", "x-ratelimit-remaining-requests": "0"}, blocked_for_s=3600
    )
    assert openai_usage.allowance_block() is not None  # the reading really blocks a debate

    stub.forget_provider_limits()

    assert openai_usage.allowance_block() is None
    assert openai_usage.read_limits() is None


def test_selftest_prints_ok(capsys):
    stub.selftest()
    assert capsys.readouterr().out.strip().endswith("OK")


def test_application_code_never_imports_the_harness():
    for path in BACKEND_DIR.rglob("*.py"):
        if path.relative_to(BACKEND_DIR).parts[0] in ("scripts", "testing", "tests"):
            continue
        text = path.read_text(encoding="utf-8")
        assert "e2e_server" not in text and "__e2e" not in text, str(path)


@pytest.mark.parametrize("agent_id", AGENT_IDS)
def test_the_stub_states_its_class_and_its_wording_reads_as_the_same_class(agent_id):
    """The stub answers as the prompts ask (a stance word from round 2, a vote_class always), and the keyword
    reading of its round-3 wording agrees with the class it states, so old and new readings never disagree."""
    from backend.debate.verdict import classify_theory

    raw, _prompt = _reply(agent_id, 3)
    answer = json.loads(raw)

    assert answer["vote_class"] == stub._VOTE_CLASS[agent_id]
    assert classify_theory(answer["theory"]) == answer["vote_class"]
    assert answer["stance"] in ("CHALLENGE", "SUPPORT", "REVISE")
    assert json.loads(_reply(agent_id, 1)[0])["stance"] is None  # round 1 has no stance


def test_the_harness_and_the_checks_that_need_a_real_key_have_their_own_packages():
    """ST9: backend/scripts holds tools a developer runs; the stub is a test harness (backend/testing) and the
    checks that call the real model sit in backend/scripts/live_smoke."""
    assert (BACKEND_DIR / "testing" / "e2e_server.py").is_file()
    assert not (BACKEND_DIR / "scripts" / "e2e_server.py").exists()
    assert not list((BACKEND_DIR / "scripts").glob("smoke_test_*.py"))
    assert len(list((BACKEND_DIR / "scripts" / "live_smoke").glob("smoke_test_*_live.py"))) == 3


def test_no_file_still_names_the_old_homes_of_the_stub_and_the_smoke_scripts():
    root = BACKEND_DIR.parent
    old = ("backend.scripts.e2e_server", "backend/scripts/e2e_server", "backend.scripts.smoke_test")
    skipped_dirs = {"node_modules", ".venv", ".git", "dist", "reference", "__pycache__", "test-results"}
    suffixes = {".py", ".md", ".yml", ".yaml", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".toml"}
    stale = []
    for folder, dirs, files in os.walk(root):
        dirs[:] = [name for name in dirs if name not in skipped_dirs]
        for name in files:
            path = Path(folder) / name
            if path.suffix not in suffixes or path.name == "CHECKLIST.md" or path == Path(__file__).resolve():
                continue  # CHECKLIST.md tells the story of the move
            text = path.read_text(encoding="utf-8", errors="ignore")
            stale += [f"{path.relative_to(root)}: {phrase}" for phrase in old if phrase in text]
    assert stale == []
