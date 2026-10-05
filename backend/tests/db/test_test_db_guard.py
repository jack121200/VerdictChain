"""The suite must never run against the dev database, because its tables are TRUNCATEd."""

import os
import subprocess
import sys
from pathlib import Path

from backend.tests.fixtures.dbguard import refusal_reason

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_dev_database_is_refused_whatever_the_case():
    assert refusal_reason("postgresql+psycopg://u:p@127.0.0.1:5433/verdictchain") is not None
    assert refusal_reason("postgresql://u:p@host/VerdictChain") is not None


def test_database_without_test_in_its_name_is_refused():
    assert refusal_reason("postgresql+psycopg://u:p@host/neondb") is not None


def test_test_database_is_accepted():
    assert refusal_reason("postgresql+psycopg://u:p@127.0.0.1:5433/verdictchain_test") is None


def test_empty_and_malformed_urls_are_refused():
    assert refusal_reason("") is not None
    assert refusal_reason("not a url") is not None


def test_refusal_never_echoes_the_password():
    reason = refusal_reason("postgresql+psycopg://u:HUNTER2@127.0.0.1:5433/verdictchain")
    assert reason is not None
    assert "HUNTER2" not in reason


def test_suite_exits_before_running_when_pointed_at_the_dev_database():
    """Runs pytest in a child process whose database is the dev database on an unreachable
    port. The guard must stop it with exit code 4 before any connection is attempted.
    """
    env = {
        **os.environ,
        "TEST_DATABASE_URL": "postgresql+psycopg://guard:GUARD_SECRET@127.0.0.1:1/verdictchain",
    }
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            "-p",
            "no:cacheprovider",
            "-q",
            "backend/tests/db/test_test_db_guard.py::test_test_database_is_accepted",
        ],
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    output = result.stdout + result.stderr
    assert result.returncode == 4, output
    assert "Refusing to run the test suite" in output
    assert "GUARD_SECRET" not in output
