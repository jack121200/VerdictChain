"""Shared investigator-agent output schema (SKILL-agent-prompts.md, top section).
Every investigator agent — network_traffic today, access_log/endpoint_behavior
once CERT data exists — returns exactly this shape.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

AgentId = Literal["network_traffic", "access_log", "endpoint_behavior"]


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

    @field_validator("cited_evidence")
    @classmethod
    def must_cite_something(cls, v: list[CitedEvidence]) -> list[CitedEvidence]:
        if not v:
            raise ValueError("cited_evidence must not be empty - an uncited claim is invalid")
        return v
