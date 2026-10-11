"""Access-Log Investigator Agent (SKILL-agent-prompts.md Section 2).
Asks OpenAI, the project's only provider (SKILL-agent-prompts.md Section 7). Works on raw_logs rows with
event_type == "file_access" (backend.pipeline.normalization.normalize_cert_file_row).
"""

import json

from backend.agents.base_agent import ask
from backend.agents.llm_clients import OpenAIClient
from backend.agents.rows import AgentRow
from backend.agents.schemas import AgentResponse, response_rules

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
- One citation names ONE field of ONE row: "field" is the exact key as it appears in that
  row and "value" is exactly what the row shows for it (true/false, numbers and text
  unchanged). To cite several fields, write several citations; never join fields into one
  citation and never reword a value. Cite the evidence that carries your theory (3 to 6
  citations are enough), not every row.
- Set "round" to the round number given in the user message.
- Distinguishing signals: unusually large or unusually frequent file access in a
  short window (file_access_count, distinct_filenames); the accessing user's own
  department (user_department) as context. Note: a resource-owner department to
  compare against is not always present in this data - do not assume a mismatch
  signal exists if user_department is the only department field given.
""" + response_rules(
    AGENT_ID
)

_ROUND_2_3_INSTRUCTIONS = """
You have seen the other investigator agents' theories and evidence. You must do
ONE of the following, explicitly stated at the start of your response:
- CHALLENGE: state exactly which other agent's theory you disagree with and why,
  citing evidence.
- SUPPORT: state which other agent's theory you agree with and why.
- REVISE: update your own theory in light of what you've seen, explaining the change.
Set "stance" to the word you chose, and "vote_class" to the class your evidence supports now.
Cite only row_ids from YOUR OWN data slice above, copied exactly. A theory of another
agent may mention rows you were never given: answer its claims in words and never cite
its rows - a citation from outside your own slice makes your whole answer invalid.
Do not simply restate your previous round's message. A response that is
substantially identical to your prior round will be rejected.
"""


def build_user_prompt(
    rows: list[AgentRow],
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
        f'Put "round": {round_no} in your JSON answer.',
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
    rows: list[AgentRow],
    round_no: int = 1,
    peripheral_digest: dict | None = None,
    debate_context: str | None = None,
) -> tuple[AgentResponse, str]:
    """Returns (response, provider_name)."""
    if not rows:
        raise ValueError("investigate() requires at least one row")

    user_prompt = build_user_prompt(rows, round_no, peripheral_digest, debate_context)
    return ask(
        OpenAIClient(),
        SYSTEM_PROMPT,
        user_prompt,
        agent_id=AGENT_ID,
        round_no=round_no,
        valid_row_ids={str(row.row_id) for row in rows},
    )
