"""Test helper for the debate queue: wait until the worker has nothing left to do."""

import time

from sqlalchemy import func, select

from backend.api.rate_limit import slot_holder
from backend.db.models import Investigation
from backend.db.session import SessionLocal


def _queued() -> int:
    with SessionLocal() as session:
        return session.execute(
            select(func.count()).select_from(Investigation).where(Investigation.status == "queued")
        ).scalar_one()


def wait_until_idle(timeout: float = 10.0) -> None:
    """Returns when no investigation is queued and the debate slot is free, seen on two reads in a row.

    A queued investigation is not running yet, so the slot alone says nothing: the worker takes the slot a
    moment after the request returned. Once it has claimed the job the slot stays held until the job ends,
    so 'nothing queued and the slot free' cannot be true while a debate is about to start or still runs."""
    deadline = time.monotonic() + timeout
    steady = 0
    while time.monotonic() < deadline:
        steady = steady + 1 if _queued() == 0 and slot_holder() is None else 0
        if steady >= 2:
            return
        time.sleep(0.02)
    raise AssertionError(f"the debate queue did not drain: queued={_queued()} slot={slot_holder()}")
