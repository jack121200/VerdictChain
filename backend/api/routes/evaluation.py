"""Evaluation route (plan section 3.4): accuracy and per-class metrics over labelled investigations.

Only investigations with a scenario label that reached a verdict are scored. The label-to-class mapping
(backend/evaluation/ground_truth_map.py) comes from the CERT r4.2 answer files for the insider scenarios.
Ambiguous verdicts are abstentions and are never correct.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select

from backend.api.auth import get_current_user
from backend.api.metrics import Metric, make_metric
from backend.api.schemas.stats import (
    ClassScoresOut,
    ConfusionCellOut,
    ConfusionMatrixOut,
    EvaluationOut,
    MappingEntryOut,
    NoiseGroupOut,
)
from backend.db.models import Investigation
from backend.db.session import SessionLocal
from backend.evaluation.ground_truth_map import SCENARIO_GROUND_TRUTH, VERDICT_CLASSES
from backend.evaluation.metrics import NOISE_LEVELS, UNCLASSIFIED, Evaluation, LabelledVerdict, Rate, evaluate

router = APIRouter(prefix="/evaluation", tags=["evaluation"])

SOURCE = "/evaluation"
VERDICT_STATUSES = frozenset({"verdict_reached", "contained", "ambiguous"})
MAPPING_STATUS = (
    "insider scenarios 1 to 3 are mapped from the event types in the CERT r4.2 answer files; "
    "each also accepts the other insider class"
)
MAPPING_NOTE = (
    " Insider scenarios also accept the other insider class (CERT r4.2 answers, ground_truth_map.py)."
)


def _metric(rate: Rate, definition: str) -> Metric[float]:
    return make_metric(rate.value, rate.n, SOURCE, definition, reason=rate.reason)


def _accuracy_metrics(rates: dict[str, Rate]) -> dict[str, Metric[float]]:
    """The four headline rates. The accuracy definitions say that ambiguous counts as wrong."""
    return {
        "accuracy": _metric(
            rates["accuracy"],
            "exact verdict match / scored investigations; ambiguous counts as wrong" + MAPPING_NOTE,
        ),
        "acceptable_accuracy": _metric(
            rates["acceptable_accuracy"],
            "verdict is the mapped class or an accepted alternative / scored; ambiguous counts as wrong"
            + MAPPING_NOTE,
        ),
        "family_accuracy": _metric(
            rates["family_accuracy"],
            "verdict is in the same family (network, insider, benign) as the mapped class / scored"
            + MAPPING_NOTE,
        ),
        "abstain_rate": _metric(rates["abstain_rate"], "ambiguous verdicts / scored investigations"),
    }


def _confusion(ev: Evaluation) -> ConfusionMatrixOut:
    rows = [c for c in VERDICT_CLASSES if c != "ambiguous"]
    cols = [*VERDICT_CLASSES, UNCLASSIFIED]
    cells = [
        ConfusionCellOut(
            actual=actual,
            predicted=predicted,
            count=make_metric(
                ev.confusion.get((actual, predicted), 0),
                ev.scored,
                SOURCE,
                f"scored investigations with mapped class {actual} and verdict {predicted}; n = scored",
            ),
        )
        for actual in rows
        for predicted in cols
    ]
    return ConfusionMatrixOut(rows=rows, cols=cols, cells=cells)


@router.get("", response_model=EvaluationOut)
def get_evaluation(username: str = Depends(get_current_user)) -> EvaluationOut:
    session = SessionLocal()
    try:
        investigations = session.execute(
            select(
                Investigation.scenario_label,
                Investigation.verdict_class,
                Investigation.status,
                Investigation.noise_pct,
            ).where(Investigation.scenario_label.is_not(None))
        ).all()
    finally:
        session.close()

    labelled = len(investigations)
    verdicts = [
        LabelledVerdict(scenario_label=label, verdict_class=verdict, status=status, noise_pct=noise)
        for label, verdict, status, noise in investigations
        if status in VERDICT_STATUSES and label in SCENARIO_GROUND_TRUTH
    ]
    ev = evaluate(verdicts)
    headline = _accuracy_metrics(
        {
            "accuracy": ev.accuracy,
            "acceptable_accuracy": ev.acceptable_accuracy,
            "family_accuracy": ev.family_accuracy,
            "abstain_rate": ev.abstain_rate,
        }
    )

    return EvaluationOut(
        labelled=make_metric(
            labelled,
            labelled,
            SOURCE,
            "investigations with a scenario label (includes any that did not reach a verdict)",
        ),
        scored=make_metric(
            ev.scored,
            ev.scored,
            SOURCE,
            "labelled investigations that reached a verdict (verdict_reached, contained or ambiguous)",
        ),
        accuracy=headline["accuracy"],
        acceptable_accuracy=headline["acceptable_accuracy"],
        family_accuracy=headline["family_accuracy"],
        abstain_rate=headline["abstain_rate"],
        per_class=[
            ClassScoresOut(
                verdict_class=scores.verdict_class,
                precision=_metric(
                    scores.precision,
                    "true positives / investigations given this verdict (primary mapping only)"
                    + MAPPING_NOTE,
                ),
                recall=_metric(
                    scores.recall,
                    "true positives / investigations whose mapped class is this (primary mapping only)"
                    + MAPPING_NOTE,
                ),
                f1=_metric(
                    scores.f1,
                    "2 x TP / (predicted + expected), n = predicted + expected (primary mapping only)"
                    + MAPPING_NOTE,
                ),
            )
            for scores in ev.per_class
        ],
        confusion_matrix=_confusion(ev),
        by_noise=[
            NoiseGroupOut(noise_pct=noise, **_accuracy_metrics(ev.by_noise[noise])) for noise in NOISE_LEVELS
        ],
        mapping=[
            MappingEntryOut(
                scenario_label=label, expected_class=truth.expected, accepted_classes=list(truth.accepted)
            )
            for label, truth in SCENARIO_GROUND_TRUTH.items()
        ],
        mapping_status=MAPPING_STATUS,
        generated_at=datetime.now(timezone.utc),
    )
