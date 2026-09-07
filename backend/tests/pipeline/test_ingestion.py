import pytest
from sqlalchemy import func, select

from backend.db.models import RawLog
from backend.pipeline.ingestion import MERGED_POOL, build_curated_subset, ingest_into_db

pytestmark = pytest.mark.skipif(
    not MERGED_POOL.exists(), reason="data/verdictchain_network_dataset.csv not built yet"
)

ATTACK_TYPES = ["DDoS", "Portscan", "FTP-Patator"]


def test_build_curated_subset_is_stratified_and_sorted(tmp_path):
    out_path = tmp_path / "subset.csv"
    sample = build_curated_subset(
        attack_types=ATTACK_TYPES,
        n_per_class=20,
        benign_count=20,
        out_path=out_path,
    )

    assert out_path.exists()
    counts = sample["Label"].value_counts()
    assert counts["BENIGN"] == 20
    for label in ATTACK_TYPES:
        assert counts[label] == 20

    timestamps = sample["Timestamp"].tolist()
    assert timestamps == sorted(timestamps)


def test_ingest_into_db_populates_raw_logs(tmp_path, db_session):
    out_path = tmp_path / "subset.csv"
    build_curated_subset(
        attack_types=ATTACK_TYPES,
        n_per_class=10,
        benign_count=10,
        out_path=out_path,
    )

    inserted = ingest_into_db(csv_path=out_path)
    assert inserted == 10 + 10 * len(ATTACK_TYPES)

    total = db_session.execute(select(func.count()).select_from(RawLog)).scalar_one()
    assert total == inserted

    sample_row = db_session.execute(select(RawLog).limit(1)).scalar_one()
    assert sample_row.source == "cicids2017"
    assert sample_row.event_type == "network_flow"
    assert "Label" not in sample_row.raw_fields
    assert sample_row.ground_truth_label is not None


def test_ingest_into_db_is_idempotent_and_scoped_to_its_own_source(tmp_path, db_session):
    """Re-running ingestion must not accumulate duplicates, and must never touch
    rows from other sources (e.g. leftover test fixtures, future CERT rows).
    """
    other_source = RawLog(
        timestamp="2026-01-01T00:00:00+00:00",
        source="cert_r4.2_logon",
        event_type="logon",
        raw_fields={},
    )
    db_session.add(other_source)
    db_session.commit()

    out_path = tmp_path / "subset.csv"
    build_curated_subset(attack_types=ATTACK_TYPES, n_per_class=5, benign_count=5, out_path=out_path)

    first = ingest_into_db(csv_path=out_path)
    second = ingest_into_db(csv_path=out_path)
    assert first == second == 5 + 5 * len(ATTACK_TYPES)

    total = db_session.execute(select(func.count()).select_from(RawLog)).scalar_one()
    assert total == second + 1  # the network rows, exactly once, plus the untouched other-source row

    still_there = db_session.get(RawLog, other_source.row_id)
    assert still_there is not None
