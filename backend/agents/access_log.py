"""Access-Log Investigator Agent (SKILL-agent-prompts.md Section 2).
Routed to Groq (SKILL-agent-prompts.md Section 7). Works on raw_logs rows with
event_type == "file_access" (backend.pipeline.normalization.normalize_cert_file_row).
"""

import json

from backend.agents.base_agent import call_with_fallback, parse_and_validate
from backend.agents.llm_clients import GeminiClient, GroqClient
from backend.agents.schemas import AgentResponse
from backend.db.models import RawLog

AGENT_ID = "access_log"

SYSTEM_PROMPT = """You are the Access-Log Investigator Agent in VerdictChain. You analyze file-access
log data (user, file path, department, access timestamp) to detect insider-threat
behavior: unauthorized or off-hours cross-department file access, and unusual data
exfiltration patterns.

Rules:
- You are given ONLY your own data slice plus a short peripheral-awareness digest
  of what the other two agents observed. You are never told which scenario, if any,
  was manually selected for this investigation - treat every case as unknown.
- Every claim you make must cite a specific row from the data you were given, using
  its row_id. Never state a conclusion without a citation.
- Output strictly the JSON schema you were given. No prose outside the JSON.
- Distinguishing signals: unusually large or unusually frequent file access in a
  short window (file_access_count, distinct_filenames); the accessing user's own
  department (user_department) as context. Note: a resource-owner department to
  compare against is not always present in this data - do not assume a mismatch
  signal exists if user_department is the only department field given.

Respond with a single JSON object matching exactly:
{"agent_id": "access_log", "theory": "...", "confidence": 0.0,
 "cited_evidence": [{"row_id": "...", "field": "...", "value": "..."}], "round": 1}
"""

_ROUND_2_3_INSTRUCTIONS = """
You have seen the other investigator agents' theories and evidence. You must do
ONE of the following, explicitly stated at the start of your response:
- CHALLENGE: state exactly which other agent's theory you disagree with and why,
  citing evidence.
- SUPPORT: state which other agent's theory you agree with and why.
- REVISE: update your own theory in light of what you've seen, explaining the change.
Do not simply restate your previous round's message. A response that is
substantially identical to your prior round will be rejected.
"""


def build_user_prompt(
    rows: list[RawLog],
    round_no: int,
    peripheral_digest: dict | None = None,
    debate_context: str | None = None,
) -> str:
    """rows must carry only raw_fields (never ground_truth_label) - enforced by
    normalize_cert_file_row() keeping the label out of raw_fields by construction.
    """
    data_slice = [{"row_id": str(row.row_id), "user_id": row.user_id, **row.raw_fields} for row in rows]

    parts = [
        f"Round: {round_no}",
        f"Your data slice ({len(data_slice)} user-day file-access summaries):",
        json.dumps(data_slice, default=str),
        "Peripheral-awareness digest (other domains, same window):",
        json.dumps(peripheral_digest or {"note": "no other agents active yet"}),
    ]

    if round_no > 1:
        parts.append(_ROUND_2_3_INSTRUCTIONS)
        parts.append("Prior round context:")
        parts.append(debate_context or "(none provided)")

    return "\n\n".join(parts)


def investigate(
    rows: list[RawLog],
    round_no: int = 1,
    peripheral_digest: dict | None = None,
    debate_context: str | None = None,
) -> tuple[AgentResponse, str]:
    """Returns (response, provider_name)."""
    if not rows:
        raise ValueError("investigate() requires at least one row")

    user_prompt = build_user_prompt(rows, round_no, peripheral_digest, debate_context)
    raw_text, provider_used = call_with_fallback(GroqClient(), GeminiClient(), SYSTEM_PROMPT, user_prompt)

    valid_row_ids = {str(row.row_id) for row in rows}
    response = parse_and_validate(
        raw_text, expected_agent_id=AGENT_ID, expected_round=round_no, valid_row_ids=valid_row_ids
    )
    return response, provider_used
