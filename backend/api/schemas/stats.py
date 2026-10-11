"""Response models for /stats, /evaluation and /scenarios. Every number is a Metric envelope (plan R2)."""

from datetime import datetime

from pydantic import BaseModel

from backend.api.metrics import Metric


class CitationStatsOut(BaseModel):
    verified_rate: Metric[float]
    invalid_rate: Metric[float]
    total: Metric[int]
    verified: Metric[int]
    discrepancy: Metric[int]
    invalid_row: Metric[int]


class ChainStatsOut(BaseModel):
    valid: bool
    entries: Metric[int]
    head_seq: Metric[int]


class WatchdogStatsOut(BaseModel):
    checks_total: Metric[int]
    citations_checked: Metric[int]
    discrepancies: Metric[int]
    isolations: Metric[int]


class SelfHealingStatsOut(BaseModel):
    actions_total: Metric[int]
    simulated_share: Metric[float]
    non_simulated: Metric[int]


class FeedbackStatsOut(BaseModel):
    total: Metric[int]
    confirmed: Metric[int]
    false_positive: Metric[int]
    agreement_rate: Metric[float]


class LatencyStatsOut(BaseModel):
    definition: str
    mean_seconds: Metric[float]


class AutomationStatsOut(BaseModel):
    """What ran without a click in the last 24 hours and how fast detection moved to containment."""

    cases: Metric[int]  # investigations accepted in the window, whoever started them
    auto_started: Metric[int]  # of those, started by the live monitor (trigger_type continuous)
    auto_share: Metric[float]
    # started by the monitor, ended contained, and no analyst emergency containment or release on them
    hands_free_contained: Metric[int]
    median_seconds_to_verdict: Metric[float]  # investigation_started to verdict_reached
    median_seconds_verdict_to_action: Metric[float]  # verdict_reached to the first sandbox action


class StatsOut(BaseModel):
    active: Metric[int]
    stale: Metric[int]
    threats_24h: Metric[int]
    insider_count: Metric[int]
    contained: Metric[int]
    by_status: dict[str, Metric[int]]
    by_verdict_class: dict[str, Metric[int]]
    mean_agent_confidence: Metric[float]
    mean_crs: Metric[float]
    citations: CitationStatsOut
    chain: ChainStatsOut
    watchdog: WatchdogStatsOut
    self_healing: SelfHealingStatsOut
    feedback: FeedbackStatsOut
    brier: Metric[float]
    latency: LatencyStatsOut
    automation: AutomationStatsOut
    generated_at: datetime


class ClassScoresOut(BaseModel):
    verdict_class: str
    precision: Metric[float]
    recall: Metric[float]
    f1: Metric[float]


class ConfusionCellOut(BaseModel):
    actual: str
    predicted: str
    count: Metric[int]


class ConfusionMatrixOut(BaseModel):
    rows: list[str]
    cols: list[str]
    cells: list[ConfusionCellOut]


class NoiseGroupOut(BaseModel):
    # noise_pct is a grouping key (0, 15 or 30), not a measurement, so it is not a Metric.
    noise_pct: int
    accuracy: Metric[float]
    acceptable_accuracy: Metric[float]
    family_accuracy: Metric[float]
    abstain_rate: Metric[float]


class MappingEntryOut(BaseModel):
    scenario_label: str
    expected_class: str
    accepted_classes: list[str]


class SourceScoreOut(BaseModel):
    """Scored investigations and exact accuracy for one data source (model, stub or mixed)."""

    scored: Metric[int]
    accuracy: Metric[float]


class EvaluationOut(BaseModel):
    source: str  # which runs the headline numbers count: model (default), stub, mixed or all
    by_source: dict[str, SourceScoreOut]  # always all three, so stub accuracy is visible and labelled
    labelled: Metric[int]
    scored: Metric[int]
    accuracy: Metric[float]
    acceptable_accuracy: Metric[float]
    family_accuracy: Metric[float]
    abstain_rate: Metric[float]
    per_class: list[ClassScoresOut]
    confusion_matrix: ConfusionMatrixOut
    by_noise: list[NoiseGroupOut]
    mapping: list[MappingEntryOut]
    mapping_status: str
    generated_at: datetime


class ScenarioOut(BaseModel):
    label: str
    dataset: str
    primary_agent: str | None
    row_count: Metric[int]
    description: str
