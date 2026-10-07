"""Accuracy, per-class precision/recall/F1 and the confusion matrix over labelled investigations.

Pure functions, no DB and no FastAPI. The route turns each Rate into a Metric envelope with its n.
Ambiguous verdicts (and status `ambiguous`) are abstentions: they count against accuracy, never as
correct. Denominators are shown: a Rate with no denominator has value None and a reason.
"""

from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass

from backend.evaluation.ground_truth_map import (
    CLASS_FAMILY,
    SCENARIO_GROUND_TRUTH,
    VERDICT_CLASSES,
)

UNCLASSIFIED = "unclassified"
NOISE_LEVELS: tuple[int, ...] = (0, 15, 30)


@dataclass(frozen=True)
class LabelledVerdict:
    scenario_label: str
    verdict_class: str | None
    status: str
    noise_pct: int


@dataclass(frozen=True)
class Rate:
    value: float | None
    n: int
    reason: str | None


@dataclass(frozen=True)
class ClassScores:
    verdict_class: str
    precision: Rate
    recall: Rate
    f1: Rate


@dataclass(frozen=True)
class Evaluation:
    scored: int
    accuracy: Rate
    acceptable_accuracy: Rate
    family_accuracy: Rate
    abstain_rate: Rate
    per_class: tuple[ClassScores, ...]
    confusion: dict[tuple[str, str], int]
    by_noise: dict[int, dict[str, Rate]]


def _rate(numerator: int, denominator: int, empty_reason: str) -> Rate:
    if denominator == 0:
        return Rate(value=None, n=0, reason=empty_reason)
    return Rate(value=numerator / denominator, n=denominator, reason=None)


def _predicted(verdict: LabelledVerdict) -> str:
    if verdict.verdict_class is None:
        return UNCLASSIFIED
    return verdict.verdict_class


@dataclass(frozen=True)
class _Judged:
    expected: str
    predicted: str
    abstained: bool
    exact: bool
    acceptable: bool
    family_match: bool


def _judge(verdict: LabelledVerdict) -> _Judged:
    truth = SCENARIO_GROUND_TRUTH[verdict.scenario_label]
    predicted = _predicted(verdict)
    abstained = predicted == "ambiguous" or verdict.status == "ambiguous"
    if abstained:
        return _Judged(truth.expected, "ambiguous", True, False, False, False)
    return _Judged(
        expected=truth.expected,
        predicted=predicted,
        abstained=False,
        exact=predicted == truth.expected,
        acceptable=predicted == truth.expected or predicted in truth.accepted,
        family_match=CLASS_FAMILY.get(predicted) == CLASS_FAMILY[truth.expected],
    )


def _summarise(judged: list[_Judged]) -> dict[str, Rate]:
    n = len(judged)
    empty = "no labelled verdicts yet"
    return {
        "accuracy": _rate(sum(j.exact for j in judged), n, empty),
        "acceptable_accuracy": _rate(sum(j.acceptable for j in judged), n, empty),
        "family_accuracy": _rate(sum(j.family_match for j in judged), n, empty),
        "abstain_rate": _rate(sum(j.abstained for j in judged), n, empty),
    }


def _class_scores(verdict_class: str, judged: list[_Judged]) -> ClassScores:
    predicted_count = sum(1 for j in judged if j.predicted == verdict_class)
    actual_count = sum(1 for j in judged if j.expected == verdict_class)
    true_positive = sum(1 for j in judged if j.predicted == verdict_class and j.expected == verdict_class)
    return ClassScores(
        verdict_class=verdict_class,
        precision=_rate(
            true_positive, predicted_count, f"no investigation was given the verdict {verdict_class}"
        ),
        recall=_rate(true_positive, actual_count, f"no labelled investigation expects {verdict_class}"),
        f1=_rate(
            2 * true_positive,
            predicted_count + actual_count,
            f"no investigation predicted or expected as {verdict_class}",
        ),
    )


def evaluate(verdicts: Iterable[LabelledVerdict]) -> Evaluation:
    """verdicts must already be limited to labelled investigations that reached a verdict."""
    records = list(verdicts)
    judged = [_judge(v) for v in records]

    confusion: Counter[tuple[str, str]] = Counter((j.expected, j.predicted) for j in judged)
    by_noise: dict[int, dict[str, Rate]] = {}
    for noise in NOISE_LEVELS:
        group = [_judge(v) for v in records if v.noise_pct == noise]
        by_noise[noise] = _summarise(group)

    summary = _summarise(judged)
    return Evaluation(
        scored=len(judged),
        accuracy=summary["accuracy"],
        acceptable_accuracy=summary["acceptable_accuracy"],
        family_accuracy=summary["family_accuracy"],
        abstain_rate=summary["abstain_rate"],
        per_class=tuple(_class_scores(c, judged) for c in VERDICT_CLASSES),
        confusion=dict(confusion),
        by_noise=by_noise,
    )
