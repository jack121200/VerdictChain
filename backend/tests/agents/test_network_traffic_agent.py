import json
import uuid

from backend.agents import network_traffic
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


def test_build_user_prompt_includes_round2_challenge_instructions():
    row = _fake_row(label="x", dst_port=22)
    prompt = network_traffic.build_user_prompt([row], round_no=2, debate_context="Access-Log agent said Y.")
    assert "CHALLENGE" in prompt
    assert "Access-Log agent said Y." in prompt


class FakeProvider:
    def __init__(self, name: str, response: str | None = None, error: Exception | None = None):
        self.name = name
        self._response = response
        self._error = error

    def complete(self, system_prompt: str, user_prompt: str) -> str:
        if self._error:
            raise self._error
        return self._response


def test_investigate_end_to_end_with_mocked_provider(monkeypatch):
    row = _fake_row(label="DDoS", dst_port=445)
    valid_payload = {
        "agent_id": "network_traffic",
        "theory": "Flow volume suggests DDoS.",
        "confidence": 0.75,
        "cited_evidence": [{"row_id": str(row.row_id), "field": "Flow Bytes/s", "value": "999999.0"}],
        "round": 1,
    }

    monkeypatch.setattr(network_traffic, "GroqClient", lambda: FakeProvider("groq", response=json.dumps(valid_payload)))
    monkeypatch.setattr(network_traffic, "GeminiClient", lambda: FakeProvider("gemini", response="unused"))

    response, provider_used = network_traffic.investigate([row], round_no=1)

    assert provider_used == "groq"
    assert response.agent_id == "network_traffic"
    assert response.cited_evidence[0].row_id == str(row.row_id)


def test_investigate_falls_back_to_gemini_on_groq_failure(monkeypatch):
    row = _fake_row(label="Portscan", dst_port=22)
    valid_payload = {
        "agent_id": "network_traffic",
        "theory": "Scan pattern detected.",
        "confidence": 0.6,
        "cited_evidence": [{"row_id": str(row.row_id), "field": "Destination Port", "value": "22"}],
        "round": 1,
    }

    monkeypatch.setattr(network_traffic, "GroqClient", lambda: FakeProvider("groq", error=RuntimeError("down")))
    monkeypatch.setattr(network_traffic, "GeminiClient", lambda: FakeProvider("gemini", response=json.dumps(valid_payload)))

    response, provider_used = network_traffic.investigate([row], round_no=1)

    assert provider_used == "gemini"
    assert response.theory == "Scan pattern detected."
