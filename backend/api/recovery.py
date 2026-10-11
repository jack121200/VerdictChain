"""Clean-up when the API process starts.

The console runs as ONE API process (the WebSocket manager is in-process too). When it starts, none of its
own debates is running, so an investigation still 'investigating' was cut off by a restart or a crash, and a
debate slot that is still held belongs to that dead debate. Without this, the console shows "debate engine
active" and refuses new injections with 409 for the 30 minutes the slots would otherwise live.
"""

import logging

from sqlalchemy import select

from backend.api.rate_limit import DEBATE_SLOT_KEY, LEGACY_SLOT_KEY, get_redis, slot_holders
from backend.db.models import Investigation
from backend.db.session import SessionLocal
from backend.debate.engine import fail_investigation

logger = logging.getLogger(__name__)

CUT_OFF_REASON = (
    "The API restarted while this debate was running, so it was cut off before it reached a verdict."
)


def recover_after_restart() -> tuple[int, str | None]:
    """Marks every 'investigating' investigation as error (with the reason, and an investigation_failed
    audit entry) and frees every debate slot. Returns (investigations marked, the longest-held slot holder
    that was freed). Never raises: a failure is logged."""
    try:
        holders = slot_holders()
        holder = holders[0] if holders else None
        with SessionLocal() as session:
            cut_off = (
                session.execute(
                    select(Investigation.investigation_id).where(Investigation.status == "investigating")
                )
                .scalars()
                .all()
            )
        marked = sum(fail_investigation(investigation_id, CUT_OFF_REASON) for investigation_id in cut_off)
        # The single-slot key of earlier versions goes too, so an old process' hold cannot outlive an upgrade.
        get_redis().delete(DEBATE_SLOT_KEY, LEGACY_SLOT_KEY)
    except Exception:  # noqa: BLE001 - start-up must not fail because the clean-up could not run
        logger.exception("start-up recovery of cut-off debates failed")
        return 0, None
    if marked or holder:
        logger.warning(
            "start-up recovery: %d cut-off investigation(s) marked error, debate slot %s freed",
            marked,
            holder or "was already free",
        )
    return marked, holder
