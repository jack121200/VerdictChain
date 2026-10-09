"""The evaluation label of an automatic investigation (checklist RT4).

An investigation the live monitor starts has no scenario: it has a window of rows. To score it later in
/evaluation it gets the label most of the rows it reads carry in the dataset, attached on the server after
the fact. This is the ground-truth tag of SKILL-data-schema.md Section 6: it is stored on the investigation
row for evaluation only, never passed to an agent, never returned by the API. The monitor never calls this;
the runner does, once, while it creates the investigation.
"""

import uuid
from collections import Counter
from collections.abc import Sequence

from sqlalchemy import select

from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.evaluation.ground_truth_map import SCENARIO_GROUND_TRUTH


def evaluation_label(row_ids: Sequence[uuid.UUID]) -> str | None:
    """The most common dataset label among these rows, as a scenario label /evaluation knows ('benign' rows
    of CERT count as 'BENIGN'). None when no row carries a label that has a ground-truth mapping. A tie goes
    to the label that sorts first, so the result does not depend on row order."""
    if not row_ids:
        return None
    with SessionLocal() as session:
        labels = (
            session.execute(select(RawLog.ground_truth_label).where(RawLog.row_id.in_(list(row_ids))))
            .scalars()
            .all()
        )
    counts = Counter(
        "BENIGN" if label is not None and label.lower() == "benign" else label for label in labels
    )
    counts = Counter({label: n for label, n in counts.items() if label in SCENARIO_GROUND_TRUTH})
    if not counts:
        return None
    top = max(counts.values())
    return sorted(label for label, n in counts.items() if n == top)[0]
