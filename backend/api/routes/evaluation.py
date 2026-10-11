"""Evaluation route (plan section 3.4): accuracy and per-class metrics over labelled investigations.

Only investigations with a scenario label that reached a verdict are scored. The label-to-class mapping
(backend/evaluation/ground_truth_map.py) comes from the CERT r4.2 answer files for the insider scenarios.
Ambiguous verdicts are abstentions and are never correct.
"""

from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select

from backend.api.auth import get_current_user
from backend.api.metrics import Metric, make_metric
from backend.api.provenance import data_source_by_investigation
from backend.api.rate_limit import read_limit
from backend.api.schemas.stats import (
    ClassScoresOut,
    ConfusionCellOut,
    ConfusionMatrixOut,
    EvaluationOut,
    MappingEntryOut,
    NoiseGroupOut,
    SourceScoreOut,
)
from backend.db.models import Investigation
from backend.db.session import SessionLocal
from backend.evaluation.ground_truth_map import SCENARIO_GROUND_TRUTH, VERDICT_CLASSES
from backend.evaluation.metrics import NOISE_LEVELS, UNCLASSIFIED, Evaluation, LabelledVerdict, Rate, evaluate

router = APIRouter(prefix="/evaluation", tags=["evaluation"])

SOURCE = "/evaluation"
VERDICT_STATUSES = frozenset({"verdict_reached", "contained", "ambiguous"})
SOURCE_MEANING = {
    "model": "the real model providers (or no offline-stub label recorded)",
    "stub": "the offline stub only (label stub-openai)",
    "mixed": "the offline stub and the real providers",
}
MAPPING_STATUS = (
    "insider scenarios 1 to 3 are mapped from the event types in the CERT r4.2 answer files; "
    "each also accepts the other insider class"
)
MAPPING_NOTE = (
    " Insider scenarios also accept the other insider class (CERT r4.2 answers, ground_truth_map.py)."
)


def _metric(rate: Rate, definition: str, empty_reason: str | None = None) -> Metric[float]:
    reason = rate.reason if rate.value is None and rate.reason is not None else None
    return make_metric(rate.value, rate.n, SOURCE, definition, reason=empty_reason or reason)


def _accuracy_metrics(rates: dict[str, Rate], empty_reason: str | None = None) -> dict[str, Metric[float]]:
    """The four headline rates. The accuracy definitions say that ambiguous counts as wrong. empty_reason
    replaces the reason of a null rate (used when other sources have scored runs that are not counted here).
    """
    return {
        "accuracy": _metric(
            rates["accuracy"],
            "exact verdict match / scored investigations; ambiguous counts as wrong" + MAPPING_NOTE,
            empty_reason,
        ),
        "acceptable_accuracy": _metric(
            rates["acceptable_accuracy"],
            "verdict is the mapped class or an accepted alternative / scored; ambiguous counts as wrong"
            + MAPPING_NOTE,
            empty_reason,
        ),
        "family_accuracy": _metric(
            rates["family_accuracy"],
            "verdict is in the same family (network, insider, benign) as the mapped class / scored"
            + MAPPING_NOTE,
            empty_reason,
        ),
        "abstain_rate": _metric(
            rates["abstain_rate"], "ambiguous verdicts / scored investigations", empty_reason
        ),
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


@router.get("", response_model=EvaluationOut, dependencies=[read_limit("evaluation", 60)])
def get_evaluation(
    source: Literal["model", "stub", "mixed", "all"] = Query("model"),
    username: str = Depends(get_current_user),
) -> EvaluationOut:
    """Headline numbers count `source` runs: model by default, so accuracy measured on the offline stub never
    reads as accuracy of the system. by_source always shows all three, each labelled."""
    session = SessionLocal()
    try:
        investigations = session.execute(
            select(
                Investigation.scenario_label,
                Investigation.verdict_class,
                Investigation.status,
                Investigation.noise_pct,
                Investigation.investigation_id,
            ).where(Investigation.scenario_label.is_not(None))
        ).all()
        sources = data_source_by_investigation(session, [row.investigation_id for row in investigations])
    finally:
        session.close()

    labelled = len(investigations)
    scored_rows = [
        (
            LabelledVerdict(scenario_label=label, verdict_class=verdict, status=status, noise_pct=noise),
            sources.get(iid, "model"),
        )
        for label, verdict, status, noise, iid in investigations
        if status in VERDICT_STATUSES and label in SCENARIO_GROUND_TRUTH
    ]
    verdicts = [verdict for verdict, origin in scored_rows if source in ("all", origin)]
    ev = evaluate(verdicts)
    by_source = {}
    for origin in ("model", "stub", "mixed"):
        part = evaluate([verdict for verdict, found in scored_rows if found == origin])
        by_source[origin] = SourceScoreOut(
            scored=make_metric(
                part.scored,
                part.scored,
                SOURCE,
                f"scored investigations whose answers all came from: {SOURCE_MEANING[origin]}",
            ),
            accuracy=_metric(
                part.accuracy, f"exact verdict match over {origin} runs only; {SOURCE_MEANING[origin]}"
            ),
        )
    elsewhere = sum(1 for _, origin in scored_rows if source != "all" and origin != source)
    empty_reason = (
        f"no {source} runs scored yet; {elsewhere} scored run(s) from other sources are not counted here"
        if ev.scored == 0 and elsewhere
        else None
    )
    headline = _accuracy_metrics(
        {
            "accuracy": ev.accuracy,
            "acceptable_accuracy": ev.acceptable_accuracy,
            "family_accuracy": ev.family_accuracy,
            "abstain_rate": ev.abstain_rate,
        },
        empty_reason,
    )

    return EvaluationOut(
        source=source,
        by_source=by_source,
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
            NoiseGroupOut(noise_pct=noise, **_accuracy_metrics(ev.by_noise[noise], empty_reason))
            for noise in NOISE_LEVELS
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
