"""Clean-up when the API process starts.

The console runs as ONE API process (the WebSocket manager is in-process too). When it starts, none of its
own debates is running, so an investigation still 'investigating' was cut off by a restart or a crash, and a
debate slot that is still held belongs to that dead debate. Without this, the console shows "debate engine
active" and refuses new injections with 409 for the 30 minutes the slot would otherwise live.
"""

import logging

from sqlalchemy import func, update

from backend.api.rate_limit import DEBATE_SLOT_KEY, get_redis, slot_holder
from backend.db.models import Investigation
from backend.db.session import SessionLocal

logger = logging.getLogger(__name__)


def recover_after_restart() -> tuple[int, str | None]:
    """Marks every 'investigating' investigation as error and frees the debate slot.
    Returns (investigations marked, the slot holder that was freed). Never raises: a failure is logged."""
    try:
        holder = slot_holder()
        with SessionLocal() as session:
            result = session.execute(
                update(Investigation)
                .where(Investigation.status == "investigating")
                .values(status="error", updated_at=func.now())
            )
            session.commit()
            marked = result.rowcount or 0
        if holder:
            get_redis().delete(DEBATE_SLOT_KEY)
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
