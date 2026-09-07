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


CHUNK_SIZE = 200_000


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

    Reads pool_path in chunks rather than loading the full ~2M-row pool at once
    (that OOM'd on this session's 7.7GB dev machine under normal system load).
    Per chunk, takes at most `target` matching rows for each label (a fast
    approximate sample, not true reservoir sampling - fine for building a demo
    dataset) into a small running pool, then does one final exact-size sample
    from that much smaller accumulated pool.
    """
    targets = {"BENIGN": benign_count, **{label: n_per_class for label in attack_types}}
    accumulated: dict[str, list[pd.DataFrame]] = {label: [] for label in targets}
    seen_any: dict[str, bool] = {label: False for label in targets}

    for chunk in pd.read_csv(pool_path, chunksize=CHUNK_SIZE, encoding="utf-8"):
        chunk["Label"] = chunk["Label"].astype(str).str.strip()
        for label, target in targets.items():
            match = (
                chunk[chunk["Label"].str.upper() == "BENIGN"]
                if label == "BENIGN"
                else chunk[chunk["Label"] == label]
            )
            if match.empty:
                continue
            seen_any[label] = True
            accumulated[label].append(match.sample(n=min(target, len(match)), random_state=seed))

    parts = []
    for label, target in targets.items():
        if not seen_any[label]:
            raise ValueError(f"No rows with Label == {label!r} found in {pool_path}")
        pool_for_label = pd.concat(accumulated[label], ignore_index=True)
        parts.append(pool_for_label.sample(n=min(target, len(pool_for_label)), random_state=seed))

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
    # All 4 attack families SKILL-agent-prompts.md's system prompt actually
    # describes the agent detecting: DDoS (flood), Portscan (recon),
    # FTP-Patator + SSH-Patator (brute-force, two protocols), Botnet (C2) -
    # the original 3-type set left botnet C2 completely untested. DoS
    # Hulk/GoldenEye/Slowloris deliberately excluded - same flood signal as
    # DDoS, no added coverage. Kept small (~9.7k) per this machine's memory
    # constraints (see 2026-09-07 session: 7.7GB host, Postgres was crashing
    # under load with the earlier ~26k attempt) - revisit larger once on a
    # machine with more headroom or before the actual demo.
    build_curated_subset(
        attack_types=["DDoS", "Portscan", "FTP-Patator", "SSH-Patator", "Botnet"],
        n_per_class=1500,
        benign_count=3000,
    )
    n = ingest_into_db()
    print(f"Ingested {n} network_flow rows into raw_logs.")
