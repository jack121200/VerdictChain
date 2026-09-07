"""Builds the curated network-flow subset (SKILL-architecture.md Section 9: "filtered
subset, ~2-3k rows, 2-3 attack types + benign") and loads it into raw_logs.

The full merged CSV (data/verdictchain_network_dataset.csv) is a large pool, not
what agents work from directly — this module samples a small, stratified,
demo-sized slice from it and persists that as the actual operational dataset.
"""

from pathlib import Path

import pandas as pd

from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.pipeline.normalization import normalize_network_row

REPO_ROOT = Path(__file__).resolve().parents[2]
MERGED_POOL = REPO_ROOT / "data" / "verdictchain_network_dataset.csv"
SUBSET_PATH = REPO_ROOT / "data" / "processed" / "network_subset.csv"


def build_curated_subset(
    attack_types: list[str],
    n_per_class: int = 600,
    benign_count: int = 900,
    seed: int = 42,
    pool_path: Path = MERGED_POOL,
    out_path: Path = SUBSET_PATH,
) -> pd.DataFrame:
    """Stratified sample: benign_count BENIGN rows + up to n_per_class rows per
    attack type in attack_types, written to out_path. Returns the sampled frame.
    """
    pool = pd.read_csv(pool_path, encoding="utf-8")
    pool["Label"] = pool["Label"].astype(str).str.strip()

    parts = []
    benign = pool[pool["Label"].str.upper() == "BENIGN"]
    if len(benign) == 0:
        raise ValueError(f"No BENIGN rows found in {pool_path}")
    parts.append(benign.sample(n=min(benign_count, len(benign)), random_state=seed))

    for label in attack_types:
        subset = pool[pool["Label"] == label]
        if len(subset) == 0:
            raise ValueError(f"No rows with Label == {label!r} found in {pool_path}")
        parts.append(subset.sample(n=min(n_per_class, len(subset)), random_state=seed))

    sample = pd.concat(parts, ignore_index=True)
    sample = sample.sort_values("Timestamp").reset_index(drop=True)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sample.to_csv(out_path, index=False)
    return sample


def ingest_into_db(csv_path: Path = SUBSET_PATH) -> int:
    """Normalizes every row of the curated subset and bulk-inserts into raw_logs.
    Returns the number of rows inserted.

    Deletes any existing source="cicids2017" rows first, so this is safe to
    re-run (e.g. after the test suite truncates and repopulates raw_logs with
    unrelated fixture rows) without accumulating duplicates. Scoped to this
    source only - never touches rows from other sources (e.g. CERT r4.2, once
    that exists).
    """
    df = pd.read_csv(csv_path, encoding="utf-8")
    records = [normalize_network_row(row) for row in df.to_dict(orient="records")]

    session = SessionLocal()
    try:
        session.query(RawLog).filter(RawLog.source == "cicids2017").delete()
        session.bulk_insert_mappings(RawLog, records)
        session.commit()
    finally:
        session.close()

    return len(records)


if __name__ == "__main__":
    # DDoS (flood), Portscan (recon), FTP-Patator (brute-force) - 3 of the 4
    # attack families SKILL-architecture.md assigns to the Network-Traffic Agent.
    build_curated_subset(attack_types=["DDoS", "Portscan", "FTP-Patator"])
    n = ingest_into_db()
    print(f"Ingested {n} network_flow rows into raw_logs.")
