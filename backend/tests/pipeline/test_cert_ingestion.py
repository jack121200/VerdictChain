import pytest
from sqlalchemy import func, select

from backend.db.models import RawLog
from backend.pipeline.cert_ingestion import PROCESSED_DIR, ingest_cert_into_db

pytestmark = pytest.mark.skipif(
    not (PROCESSED_DIR / "cert_logon.csv").exists(),
    reason="CERT curated features not built yet",
)


def test_ingest_cert_into_db_is_idempotent(db_session):
    first = ingest_cert_into_db()
    second = ingest_cert_into_db()
    assert first == second

    total = db_session.execute(select(func.count()).select_from(RawLog)).scalar_one()
    assert total == sum(second.values())


def test_ingest_cert_into_db_scoped_to_its_own_sources(db_session):
    other = RawLog(
        timestamp="2026-01-01T00:00:00+00:00",
        source="cicids2017",
        event_type="network_flow",
        raw_fields={},
    )
    db_session.add(other)
    db_session.commit()

    ingest_cert_into_db()

    still_there = db_session.get(RawLog, other.row_id)
    assert still_there is not None


def test_ingested_cert_rows_have_no_ground_truth_leak_in_raw_fields(db_session):
    ingest_cert_into_db()
    row = db_session.execute(
        select(RawLog).where(RawLog.source == "cert_r4.2_logon").limit(1)
    ).scalar_one()
    assert "ground_truth_label" not in row.raw_fields
    assert "user" not in row.raw_fields
