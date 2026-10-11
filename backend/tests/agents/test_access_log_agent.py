import json
import uuid

import pytest

from backend.agents import access_log
from backend.agents.base_agent import InvalidAgentResponse
from backend.db.models import RawLog


def _fake_row(label: str, file_count: int) -> RawLog:
    return RawLog(
        row_id=uuid.uuid4(),
        timestamp="2010-01-02T00:00:00+00:00",
        source="cert_r4.2_file",
        event_type="file_access",
        user_id="AAM0658",
        raw_fields={"file_access_count": file_count, "user_department": "Engineering"},
        ground_truth_label=label,
    )


def test_build_user_prompt_never_contains_ground_truth_label():
    row = _fake_row(label="SUPER_SECRET_INSIDER_SCENARIO", file_count=50)
    prompt = access_log.build_user_prompt([row], round_no=1)
    assert "SUPER_SECRET_INSIDER_SCENARIO" not in prompt
    assert "50" in prompt


class FakeProvider:
    name = "openai"

    def __init__(self, response):
        self._response = response

    def complete(self, system_prompt, user_prompt):
        return self._response


def _payload(row, **cited) -> str:
    return json.dumps(
        {
            "agent_id": "access_log",
            "theory": "Unusually high file access volume.",
            "confidence": 0.7,
            "cited_evidence": [
                {"row_id": str(row.row_id), "field": "file_access_count", "value": "80", **cited}
            ],
            "round": 1,
        }
    )


def test_investigate_asks_openai(monkeypatch):
    row = _fake_row(label="insider_scenario_1", file_count=80)
    monkeypatch.setattr(access_log, "OpenAIClient", lambda: FakeProvider(_payload(row)))

    response, provider_used = access_log.investigate([row], round_no=1)
    assert provider_used == "openai"
    assert response.agent_id == "access_log"


def test_investigate_keeps_a_number_the_model_wrote_as_a_number(monkeypatch):
    """A model often writes "value": 80 where the schema wants "80"; the Watchdog compares the text."""
    row = _fake_row(label="insider_scenario_1", file_count=80)
    raw = json.loads(_payload(row))
    raw["cited_evidence"][0]["value"] = 80
    monkeypatch.setattr(access_log, "OpenAIClient", lambda: FakeProvider(json.dumps(raw)))

    response, _ = access_log.investigate([row], round_no=1)
    assert response.cited_evidence[0].value == "80"


def test_investigate_rejects_a_citation_from_outside_the_slice(monkeypatch):
    row = _fake_row(label="insider_scenario_1", file_count=80)
    other = _fake_row(label="insider_scenario_1", file_count=5)
    monkeypatch.setattr(access_log, "OpenAIClient", lambda: FakeProvider(_payload(other)))

    with pytest.raises(InvalidAgentResponse):
        access_log.investigate([row], round_no=1)
