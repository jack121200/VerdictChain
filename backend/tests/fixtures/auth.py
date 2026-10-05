"""Analyst fixtures for API and DB tests (plan section 5, W0-A).

make_analyst() creates a real Analyst row with a bcrypt hash. auth_headers() also logs in through
POST /auth/login, so the token it returns is a real one. Imported only by tests, after conftest.py
has pointed the app engine at the test database.
"""

import uuid

from fastapi.testclient import TestClient

from backend.api.auth import hash_password
from backend.api.main import app
from backend.api.rbac import ROLES
from backend.db.models import Analyst
from backend.db.session import SessionLocal

TEST_PASSWORD = "a_strong_password_123"


def make_analyst(role: str, *, username: str | None = None, password: str = TEST_PASSWORD) -> Analyst:
    """Creates an analyst with `role` and returns the row. The username is unique unless one is given."""
    if role not in ROLES:
        raise ValueError(f"unknown role {role!r}")
    session = SessionLocal()
    try:
        analyst = Analyst(
            username=username or f"{role}_{uuid.uuid4().hex[:10]}",
            password_hash=hash_password(password),
            role=role,
        )
        session.add(analyst)
        session.commit()
        session.refresh(analyst)
        return analyst
    finally:
        session.close()


def auth_headers(role: str, *, username: str | None = None, password: str = TEST_PASSWORD) -> dict[str, str]:
    """Creates an analyst with `role`, logs in through POST /auth/login and returns the Bearer header."""
    analyst = make_analyst(role, username=username, password=password)
    response = TestClient(app).post("/auth/login", json={"username": analyst.username, "password": password})
    if response.status_code != 200:
        raise RuntimeError(
            f"login for fixture analyst {analyst.username!r} failed: HTTP {response.status_code}"
        )
    return {"Authorization": f"Bearer {response.json()['access_token']}"}
