"""Orchestrates the CERT r4.2 branch: pick a user set (all 70 real malicious
users + a benign sample), pull their events out of the (large) raw CSVs in
chunks, aggregate to per-user-per-day features, normalize, and load into
raw_logs. Mirrors backend/pipeline/ingestion.py's role for the network branch.
"""

import random
from pathlib import Path

import pandas as pd

from backend.db.models import RawLog
from backend.db.session import SessionLocal
from backend.pipeline.cert_features import (
    build_device_features,
    build_file_features,
    build_logon_features,
    load_ldap_departments,
)
from backend.pipeline.cert_ground_truth import load_malicious_event_ids, load_malicious_users
from backend.pipeline.normalization import (
    normalize_cert_device_row,
    normalize_cert_file_row,
    normalize_cert_logon_row,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
CERT_RAW_DIR = REPO_ROOT / "data" / "raw_data" / "insider_raw_data"
LDAP_DIR = CERT_RAW_DIR / "LDAP"
PROCESSED_DIR = REPO_ROOT / "data" / "processed"

CHUNK_SIZE = 100_000


def _select_users(benign_count: int, seed: int) -> set[str]:
    malicious_users = load_malicious_users()  # 70 real users, 3 real scenarios
    all_users: set[str] = set()
    with open(CERT_RAW_DIR / "logon.csv", encoding="utf-8") as f:
        next(f)  # header
        for line in f:
            all_users.add(line.split(",", 4)[2])

    candidates = sorted(all_users - malicious_users.keys())
    rng = random.Random(seed)
    benign_sample = set(rng.sample(candidates, min(benign_count, len(candidates))))
    return set(malicious_users) | benign_sample


def _read_filtered(csv_name: str, users: set[str], usecols: list[str]) -> pd.DataFrame:
    chunks = []
    for chunk in pd.read_csv(
        CERT_RAW_DIR / csv_name, usecols=usecols, chunksize=CHUNK_SIZE, encoding="utf-8"
    ):
        filtered = chunk[chunk["user"].isin(users)]
        if not filtered.empty:
            chunks.append(filtered)
    result = pd.concat(chunks, ignore_index=True) if chunks else pd.DataFrame(columns=usecols)
    result["date"] = pd.to_datetime(result["date"], format="%m/%d/%Y %H:%M:%S")
    return result


def build_curated_cert_features(benign_count: int = 130, seed: int = 42) -> dict[str, pd.DataFrame]:
    """Returns {'logon': df, 'device': df, 'file': df} of per-user-per-day
    aggregate features, and writes each to data/processed/cert_<name>.csv.
    """
    users = _select_users(benign_count, seed)
    malicious_ids = load_malicious_event_ids()
    departments = load_ldap_departments(LDAP_DIR)

    logon_raw = _read_filtered("logon.csv", users, ["id", "date", "user", "pc", "activity"])
    device_raw = _read_filtered("device.csv", users, ["id", "date", "user", "pc", "activity"])
    file_raw = _read_filtered("file.csv", users, ["id", "date", "user", "pc", "filename"])

    features = {
        "logon": build_logon_features(logon_raw, malicious_ids),
        "device": build_device_features(device_raw, malicious_ids),
        "file": build_file_features(file_raw, malicious_ids, departments),
    }

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    for name, df in features.items():
        df.to_csv(PROCESSED_DIR / f"cert_{name}.csv", index=False)

    return features


_NORMALIZERS = {
    "logon": normalize_cert_logon_row,
    "device": normalize_cert_device_row,
    "file": normalize_cert_file_row,
}
_SOURCES = {"logon": "cert_r4.2_logon", "device": "cert_r4.2_device", "file": "cert_r4.2_file"}


def ingest_cert_into_db() -> dict[str, int]:
    """Reads data/processed/cert_{logon,device,file}.csv, normalizes, and
    bulk-inserts into raw_logs. Idempotent per source, same pattern as
    backend.pipeline.ingestion.ingest_into_db.
    """
    counts = {}
    session = SessionLocal()
    try:
        for name, normalizer in _NORMALIZERS.items():
            path = PROCESSED_DIR / f"cert_{name}.csv"
            df = pd.read_csv(path, encoding="utf-8")
            records = [normalizer(row) for row in df.to_dict(orient="records")]

            session.query(RawLog).filter(RawLog.source == _SOURCES[name]).delete()
            session.bulk_insert_mappings(RawLog, records)
            counts[name] = len(records)
        session.commit()
    finally:
        session.close()
    return counts


if __name__ == "__main__":
    build_curated_cert_features()
    counts = ingest_cert_into_db()
    print(f"Ingested CERT rows: {counts} (total {sum(counts.values())})")
