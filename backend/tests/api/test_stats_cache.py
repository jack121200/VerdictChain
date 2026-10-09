"""GET /stats Redis cache (BE5/SD6): a second call inside the TTL runs no stats queries, every committed
transaction drops the cache before its change event is published, and a cache failure never fails a request.
"""

from contextlib import contextmanager

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event

from backend.api.main import app
from backend.api.rate_limit import _client
from backend.api.routes import stats as stats_route
from backend.db import change_events
from backend.db.audit import append_entry
from backend.db.session import SessionLocal, engine
from backend.tests.fixtures.read_seed import add_investigation, audit, bearer_for

client = TestClient(app)

STATS_TABLES = (
    "investigations",
    "debate_transcripts",
    "credibility_log",
    "response_actions",
    "analyst_feedback",
    "audit_trail",
    "raw_logs",
)


def _get(headers: dict) -> dict:
    response = client.get("/stats", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _cached() -> bool:
    return bool(_client().exists(change_events.STATS_CACHE_KEY))


@contextmanager
def _sql_statements():
    seen: list[str] = []

    def record(_conn, _cursor, statement, *_args):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", record)


def test_a_second_call_inside_the_ttl_runs_no_stats_queries(db_session):
    audit(db_session, "watchdog", "credibility_update", {"n": 1})
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    with _sql_statements() as first_run:
        first = _get(headers)
    with _sql_statements() as second_run:
        second = _get(headers)

    assert any("audit_trail" in sql for sql in first_run) and len(first_run) > 5
    # The only query left is the per-request analyst lookup (authentication re-reads the analyst row).
    assert len(second_run) == 1 and "FROM analysts" in second_run[0]
    assert not [sql for sql in second_run if any(table in sql for table in STATS_TABLES)]
    assert second == first  # the cached response is the computed one, as_of and generated_at included


def test_the_cache_holds_the_response_for_a_few_seconds_only(db_session):
    headers = bearer_for("forensic_analyst")

    _get(headers)

    ttl = _client().ttl(change_events.STATS_CACHE_KEY)
    assert 0 < ttl <= stats_route.STATS_CACHE_TTL_SECONDS == 5


def test_a_committed_audit_entry_drops_the_cache(db_session):
    headers = bearer_for("forensic_analyst")
    before = _get(headers)
    assert _cached()

    session = SessionLocal()
    try:
        append_entry(session, "tester", "login", {"role": "forensic_analyst"})
        assert _cached()  # not before the commit: nothing has changed for other readers yet
        session.commit()
    finally:
        session.close()

    assert not _cached()
    after = _get(headers)
    assert after["chain"]["entries"]["value"] == before["chain"]["entries"]["value"] + 1


def test_a_commit_without_an_audit_entry_drops_the_cache_too(db_session):
    """POST /investigations/{id}/feedback commits an analyst_feedback row and writes no audit entry."""
    inv = add_investigation(db_session, status="verdict_reached", verdict_class="ddos", confidence=0.9)
    db_session.commit()
    headers = bearer_for("forensic_analyst")
    assert _get(headers)["feedback"]["total"]["value"] == 0

    sent = client.post(
        f"/investigations/{inv.investigation_id}/feedback",
        headers=headers,
        json={"verdict_was_correct": False},
    )

    assert sent.status_code == 204
    body = _get(headers)
    assert body["feedback"]["total"]["value"] == 1
    assert body["feedback"]["false_positive"]["value"] == 1


def test_the_cache_is_dropped_before_the_change_event_is_published(db_session, monkeypatch):
    headers = bearer_for("forensic_analyst")
    _get(headers)
    cached_when_published: list[bool] = []

    def publish(actions, investigation_ids=None):
        cached_when_published.append(_cached())
        return True

    monkeypatch.setattr(change_events, "publish_change", publish)
    session = SessionLocal()
    try:
        append_entry(session, "tester", "login", {"role": "forensic_analyst"})
        session.commit()
    finally:
        session.close()

    # A client that refetches because of the event must not be served the old response.
    assert cached_when_published == [False]


def test_a_computation_that_straddles_a_commit_is_not_cached(db_session, monkeypatch):
    headers = bearer_for("forensic_analyst")
    real = stats_route._compute_stats

    def straddling():
        result = real()
        change_events.invalidate_stats_cache()  # a commit lands while the computation is still running
        return result

    monkeypatch.setattr(stats_route, "_compute_stats", straddling)
    assert _get(headers)["chain"]["entries"]["value"] == 0
    assert not _cached()  # the older result must not outlive the commit that voided it

    monkeypatch.setattr(stats_route, "_compute_stats", real)
    _get(headers)
    assert _cached()


def test_an_unreadable_cached_payload_is_recomputed_and_replaced(db_session):
    headers = bearer_for("forensic_analyst")
    _client().set(change_events.STATS_CACHE_KEY, "not json")

    body = _get(headers)

    assert body["chain"]["valid"] is True
    assert _client().get(change_events.STATS_CACHE_KEY) != "not json"


class _BrokenRedis:
    def __getattr__(self, name):
        def fail(*_args, **_kwargs):
            raise ConnectionError("redis is down")

        return fail


def test_a_cache_failure_never_fails_the_request(db_session, monkeypatch):
    add_investigation(db_session, status="verdict_reached", verdict_class="ddos", confidence=0.9)
    db_session.commit()
    headers = bearer_for("forensic_analyst")
    monkeypatch.setattr(change_events, "_redis", lambda: _BrokenRedis())

    body = _get(headers)

    assert body["by_verdict_class"]["ddos"]["value"] == 1
    assert not _cached()  # nothing was stored, and nothing raised


@pytest.mark.parametrize("path", ["/stats"])
def test_the_cache_is_not_a_way_around_authentication(db_session, path):
    headers = bearer_for("forensic_analyst")
    _get(headers)
    assert _cached()

    assert client.get(path).status_code == 401
