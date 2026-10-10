"""Analyst feedback moves the verdict confidence threshold (checklist LG10, SKILL-architecture.md Section 8).

Every "confirm" or "false positive" an analyst records is kept. This module reads the newest ones and, when
they say so, moves `verdict_confidence_threshold` (the confidence a verdict needs before Self-Healing may
contain) by a small step:

  tighten  the share of false positives in the newest WINDOW feedback rows is TIGHTEN_AT or more
           -> threshold + STEP_UP
  relax    that share is RELAX_AT or less
           -> threshold - STEP_DOWN
  hold     anything between, or the threshold already sits at its bound

It needs MIN_FEEDBACK rows to say anything, and it moves at most once per ADAPT_EVERY new feedback rows, so
one bad afternoon cannot walk the threshold. The result stays between FLOOR and CEILING (the runtime-settings
range is wider: an analyst with edit_settings can set any value in it, and this module moves it by one step at
most). Each move is a `settings_changed` audit entry by `adaptive_feedback` with the rows it saw.

Only the adaptive part of the spec is built. The scheduled retraining and the version comparison of the same
section are not: nothing in the system is trained (the verdict class comes from a fixed keyword rule).
"""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.db.audit import append_entry
from backend.db.models import AnalystFeedback, AuditTrail
from backend.db.runtime_settings import VALUE_RANGES, load, load_for_update, save

ACTOR = "adaptive_feedback"
WINDOW = 20
MIN_FEEDBACK = 10
ADAPT_EVERY = 5
TIGHTEN_AT = 0.30
RELAX_AT = 0.05
STEP_UP = 0.02
STEP_DOWN = 0.01
FLOOR = 0.70
CEILING = 0.95

Action = Literal["tighten", "relax", "hold", "wait"]


@dataclass(frozen=True)
class Assessment:
    window: int  # feedback rows looked at (at most WINDOW)
    false_positives: int
    share: float | None  # None without feedback
    action: Action
    reason: str
    new_threshold: float | None  # set for tighten and relax


def assess(was_correct: list[bool], current: float, since_last_change: int) -> Assessment:
    """The decision as a pure function. was_correct is newest first; since_last_change is how many feedback
    rows arrived after the last adaptive move (or all of them if there was none)."""
    window = was_correct[:WINDOW]
    wrong = sum(1 for correct in window if not correct)
    share = wrong / len(window) if window else None
    if len(window) < MIN_FEEDBACK:
        return Assessment(
            len(window),
            wrong,
            share,
            "wait",
            f"{len(window)} of the {MIN_FEEDBACK} feedback rows needed",
            None,
        )
    assert share is not None
    if since_last_change < ADAPT_EVERY:
        return Assessment(
            len(window),
            wrong,
            share,
            "wait",
            f"{since_last_change} of the {ADAPT_EVERY} new feedback rows needed since the last move",
            None,
        )
    minimum = VALUE_RANGES["verdict_confidence_threshold"][0]
    if share >= TIGHTEN_AT:
        target = min(CEILING, round(current + STEP_UP, 4))
        if target > current:
            reason = (
                f"{wrong} of the last {len(window)} verdicts were marked false positives ({share:.0%}, "
                f"tighten at {TIGHTEN_AT:.0%}): threshold {current:.2f} to {target:.2f}"
            )
            return Assessment(len(window), wrong, share, "tighten", reason, target)
        return Assessment(
            len(window),
            wrong,
            share,
            "hold",
            f"false positives {share:.0%} but the threshold is at its ceiling {CEILING:.2f}",
            None,
        )
    if share <= RELAX_AT:
        target = max(FLOOR, minimum, round(current - STEP_DOWN, 4))
        if target < current:
            reason = (
                f"{len(window) - wrong} of the last {len(window)} verdicts were confirmed ({1 - share:.0%}, "
                f"relax at {1 - RELAX_AT:.0%}): threshold {current:.2f} to {target:.2f}"
            )
            return Assessment(len(window), wrong, share, "relax", reason, target)
        return Assessment(
            len(window),
            wrong,
            share,
            "hold",
            f"confirmations are steady but the threshold is at its floor {FLOOR:.2f}",
            None,
        )
    return Assessment(
        len(window),
        wrong,
        share,
        "hold",
        f"false positives {share:.0%} sit between {RELAX_AT:.0%} and {TIGHTEN_AT:.0%}",
        None,
    )


def feedback_flags(session: Session) -> list[bool]:
    """verdict_was_correct of the newest WINDOW feedback rows, newest first."""
    return list(
        session.execute(
            select(AnalystFeedback.verdict_was_correct)
            .order_by(AnalystFeedback.created_at.desc())
            .limit(WINDOW)
        ).scalars()
    )


def feedback_count(session: Session) -> int:
    return session.execute(select(func.count()).select_from(AnalystFeedback)).scalar_one()


def last_change(session: Session) -> AuditTrail | None:
    return session.execute(
        select(AuditTrail)
        .where(AuditTrail.actor == ACTOR, AuditTrail.action == "settings_changed")
        .order_by(AuditTrail.seq.desc())
        .limit(1)
    ).scalar_one_or_none()


def since_last_change(session: Session, total: int) -> int:
    previous = last_change(session)
    seen = int((previous.detail or {}).get("feedback_count", 0)) if previous is not None else 0
    return total - seen


def current_assessment(session: Session) -> tuple[Assessment, float]:
    """What the rule would do now, and the threshold it starts from. Writes nothing."""
    threshold = load(session).verdict_confidence_threshold
    total = feedback_count(session)
    return assess(feedback_flags(session), threshold, since_last_change(session, total)), threshold


def adapt(session: Session) -> Assessment:
    """Moves the threshold when the rule says so and writes the audit entry. Flushes but does not commit: the
    caller commits. The settings row is locked, so two feedbacks arriving together cannot both move it."""
    settings = load_for_update(session)
    total = feedback_count(session)
    assessment = assess(
        feedback_flags(session), settings.verdict_confidence_threshold, since_last_change(session, total)
    )
    if assessment.new_threshold is None:
        return assessment
    before = settings.values()
    after = save(
        session, {**before, "verdict_confidence_threshold": assessment.new_threshold}, updated_by=ACTOR
    )
    append_entry(
        session,
        actor=ACTOR,
        action="settings_changed",
        detail={
            "before": before,
            "after": after.values(),
            "reason": assessment.reason,
            "feedback_count": total,
            "window": assessment.window,
            "false_positives": assessment.false_positives,
        },
    )
    return assessment
