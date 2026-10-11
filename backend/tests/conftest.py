import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url

from backend.config import settings
from backend.tests.fixtures.dbguard import refusal_reason

BACKEND_DIR = Path(__file__).resolve().parent.parent

# The one database this run may use. TEST_DATABASE_URL wins; otherwise the local URL.
TEST_DB_URL = settings.test_database_url or settings.sqlalchemy_url

TABLES = (
    "raw_logs",
    "investigations",
    "debate_transcripts",
    "credibility_log",
    "response_actions",
    "model_versions",
    "audit_trail",
    "analyst_feedback",
    "analysts",
    "runtime_settings",
    "agent_quarantine",
)

# TRUNCATE empties the seeded tables too, so each test re-seeds them to the migration's initial state.
SEED_STATEMENTS = (
    "INSERT INTO runtime_settings (id) VALUES (1) ON CONFLICT DO NOTHING",
    "INSERT INTO agent_quarantine (agent_id, active) VALUES "
    "('network_traffic', false), ('access_log', false), ('endpoint_behavior', false) "
    "ON CONFLICT DO NOTHING",
)


def pytest_configure(config: pytest.Config) -> None:
    """Runs before any test module is collected, so the app engine is created against the test DB."""
    reason = refusal_reason(TEST_DB_URL)
    if reason is not None:
        pytest.exit(
            f"Refusing to run the test suite: {reason}.\n"
            "Set TEST_DATABASE_URL in .env (or the environment) to a dedicated test database, "
            "for example verdictchain_test.",
            returncode=4,
        )
    settings.environment = "development"
    settings.local_database_url = TEST_DB_URL


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    # Imported here, not at module level: importing the app engine before pytest_configure
    # has pointed settings at the test database would bind it to the wrong URL.
    from backend.db.session import engine

    if engine.url.database != make_url(TEST_DB_URL).database:
        raise RuntimeError("the app engine is not bound to the test database; refusing to run")
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={**os.environ, "ENVIRONMENT": "development", "LOCAL_DATABASE_URL": TEST_DB_URL},
        check=True,
    )
    yield


@pytest.fixture(autouse=True)
def _one_debate_at_a_time(monkeypatch):
    """The queue, slot and live tests were written for a single debate slot and assert on it. The app now runs
    several debates at once (DEBATE_MAX_CONCURRENT), so the suite pins one; the tests of parallel debates set
    their own number inside the test."""
    monkeypatch.setattr(settings, "debate_max_concurrent", 1)


@pytest.fixture(autouse=True)
def _no_openai_allowance_left_over():
    """What OpenAI said about the key's limits lives in Redis and gates new debates (openai_usage.py). A test
    that records one must not leak it into the next test, and a developer's real reading must not leak in."""
    from backend.agents import openai_usage

    def clear() -> None:
        try:
            openai_usage._redis().delete(openai_usage.LIMITS_KEY)
        except Exception:  # noqa: BLE001 - tests that need no Redis must not fail on this
            pass

    clear()
    yield
    clear()


@pytest.fixture()
def db_session():
    """NOTE: truncates every table in TABLES on each use. This is only ever the test database."""
    from backend.db.session import SessionLocal

    session = SessionLocal()
    session.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
    for statement in SEED_STATEMENTS:
        session.execute(text(statement))
    session.commit()
    try:
        yield session
    finally:
        session.close()
