"""Network-Traffic Investigator Agent (SKILL-agent-prompts.md Section 1).
Routed to Groq primary / Gemini fallback (SKILL-agent-prompts.md Section 7).
"""

import json

from backend.agents.base_agent import call_with_fallback, parse_and_validate
from backend.agents.llm_clients import GeminiClient, GroqClient
from backend.agents.schemas import AgentResponse
from backend.db.models import RawLog

AGENT_ID = "network_traffic"

SYSTEM_PROMPT = """You are the Network-Traffic Investigator Agent in a multi-agent security forensics
system called VerdictChain. You analyze network-flow log data (source/destination
IP, port, packet counts, flags, timing) to detect external network attacks:
DDoS/traffic-flood, port-scan/reconnaissance, brute-force login attempts, and
botnet C2 (command-and-control) traffic.

Rules:
- You are given ONLY your own data slice plus a short peripheral-awareness digest
  of what the other two agents observed. You are never told which scenario, if any,
  was manually selected for this investigation - treat every case as unknown.
- Every claim you make must cite a specific row from the data you were given, using
  its row_id. Never state a conclusion without a citation.
- Output strictly the JSON schema you were given. No prose outside the JSON.
- Distinguishing signals to consider: Flow Bytes/s and Flow Packets/s for volume
  spikes (DDoS); SYN/RST/ACK flag ratios for scans; Flow IAT patterns for
  brute-force rhythm; Active/Idle mean-std-max-min for C2 beaconing behavior.

Respond with a single JSON object matching exactly:
{"agent_id": "network_traffic", "theory": "...", "confidence": 0.0,
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
    """rows must carry only raw_fields (never ground_truth_label / scenario_label -
    normalize_network_row() already keeps the label out of raw_fields, and this
    function never touches ground_truth_label at all, by construction).
    """
    data_slice = [{"row_id": str(row.row_id), **row.raw_fields} for row in rows]

    parts = [
        f"Round: {round_no}",
        f"Your data slice ({len(data_slice)} rows):",
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
    """Returns (response, provider_name) - which provider actually served the call
    is audit-relevant (SKILL-agent-prompts.md Section 7), not just debug info.

    Caller's responsibility to keep len(rows) reasonable: confirmed live against
    Groq's free tier (2026-09-07) that ~15 rows x ~55 raw_fields each 413s as too
    large (6K TPM cap). The debate engine (Module 4) must batch/summarize per
    round rather than hand every row in an investigation to one call.
    """
    if not rows:
        raise ValueError("investigate() requires at least one row")

    user_prompt = build_user_prompt(rows, round_no, peripheral_digest, debate_context)
    raw_text, provider_used = call_with_fallback(GroqClient(), GeminiClient(), SYSTEM_PROMPT, user_prompt)

    valid_row_ids = {str(row.row_id) for row in rows}
    response = parse_and_validate(
        raw_text, expected_agent_id=AGENT_ID, expected_round=round_no, valid_row_ids=valid_row_ids
    )
    return response, provider_used
