"""Runtime settings (plan section 3.5). GET is open to any authenticated analyst. PUT is a full replace,
needs edit_settings, and writes a settings_changed audit entry (before and after) in the same transaction.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from backend.api.auth import CurrentAnalyst, get_current_analyst, require_capability
from backend.api.schemas.admin import SettingsOut, SettingsUpdateRequest
from backend.db.audit import append_entry
from backend.db.runtime_settings import RuntimeSettings, load, load_for_update, save
from backend.db.session import SessionLocal

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
