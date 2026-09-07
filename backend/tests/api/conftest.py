"""TestClient requests all report the same client_ip ('testclient'), and Redis
rate-limit counters (backend/api/rate_limit.py) aren't cleared by the Postgres
db_session fixture - without this, accumulated test runs across a session (or
day) legitimately trip the real 429 limit, which is a test-hygiene problem, not
a reason to weaken the actual production limit.
"""

import pytest

from backend.api.rate_limit import _client


@pytest.fixture(autouse=True)
def _clear_rate_limits():
    client = _client()
    for key in client.scan_iter("verdictchain:ratelimit:*"):
        client.delete(key)
    yield
