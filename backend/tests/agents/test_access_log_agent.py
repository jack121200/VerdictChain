import json
import uuid

from backend.agents import access_log
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
    def __init__(self, name, response=None, error=None):
        self.name = name
        self._response = response
        self._error = error

    def complete(self, system_prompt, user_prompt):
        if self._error:
            raise self._error
        return self._response


def test_investigate_uses_groq_as_primary(monkeypatch):
    row = _fake_row(label="insider_scenario_1", file_count=80)
    payload = {
        "agent_id": "access_log",
        "theory": "Unusually high file access volume.",
        "confidence": 0.7,
        "cited_evidence": [{"row_id": str(row.row_id), "field": "file_access_count", "value": "80"}],
        "round": 1,
    }
    monkeypatch.setattr(access_log, "GroqClient", lambda: FakeProvider("groq", response=json.dumps(payload)))
    monkeypatch.setattr(access_log, "GeminiClient", lambda: FakeProvider("gemini", response="unused"))

    response, provider_used = access_log.investigate([row], round_no=1)
    assert provider_used == "groq"
    assert response.agent_id == "access_log"
