"""Benign-row dilution for simulated runs (plan sections 2.11 and 3.5).

A noise level replaces some of the scenario rows the primary agent will see with benign rows from the
same source. Values are never changed: a replacement is a real benign row, as it is stored.

The dilution applies to the window the agent reads (the first max_rows rows), so the noise is visible
in the agent's input. Agents get no hint: the noise is stored only on the investigation row.
"""

import random
import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db.models import RawLog
from backend.db.session import SessionLocal

NOISE_LEVELS: tuple[int, ...] = (0, 15, 30)


def _pick_benign(session: Session, source: str, exclude: list[uuid.UUID]) -> RawLog | None:
    query = select(RawLog).where(RawLog.source == source, func.lower(RawLog.ground_truth_label) == "benign")
    if exclude:
        query = query.where(RawLog.row_id.not_in(exclude))
    return session.execute(query.order_by(func.random()).limit(1)).scalars().first()


def dilute_with_benign(
    rows: list[RawLog], noise_pct: int, max_rows: int
) -> tuple[list[RawLog], list[uuid.UUID], float]:
    """Returns (rows_out, injected_row_ids_dropped, effective_pct).

    noise_pct 0 is the identity: rows come back unchanged, with no ids and 0.0.
    Otherwise the window is rows[:max_rows], and k = round(n * pct / 100) rows are chosen to drop, with
    at least one scenario row kept. Each dropped row is replaced by one benign row of the same source
    (ORDER BY random() LIMIT 1, never a row already in the window). A dropped row with no benign row
    left to take is kept, so k shrinks. injected_row_ids_dropped are the scenario rows removed.
    effective_pct is the replaced share of the window, in percent, rounded to 2 places.
    rows_out is sorted by timestamp.
    """
    if noise_pct not in NOISE_LEVELS:
        raise ValueError(f"noise_pct must be one of {NOISE_LEVELS}, got {noise_pct}")
    if noise_pct == 0:
        return list(rows), [], 0.0

    window = list(rows[:max_rows])
    n = len(window)
    k = min(round(n * noise_pct / 100), n - 1)
    if k <= 0:
        return window, [], 0.0

    drop_positions = set(random.Random().sample(range(n), k))
    used: list[uuid.UUID] = [row.row_id for row in window]
    rows_out: list[RawLog] = []
    dropped: list[uuid.UUID] = []

    session = SessionLocal()
    try:
        for index, row in enumerate(window):
            if index not in drop_positions:
                rows_out.append(row)
                continue
            benign = _pick_benign(session, row.source, used)
            if benign is None:
                rows_out.append(row)  # no benign row of this source left: keep the scenario row
                continue
            rows_out.append(benign)
            used.append(benign.row_id)
            dropped.append(row.row_id)
    finally:
        session.close()

    rows_out.sort(key=lambda r: r.timestamp)
    effective_pct = round(100.0 * len(dropped) / n, 2)
    return rows_out, dropped, effective_pct
