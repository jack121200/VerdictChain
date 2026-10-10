"""Runtime settings (plan section 3.5). GET is open to any authenticated analyst. PUT is a full replace,
needs edit_settings, and writes a settings_changed audit entry (before and after) in the same transaction.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from backend.api.auth import CurrentAnalyst, get_current_analyst, require_capability
from backend.api.metrics import make_metric
from backend.api.schemas.admin import (
    AdaptiveChangeOut,
    AdaptiveRuleOut,
    AdaptiveThresholdOut,
    SettingsOut,
    SettingsUpdateRequest,
)
from backend.db.audit import append_entry
from backend.db.runtime_settings import RuntimeSettings, load, load_for_update, save
from backend.db.session import SessionLocal
from backend.evaluation import adaptive_threshold as adaptive

router = APIRouter(prefix="/settings", tags=["settings"])

# Read-only constants shown next to the editable settings. The debate engine owns DEBATE_ROUNDS
# (plan section 3.3). Until it exports one, the value lives here. STARTING_CRS mirrors
# backend/watchdog/credibility.py, and a test checks that they agree.
DEBATE_ROUNDS = 3
STARTING_CRS = 0.5


def _out(settings: RuntimeSettings) -> SettingsOut:
    return SettingsOut(
        eta=settings.eta,
        isolation_threshold=settings.isolation_threshold,
        verdict_confidence_threshold=settings.verdict_confidence_threshold,
        intake_paused=settings.intake_paused,
        updated_at=settings.updated_at,
        updated_by=settings.updated_by,
        debate_rounds=DEBATE_ROUNDS,
        starting_crs=STARTING_CRS,
    )


@router.get("", response_model=SettingsOut)
def get_settings(_: CurrentAnalyst = Depends(get_current_analyst)) -> SettingsOut:
    return _out(load())


@router.get("/adaptive", response_model=AdaptiveThresholdOut)
def get_adaptive_threshold(_: CurrentAnalyst = Depends(get_current_analyst)) -> AdaptiveThresholdOut:
    """What analyst feedback says about the verdict threshold right now, and the last move it made."""
    source = "/settings/adaptive"
    with SessionLocal() as session:
        assessment, threshold = adaptive.current_assessment(session)
        previous = adaptive.last_change(session)
        change = None
        if previous is not None:
            detail = previous.detail or {}
            change = AdaptiveChangeOut(
                at=previous.created_at,
                before=detail["before"]["verdict_confidence_threshold"],
                after=detail["after"]["verdict_confidence_threshold"],
                reason=detail.get("reason", ""),
                feedback_count=int(detail.get("feedback_count", 0)),
            )
    return AdaptiveThresholdOut(
        threshold=make_metric(
            threshold,
            1,
            source,
            "runtime_settings.verdict_confidence_threshold, the value the debate uses now",
        ),
        window=make_metric(
            assessment.window,
            assessment.window,
            source,
            f"the newest analyst feedback rows the rule looks at (at most {adaptive.WINDOW})",
        ),
        false_positive_share=make_metric(
            assessment.share,
            assessment.window,
            source,
            "feedback rows marked false positive / feedback rows in the window",
            reason=None if assessment.share is not None else "no analyst feedback yet",
        ),
        next_step=assessment.action,
        reason=assessment.reason,
        new_threshold=assessment.new_threshold,
        rule=AdaptiveRuleOut(
            window_size=adaptive.WINDOW,
            min_feedback=adaptive.MIN_FEEDBACK,
            adapt_every=adaptive.ADAPT_EVERY,
            tighten_at=adaptive.TIGHTEN_AT,
            relax_at=adaptive.RELAX_AT,
            step_up=adaptive.STEP_UP,
            step_down=adaptive.STEP_DOWN,
            floor=adaptive.FLOOR,
            ceiling=adaptive.CEILING,
        ),
        last_change=change,
    )


@router.put("", response_model=SettingsOut)
def replace_settings(
    payload: SettingsUpdateRequest,
    actor: CurrentAnalyst = Depends(require_capability("edit_settings")),
) -> SettingsOut:
    session = SessionLocal()
    try:
        before = load_for_update(session)
        try:
            after = save(session, payload.model_dump(), updated_by=actor.username)
        except ValueError as exc:  # the model already checks ranges; this is the second line of defence
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)) from exc
        append_entry(
            session,
            actor=actor.username,
            action="settings_changed",
            detail={"before": before.values(), "after": after.values()},
        )
        session.commit()
        return _out(after)
    finally:
        session.close()
