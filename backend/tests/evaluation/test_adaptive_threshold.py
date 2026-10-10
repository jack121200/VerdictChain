"""LG10: analyst feedback moves the verdict confidence threshold by small, bounded, audited steps."""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from backend.api.main import app
from backend.db.models import AnalystFeedback, AuditTrail
from backend.db.runtime_settings import load
from backend.db.session import SessionLocal
from backend.evaluation import adaptive_threshold as adaptive
from backend.evaluation.adaptive_threshold import assess
from backend.tests.fixtures.auth import auth_headers
from backend.tests.fixtures.read_seed import add_investigation, bearer_for

client = TestClient(app)


def flags(wrong: int, right: int) -> list[bool]:
    """Newest first: the wrong ones first, so a window cut short still shows them."""
    return [False] * wrong + [True] * right


def test_too_little_feedback_waits_and_says_how_much_is_missing():
    result = assess(flags(2, 5), 0.80, since_last_change=7)

    assert result.action == "wait" and result.new_threshold is None
    assert result.window == 7 and result.reason == "7 of the 10 feedback rows needed"


def test_a_burst_of_false_positives_tightens_one_step():
    result = assess(flags(6, 14), 0.80, since_last_change=20)  # 30 % of the last 20

    assert result.action == "tighten" and result.new_threshold == pytest.approx(0.82)
    assert "6 of the last 20 verdicts were marked false positives (30%" in result.reason


def test_steady_confirmations_relax_one_smaller_step():
    result = assess(flags(1, 19), 0.80, since_last_change=20)  # 5 % of the last 20

    assert result.action == "relax" and result.new_threshold == pytest.approx(0.79)
    assert "19 of the last 20 verdicts were confirmed" in result.reason


def test_in_between_holds():
    result = assess(flags(3, 17), 0.80, since_last_change=20)  # 15 %

    assert result.action == "hold" and result.new_threshold is None


def test_it_moves_at_most_once_per_five_new_feedback_rows():
    result = assess(flags(8, 12), 0.80, since_last_change=4)

    assert (
        result.action == "wait" and result.reason == "4 of the 5 new feedback rows needed since the last move"
    )


def test_only_the_newest_twenty_count():
    newest_first = [True] * 20 + [False] * 30  # twenty confirmations, then thirty false positives long ago
    result = assess(newest_first, 0.80, since_last_change=20)

    assert result.window == 20 and result.false_positives == 0 and result.action == "relax"


def test_the_bounds_hold_the_threshold_in_place():
    at_ceiling = assess(flags(10, 10), adaptive.CEILING, since_last_change=20)
    at_floor = assess(flags(0, 20), adaptive.FLOOR, since_last_change=20)
    near_ceiling = assess(flags(10, 10), 0.94, since_last_change=20)

    assert at_ceiling.action == "hold" and "ceiling" in at_ceiling.reason
    assert at_floor.action == "hold" and "floor" in at_floor.reason
    assert near_ceiling.new_threshold == pytest.approx(adaptive.CEILING)  # clamped, not 0.96


def _feedback(db_session, wrong: int, right: int) -> None:
    investigation = add_investigation(db_session, verdict_class="ddos", confidence=0.9)
    db_session.flush()
    for correct in [False] * wrong + [True] * right:
        db_session.add(
            AnalystFeedback(investigation_id=investigation.investigation_id, verdict_was_correct=correct)
        )
    db_session.commit()


def test_adapt_writes_the_new_threshold_and_an_audit_entry_with_what_it_saw(db_session):
    _feedback(db_session, wrong=7, right=13)
    before = load(db_session).verdict_confidence_threshold

    with SessionLocal() as session:
        result = adaptive.adapt(session)
        session.commit()

    db_session.expire_all()
    after = load(db_session).verdict_confidence_threshold
    assert result.action == "tighten" and after == pytest.approx(before + adaptive.STEP_UP)
    entry = db_session.execute(select(AuditTrail).where(AuditTrail.actor == adaptive.ACTOR)).scalar_one()
    assert entry.action == "settings_changed"
    assert entry.detail["before"]["verdict_confidence_threshold"] == pytest.approx(before)
    assert entry.detail["after"]["verdict_confidence_threshold"] == pytest.approx(after)
    assert entry.detail["feedback_count"] == 20 and entry.detail["false_positives"] == 7
    assert "marked false positives" in entry.detail["reason"]


def test_a_second_adapt_without_five_new_rows_does_not_move_again(db_session):
    _feedback(db_session, wrong=8, right=12)
    with SessionLocal() as session:
        first = adaptive.adapt(session)
        session.commit()
    with SessionLocal() as session:
        second = adaptive.adapt(session)
        session.commit()

    assert first.action == "tighten"
    assert second.action == "wait" and second.reason.startswith("0 of the 5 new feedback rows")
    assert (
        len(db_session.execute(select(AuditTrail).where(AuditTrail.actor == adaptive.ACTOR)).scalars().all())
        == 1
    )

    _feedback(db_session, wrong=5, right=0)  # five more false positives
    with SessionLocal() as session:
        third = adaptive.adapt(session)
        session.commit()
    assert third.action == "tighten"
    assert (
        len(db_session.execute(select(AuditTrail).where(AuditTrail.actor == adaptive.ACTOR)).scalars().all())
        == 2
    )


def test_posting_feedback_through_the_api_can_move_the_threshold(db_session):
    investigation = add_investigation(db_session, verdict_class="ddos", confidence=0.9)
    db_session.commit()
    headers = bearer_for("forensic_analyst")
    before = load(db_session).verdict_confidence_threshold

    for index in range(10):  # ten false positives in a row
        response = client.post(
            f"/investigations/{investigation.investigation_id}/feedback",
            json={"verdict_was_correct": False},
            headers=headers,
        )
        assert response.status_code == 204, index

    db_session.expire_all()
    assert load(db_session).verdict_confidence_threshold == pytest.approx(before + adaptive.STEP_UP)
    assert db_session.execute(select(AuditTrail).where(AuditTrail.actor == adaptive.ACTOR)).scalar_one()


def test_the_read_endpoint_reports_the_rule_the_assessment_and_the_last_move(db_session):
    headers = auth_headers("forensic_analyst")
    empty = client.get("/settings/adaptive", headers=headers).json()
    assert empty["next_step"] == "wait" and empty["window"]["value"] == 0
    assert empty["false_positive_share"]["value"] is None and empty["false_positive_share"]["reason"]
    assert empty["last_change"] is None
    assert empty["rule"]["window_size"] == 20 and empty["rule"]["step_up"] == 0.02

    _feedback(db_session, wrong=7, right=13)
    with SessionLocal() as session:
        adaptive.adapt(session)
        session.commit()

    moved = client.get("/settings/adaptive", headers=headers).json()
    assert moved["last_change"]["after"] == pytest.approx(moved["threshold"]["value"])
    assert moved["last_change"]["after"] - moved["last_change"]["before"] == pytest.approx(0.02)
    assert moved["false_positive_share"]["value"] == pytest.approx(7 / 20)
    assert moved["next_step"] == "wait"  # nothing new since that move


def test_unauthenticated_reads_are_refused(db_session):
    assert client.get("/settings/adaptive").status_code == 401


@pytest.fixture(autouse=True)
def _default_settings(db_session):
    db_session.execute(text("UPDATE runtime_settings SET verdict_confidence_threshold = 0.80 WHERE id = 1"))
    db_session.commit()
    yield
