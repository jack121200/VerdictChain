"""Network-Traffic Investigator Agent (SKILL-agent-prompts.md Section 1).
Asks OpenAI, the project's only provider (SKILL-agent-prompts.md Section 7).
"""

import json

from backend.agents.base_agent import ask
from backend.agents.llm_clients import OpenAIClient
from backend.agents.rows import AgentRow
from backend.agents.schemas import AgentResponse, response_rules

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
- One citation names ONE field of ONE row: "field" is the exact key as it appears in that
  row and "value" is exactly what the row shows for it (true/false, numbers and text
  unchanged). To cite several fields, write several citations; never join fields into one
  citation and never reword a value. Cite the evidence that carries your theory (3 to 6
  citations are enough), not every row.
- Set "round" to the round number given in the user message.
- Distinguishing signals to consider: Flow Bytes/s and Flow Packets/s for volume
  spikes (DDoS); SYN/RST/ACK flag ratios for scans; Flow IAT patterns for
  brute-force rhythm; Active/Idle mean-std-max-min for C2 beaconing behavior.
""" + response_rules(
    AGENT_ID
)

# A flow row has 67 fields and every one is paid for in tokens, on every call of every round. The agent reads
# the ones its system prompt names (volume, flags, inter-arrival times, active/idle) plus who talked to which
# port. The whole row stays in raw_logs, so a citation of any field is still checked against it. As a side
# effect this is an allow-list: a key that should never be there (a label) cannot reach the model.
_PROMPT_FIELDS = (
    "Source IP",
    "Destination Port",
    "Flow Duration",
    "Total Fwd Packets",
    "Total Backward Packets",
    "Total Length of Fwd Packets",
    "Total Length of Bwd Packets",
    "Flow Bytes/s",
    "Flow Packets/s",
    "Fwd Packets/s",
    "Bwd Packets/s",
    "SYN Flag Count",
    "ACK Flag Count",
    "RST Flag Count",
    "FIN Flag Count",
    "PSH Flag Count",
    "URG Flag Count",
    "Flow IAT Mean",
    "Flow IAT Std",
    "Flow IAT Max",
    "Flow IAT Min",
    "Active Mean",
    "Active Std",
    "Active Max",
    "Active Min",
    "Idle Mean",
    "Idle Std",
    "Idle Max",
    "Idle Min",
)


def _prompt_fields(row: AgentRow) -> dict:
    """The fields of one row the agent is shown (all of them when the row has none of the named ones)."""
    named = {name: row.raw_fields[name] for name in _PROMPT_FIELDS if name in row.raw_fields}
    return named or dict(row.raw_fields)


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
    """rows must carry only raw_fields (never ground_truth_label / scenario_label -
    normalize_network_row() already keeps the label out of raw_fields, and this
    function never touches ground_truth_label at all, by construction).
    """
    data_slice = [{"row_id": str(row.row_id), **_prompt_fields(row)} for row in rows]

    parts = [
        f"Round: {round_no}",
        f'Put "round": {round_no} in your JSON answer.',
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
    rows: list[AgentRow],
    round_no: int = 1,
    peripheral_digest: dict | None = None,
    debate_context: str | None = None,
) -> tuple[AgentResponse, str]:
    """Returns (response, provider_name) - which provider actually served the call
    is audit-relevant (SKILL-agent-prompts.md Section 7), not just debug info.

    Caller's responsibility to keep len(rows) reasonable: ~15 rows x ~55 raw_fields
    each is a prompt of thousands of tokens, and every token counts against the
    OPENAI_DAILY_TOKEN_LIMIT budget. The debate engine (Module 4) must batch/summarize
    per round rather than hand every row in an investigation to one call.
    """
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
