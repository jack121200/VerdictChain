import json
import uuid

from backend.agents import endpoint_behavior
from backend.db.models import RawLog


def _fake_row(label: str, event_type: str, **fields) -> RawLog:
    return RawLog(
        row_id=uuid.uuid4(),
        timestamp="2010-01-02T00:00:00+00:00",
        source=f"cert_r4.2_{'logon' if event_type == 'logon' else 'device'}",
        event_type=event_type,
        user_id="AAM0658",
        raw_fields=fields,
        ground_truth_label=label,
    )


def test_build_user_prompt_never_contains_ground_truth_label():
    row = _fake_row("SUPER_SECRET_INSIDER_SCENARIO", "logon", off_hours=True, logon_count=3)
    prompt = endpoint_behavior.build_user_prompt([row], round_no=1)
    assert "SUPER_SECRET_INSIDER_SCENARIO" not in prompt
    assert "off_hours" in prompt


def test_build_user_prompt_mixes_logon_and_device_event_types():
    logon_row = _fake_row("benign", "logon", off_hours=False)
    device_row = _fake_row("benign", "device_event", connect_count=2)
    prompt = endpoint_behavior.build_user_prompt([logon_row, device_row], round_no=1)
    assert '"event_type": "logon"' in prompt
    assert '"event_type": "device_event"' in prompt


class FakeProvider:
    def __init__(self, name, response=None, error=None):
        self.name = name
        self._response = response
        self._error = error

    def complete(self, system_prompt, user_prompt):
        if self._error:
            raise self._error
        return self._response


def test_investigate_uses_gemini_as_primary_not_groq(monkeypatch):
    """Per SKILL-agent-prompts.md Section 7, this is the one agent routed to
    Gemini as primary - reversed order from the other two agents.
    """
    row = _fake_row("insider_scenario_2", "device_event", connect_count=15)
    payload = {
        "agent_id": "endpoint_behavior",
        "theory": "Unusual device connect frequency.",
        "confidence": 0.65,
        "cited_evidence": [{"row_id": str(row.row_id), "field": "connect_count", "value": "15"}],
        "round": 1,
    }
    monkeypatch.setattr(
        endpoint_behavior, "GeminiClient", lambda: FakeProvider("gemini", response=json.dumps(payload))
    )
    monkeypatch.setattr(endpoint_behavior, "GroqClient", lambda: FakeProvider("groq", response="unused"))

    response, provider_used = endpoint_behavior.investigate([row], round_no=1)
    assert provider_used == "gemini"
    assert response.agent_id == "endpoint_behavior"


def test_investigate_falls_back_to_groq_on_gemini_failure(monkeypatch):
    row = _fake_row("benign", "logon", off_hours=False)
    payload = {
        "agent_id": "endpoint_behavior",
        "theory": "Normal login pattern.",
        "confidence": 0.9,
        "cited_evidence": [{"row_id": str(row.row_id), "field": "off_hours", "value": "False"}],
        "round": 1,
    }
    monkeypatch.setattr(
        endpoint_behavior, "GeminiClient", lambda: FakeProvider("gemini", error=RuntimeError("down"))
    )
    monkeypatch.setattr(
        endpoint_behavior, "GroqClient", lambda: FakeProvider("groq", response=json.dumps(payload))
    )

    response, provider_used = endpoint_behavior.investigate([row], round_no=1)
    assert provider_used == "groq"
