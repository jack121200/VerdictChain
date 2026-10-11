"""Shared investigator-agent output schema (SKILL-agent-prompts.md, top section).
Every investigator agent — network_traffic today, access_log/endpoint_behavior
once CERT data exists — returns exactly this shape.

Amendment 2026-10-11: two optional fields, `stance` and `vote_class`. The agent states its stance and the
class it votes for itself, instead of the server reading them out of the theory text (a keyword reading took
"no clear network attack, weakly like a botnet beacon" for a botnet vote). Both are lenient: a value that is
not on the list becomes None and the server falls back to reading the text, so a model's slip here never
costs a debate.
"""

from typing import Literal, get_args

from pydantic import BaseModel, Field, field_validator

AgentId = Literal["network_traffic", "access_log", "endpoint_behavior"]

VoteClass = Literal[
    "ddos",
    "port_scan",
    "brute_force",
    "botnet_c2",
    "insider_file_exfiltration",
    "insider_logon_anomaly",
    "benign",
    "ambiguous",
]
Stance = Literal["CHALLENGE", "SUPPORT", "REVISE"]
VOTE_CLASSES: tuple[str, ...] = get_args(VoteClass)
STANCES: tuple[str, ...] = get_args(Stance)

# In every investigator's system prompt, so the three agents ask for the two fields in the same words.
VOTE_FIELDS_RULES = """- "vote_class" is the one class your evidence supports most, written exactly as one of:
  ddos, port_scan, brute_force, botnet_c2, insider_file_exfiltration, insider_logon_anomaly,
  benign (the rows show ordinary activity) or ambiguous (the rows do not decide between classes).
  If your theory says there is no clear attack or anomaly, your vote_class is benign or ambiguous,
  never an attack class.
- "stance" is null in round 1. In rounds 2 and 3 it is CHALLENGE, SUPPORT or REVISE, the same word
  your theory starts with.
"""


def response_rules(agent_id: str) -> str:
    """The end of every investigator's system prompt: the rules for the two stated fields, then the JSON
    shape to answer with. The example's vote_class is a placeholder, not a class, so a model that copies it
    literally has it dropped (see AgentResponse), never obeyed."""
    return (
        VOTE_FIELDS_RULES
        + "\nRespond with a single JSON object matching exactly:\n"
        + f'{{"agent_id": "{agent_id}", "theory": "...", "confidence": 0.0, "stance": null,\n'
        + ' "vote_class": "<one class from the list>",\n'
        + ' "cited_evidence": [{"row_id": "...", "field": "...", "value": "..."}], "round": 1}\n'
    )


class CitedEvidence(BaseModel):
    row_id: str
    field: str
    value: str


class AgentResponse(BaseModel):
    agent_id: AgentId
    theory: str
    confidence: float = Field(ge=0.0, le=1.0)
    cited_evidence: list[CitedEvidence]
    round: int = Field(ge=1)
    stance: Stance | None = None
    vote_class: VoteClass | None = None

    @field_validator("cited_evidence")
    @classmethod
    def must_cite_something(cls, v: list[CitedEvidence]) -> list[CitedEvidence]:
        if not v:
            raise ValueError("cited_evidence must not be empty - an uncited claim is invalid")
        return v

    @field_validator("stance", mode="before")
    @classmethod
    def read_stance(cls, v: object) -> str | None:
        word = v.strip().upper() if isinstance(v, str) else None
        return word if word in STANCES else None

    @field_validator("vote_class", mode="before")
    @classmethod
    def read_vote_class(cls, v: object) -> str | None:
        word = v.strip().lower().replace("-", "_").replace(" ", "_") if isinstance(v, str) else None
        return word if word in VOTE_CLASSES else None
