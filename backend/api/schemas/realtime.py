"""Request and response models for starting a scenario run, the WebSocket ticket and the live channel."""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ScenarioLabel = Literal[
    "DDoS",
    "Portscan",
    "FTP-Patator",
    "SSH-Patator",
    "Botnet",
    "insider_scenario_1",
    "insider_scenario_2",
    "insider_scenario_3",
]

NoisePct = Literal[0, 15, 30]


class SimulateScenarioRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scenario_label: ScenarioLabel
    max_rows_per_agent: int = Field(default=5, ge=1, le=15)
    noise_pct: NoisePct = 0
    # wait=true runs the debate inline and returns the verdict (201). wait=false returns 202 at once.
    wait: bool = True


class SimulateAcceptedOut(BaseModel):
    investigation_id: str
    status: str
    ws_path: str
    noise_pct: int
    effective_noise_pct: float
    primary_agent: str


class InvestigationProgressOut(BaseModel):
    """Where a debate is. phase: running (it holds the debate slot), finished, error, or unknown (the
    investigation is still 'investigating' but no debate holds the slot: it was cut off, for example by an API
    restart, and the next start marks it error)."""

    investigation_id: str
    phase: str
    status: str
    rounds_total: int
    rounds_complete: int
    round: int | None
    elapsed_seconds: float


class WsTicketOut(BaseModel):
    ticket: str
    expires_in: int


class SnapshotAgentOut(BaseModel):
    agent_id: str
    theory: str
    confidence: float
    provider: str | None
    cited_evidence: list[dict[str, Any]]


class SnapshotRoundOut(BaseModel):
    round: int
    agents: list[SnapshotAgentOut]


class SnapshotCredibilityOut(BaseModel):
    agent_id: str
    round: int
    crs_before: float
    crs_after: float
    verification_match_rate: float
    isolated: bool


class SnapshotActionOut(BaseModel):
    action_type: str
    target: str
    reason: str | None
    is_simulated: bool


class SnapshotVerdictOut(BaseModel):
    verdict_class: str | None
    verdict_confidence: float | None
    status: str


class SnapshotFrame(BaseModel):
    """The first frame on every investigation channel: the state so far, read from the database.
    Live frames that follow may repeat items, so clients dedupe on type + round + agent_id.
    """

    type: Literal["snapshot"] = "snapshot"
    investigation_id: str
    status: str
    rounds: list[SnapshotRoundOut]
    credibility: list[SnapshotCredibilityOut]
    actions: list[SnapshotActionOut]
    verdict: SnapshotVerdictOut | None
