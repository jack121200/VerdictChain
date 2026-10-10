"""SD6: the heavier read endpoints are limited per client and minute; every other read is not."""

import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.rate_limit import get_redis
from backend.tests.fixtures.auth import auth_headers

client = TestClient(app)

LIMITED = [
    ("/evaluation", 60),
    ("/citations", 120),
    ("/audit-trail", 120),
    ("/raw-logs/recent", 240),
    ("/agents/network_traffic/credibility-history", 120),
]


@pytest.fixture(autouse=True)
def _fresh_counters():
    redis_client = get_redis()
    for key in redis_client.scan_iter("verdictchain:ratelimit:read:*"):
        redis_client.delete(key)
    yield
    for key in redis_client.scan_iter("verdictchain:ratelimit:read:*"):
        redis_client.delete(key)


def test_an_evaluation_read_is_refused_after_sixty_in_a_minute(db_session):
    headers = auth_headers("forensic_analyst")
    codes = [client.get("/evaluation", headers=headers).status_code for _ in range(61)]

    assert codes[:60] == [200] * 60
    assert codes[60] == 429


def test_the_refusal_names_the_endpoint_and_other_reads_still_work(db_session):
    headers = auth_headers("forensic_analyst")
    for _ in range(60):
        client.get("/evaluation", headers=headers)
    refused = client.get("/evaluation", headers=headers)

    assert refused.status_code == 429 and "read:evaluation" in refused.json()["detail"]
    assert client.get("/stats", headers=headers).status_code == 200  # a different endpoint has its own count
    assert client.get("/citations", headers=headers).status_code == 200


@pytest.mark.parametrize(("path", "limit"), LIMITED)
def test_every_limited_read_has_its_own_ceiling(db_session, path, limit):
    redis_client = get_redis()
    name = {
        "/evaluation": "evaluation",
        "/citations": "citations",
        "/audit-trail": "audit",
        "/raw-logs/recent": "raw-logs",
    }.get(path, "credibility")
    redis_client.set(
        f"verdictchain:ratelimit:read:{name}:testclient", limit
    )  # the counter already stands at the ceiling
    redis_client.expire(f"verdictchain:ratelimit:read:{name}:testclient", 60)

    assert client.get(path, headers=auth_headers("forensic_analyst")).status_code == 429


def test_the_limiter_steps_aside_when_redis_fails(db_session, monkeypatch):
    import redis

    def broken(*args, **kwargs):
        raise redis.RedisError("down")

    monkeypatch.setattr("backend.api.rate_limit.enforce_rate_limit", broken)

    assert client.get("/audit-trail", headers=auth_headers("forensic_analyst")).status_code == 200
