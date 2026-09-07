import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import text

from backend.db.session import SessionLocal

BACKEND_DIR = Path(__file__).resolve().parent.parent

TABLES = (
    "raw_logs",
    "investigations",
    "debate_transcripts",
    "credibility_log",
    "response_actions",
    "model_versions",
    "audit_trail",
    "analyst_feedback",
)


@pytest.fixture(scope="session", autouse=True)
def apply_migrations():
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        check=True,
    )
    yield


@pytest.fixture()
def db_session():
    """NOTE: truncates the tables below on every use, including raw_logs. Running
    the suite wipes any real ingested dataset - re-run
    `python -m backend.pipeline.ingestion` afterward to restore it.
    """
    session = SessionLocal()
    session.execute(text(f"TRUNCATE {', '.join(TABLES)} RESTART IDENTITY CASCADE"))
    session.commit()
    try:
        yield session
    finally:
        session.close()
