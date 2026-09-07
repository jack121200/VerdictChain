import uuid

import pytest
from fastapi import HTTPException

from backend.api.rate_limit import enforce_rate_limit


def test_enforce_rate_limit_allows_up_to_limit():
    identifier = f"test_{uuid.uuid4().hex[:8]}"
    for _ in range(3):
        enforce_rate_limit("test_action", identifier, limit=3, window_seconds=60)  # must not raise


def test_enforce_rate_limit_blocks_over_limit():
    identifier = f"test_{uuid.uuid4().hex[:8]}"
    for _ in range(3):
        enforce_rate_limit("test_action", identifier, limit=3, window_seconds=60)
    with pytest.raises(HTTPException) as exc_info:
        enforce_rate_limit("test_action", identifier, limit=3, window_seconds=60)
    assert exc_info.value.status_code == 429


def test_enforce_rate_limit_scoped_per_identifier():
    id_a = f"test_a_{uuid.uuid4().hex[:8]}"
    id_b = f"test_b_{uuid.uuid4().hex[:8]}"
    for _ in range(3):
        enforce_rate_limit("test_action", id_a, limit=3, window_seconds=60)
    enforce_rate_limit(
        "test_action", id_b, limit=3, window_seconds=60
    )  # different identifier, must not raise
