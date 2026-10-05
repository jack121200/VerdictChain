"""Request models for starting a scenario run and for the live (WebSocket) channel."""

from typing import Literal

from pydantic import BaseModel, Field

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


class SimulateScenarioRequest(BaseModel):
    scenario_label: ScenarioLabel
    max_rows_per_agent: int = Field(default=5, ge=1, le=15)
