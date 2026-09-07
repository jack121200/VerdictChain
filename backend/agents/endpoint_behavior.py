"""Endpoint-Behavior Investigator Agent (SKILL-agent-prompts.md Section 3).
Routed to Gemini (SKILL-agent-prompts.md Section 7). Works on raw_logs rows
with event_type in {"logon", "device_event"} (normalize_cert_logon_row /
normalize_cert_device_row) - the only agent whose data slice spans two
event_types, per SKILL-architecture.md's assignment of both logon.csv and
device.csv to this agent.
"""

import json

from backend.agents.base_agent import call_with_fallback, parse_and_validate
from backend.agents.llm_clients import GeminiClient, GroqClient
from backend.agents.schemas import AgentResponse
from backend.db.models import RawLog

AGENT_ID = "endpoint_behavior"

SYSTEM_PROMPT = """You are the Endpoint-Behavior Investigator Agent in VerdictChain. You analyze login
and device-usage log data (login time, device ID/fingerprint, session length) to
detect insider-threat behavior: login-time anomalies, unrecognized-device logins,
and credential-misuse / privilege-escalation patterns.

Rules:
- You are given ONLY your own data slice plus a short peripheral-awareness digest
  of what the other two agents observed. You are never told which scenario, if any,
  was manually selected for this investigation - treat every case as unknown.
- Every claim you make must cite a specific row from the data you were given, using
  its row_id. Never state a conclusion without a citation.
- Output strictly the JSON schema you were given. No prose outside the JSON.
- Distinguishing signals: off_hours flag (computed from the user's OWN historical
  logon pattern, not a global cutoff) and logon/logoff counts from logon rows;
  connect_count and distinct_pcs_with_device_activity from device rows. Note:
  device rows identify which PC saw device activity, not a specific USB device
  serial - treat "distinct_pcs_with_device_activity" as a proxy, not a literal
  device fingerprint count.

Respond with a single JSON object matching exactly:
{"agent_id": "endpoint_behavior", "theory": "...", "confidence": 0.0,
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
    normalize_cert_logon_row()/normalize_cert_device_row() keeping the label out
    of raw_fields by construction. rows may mix event_type == "logon" and
    "device_event" - event_type is included per row so the model can tell them apart.
    """
    data_slice = [
        {"row_id": str(row.row_id), "user_id": row.user_id, "event_type": row.event_type, **row.raw_fields}
        for row in rows
    ]

    parts = [
        f"Round: {round_no}",
        f"Your data slice ({len(data_slice)} logon/device-event user-day summaries):",
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
    """Returns (response, provider_name). Groq primary here would be inconsistent
    with SKILL-agent-prompts.md Section 7's routing table (Gemini for this agent),
    so Gemini is primary and Groq is the fallback - the only agent with that order.
    """
    if not rows:
        raise ValueError("investigate() requires at least one row")

    user_prompt = build_user_prompt(rows, round_no, peripheral_digest, debate_context)
    raw_text, provider_used = call_with_fallback(GeminiClient(), GroqClient(), SYSTEM_PROMPT, user_prompt)

    valid_row_ids = {str(row.row_id) for row in rows}
    response = parse_and_validate(
        raw_text, expected_agent_id=AGENT_ID, expected_round=round_no, valid_row_ids=valid_row_ids
    )
    return response, provider_used
