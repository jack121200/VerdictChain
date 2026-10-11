import json
import uuid

import pytest

from backend.agents import network_traffic
from backend.agents.llm_clients import OpenAIError, OpenAIUnavailable
from backend.db.models import RawLog


def _fake_row(label: str, dst_port: int) -> RawLog:
    row = RawLog(
        row_id=uuid.uuid4(),
        timestamp="2017-07-07T01:00:00+00:00",
        source="cicids2017",
        event_type="network_flow",
        raw_fields={"Destination Port": dst_port, "Flow Bytes/s": 999999.0},
        ground_truth_label=label,
    )
    return row


def test_build_user_prompt_never_contains_ground_truth_label():
    row = _fake_row(label="SUPER_SECRET_DDOS_SCENARIO", dst_port=445)
    prompt = network_traffic.build_user_prompt([row], round_no=1)
    assert "SUPER_SECRET_DDOS_SCENARIO" not in prompt
    assert "445" in prompt  # the actual feature data IS present


def test_the_prompt_carries_the_fields_the_agent_is_told_to_read_not_all_sixty_seven():
    """Every field costs tokens on every call of every round, and the key has a small allowance."""
    row = _fake_row(label="x", dst_port=80)
    row.raw_fields.update(
        {"SYN Flag Count": 1, "Idle Max": 5, "Fwd Header Length": 32, "Init_Win_bytes_forward": 8192}
    )

    prompt = network_traffic.build_user_prompt([row], round_no=1)

    for named in ("Destination Port", "Flow Bytes/s", "SYN Flag Count", "Idle Max"):
        assert named in prompt
    assert "Fwd Header Length" not in prompt and "Init_Win_bytes_forward" not in prompt
    assert str(row.row_id) in prompt


def test_a_row_with_none_of_the_named_fields_is_shown_whole():
    row = RawLog(
        row_id=uuid.uuid4(),
        timestamp="2017-07-07T01:00:00+00:00",
        source="cicids2017",
        event_type="network_flow",
        raw_fields={"some other column": 7},
        ground_truth_label="x",
    )

    assert "some other column" in network_traffic.build_user_prompt([row], round_no=1)


def test_the_prompt_asks_for_one_field_per_citation_and_the_round_to_be_echoed():
    row = _fake_row(label="x", dst_port=22)

    assert "ONE field of ONE row" in network_traffic.SYSTEM_PROMPT
    assert 'Put "round": 2 in your JSON answer.' in network_traffic.build_user_prompt([row], round_no=2)
    assert "Round: 2" in network_traffic.build_user_prompt([row], round_no=2).splitlines()  # the stub's line


def test_build_user_prompt_includes_round2_challenge_instructions():
    row = _fake_row(label="x", dst_port=22)
    prompt = network_traffic.build_user_prompt([row], round_no=2, debate_context="Access-Log agent said Y.")
    assert "CHALLENGE" in prompt
    assert "Access-Log agent said Y." in prompt


class FakeProvider:
    """Stands in for OpenAIClient: answers with `responses` in order; an Exception in the list is raised."""

    name = "openai"

    def __init__(self, *responses):
        self._responses = list(responses)
        self.calls = 0

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        self.calls += 1
        item = self._responses.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _payload(row, **overrides) -> str:
    payload = {
        "agent_id": "network_traffic",
        "theory": "Flow volume suggests DDoS.",
        "confidence": 0.75,
        "cited_evidence": [{"row_id": str(row.row_id), "field": "Flow Bytes/s", "value": "999999.0"}],
        "round": 1,
    }
    payload.update(overrides)
    return json.dumps(payload)


def test_investigate_end_to_end_with_mocked_provider(monkeypatch):
    row = _fake_row(label="DDoS", dst_port=445)
    provider = FakeProvider(_payload(row))
    monkeypatch.setattr(network_traffic, "OpenAIClient", lambda: provider)

    response, provider_used = network_traffic.investigate([row], round_no=1)

    assert provider_used == "openai"
    assert response.agent_id == "network_traffic"
    assert response.cited_evidence[0].row_id == str(row.row_id)
    assert provider.calls == 1


def test_investigate_tries_again_after_a_transient_failure(monkeypatch):
    row = _fake_row(label="Portscan", dst_port=22)
    provider = FakeProvider(
        OpenAIUnavailable("openai answered 503"), _payload(row, theory="Scan pattern detected.")
    )
    monkeypatch.setattr(network_traffic, "OpenAIClient", lambda: provider)
    monkeypatch.setattr("backend.agents.base_agent.time.sleep", lambda _seconds: None)

    response, provider_used = network_traffic.investigate([row], round_no=1)

    assert provider_used == "openai"
    assert response.theory == "Scan pattern detected."
    assert provider.calls == 2


def test_investigate_raises_a_hard_failure_at_once(monkeypatch):
    row = _fake_row(label="DDoS", dst_port=445)
    provider = FakeProvider(OpenAIError("OpenAI rejected the API key (401)."), _payload(row))
    monkeypatch.setattr(network_traffic, "OpenAIClient", lambda: provider)

    with pytest.raises(OpenAIError):
        network_traffic.investigate([row], round_no=1)
    assert provider.calls == 1  # a bad key is not worth a second try
