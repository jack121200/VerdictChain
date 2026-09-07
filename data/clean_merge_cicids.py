"""
CICIDS2017 - Merge + Column-Filter + Clean  (schema-aware)

Handles the fact that the source CSVs use CICFlowMeter-v4 / CICIDS2017-improved
column names while the target schema below uses original CICIDS2017 names.
Every canonical column carries a list of accepted source aliases; matching is
whitespace/underscore/case insensitive.

Fully streaming: chunked read, chunked write, chunked de-duplication via a
64-bit row-hash set. The merged file is never loaded into RAM.
"""

import os
import glob
import zipfile
import numpy as np
import pandas as pd

INPUT_FOLDER = "./data/raw_data"
OUTPUT_FILE = "./data/verdictchain_network_dataset.csv"
CHUNK_SIZE = 200_000
EXCLUDE_FILES = {"02-14-2018.csv"}      # CSE-CIC-IDS2018: different schema/dataset

# canonical name -> accepted source aliases
SCHEMA = {
    "Destination Port": ["Destination Port", "Dst Port"],
    "Flow Duration": ["Flow Duration"],
    "Total Fwd Packets": ["Total Fwd Packets", "Total Fwd Packet", "Tot Fwd Pkts"],
    "Total Backward Packets": ["Total Backward Packets", "Total Bwd Packets", "Tot Bwd Pkts"],
    "Total Length of Fwd Packets": ["Total Length of Fwd Packets", "Total Length of Fwd Packet", "TotLen Fwd Pkts"],
    "Total Length of Bwd Packets": ["Total Length of Bwd Packets", "Total Length of Bwd Packet", "TotLen Bwd Pkts"],
    "Flow Bytes/s": ["Flow Bytes/s", "Flow Byts/s"],
    "Flow Packets/s": ["Flow Packets/s", "Flow Pkts/s"],
    "Fwd Packets/s": ["Fwd Packets/s", "Fwd Pkts/s"],
    "Bwd Packets/s": ["Bwd Packets/s", "Bwd Pkts/s"],
    "Fwd Packet Length Max": ["Fwd Packet Length Max", "Fwd Pkt Len Max"],
    "Fwd Packet Length Min": ["Fwd Packet Length Min", "Fwd Pkt Len Min"],
    "Fwd Packet Length Mean": ["Fwd Packet Length Mean", "Fwd Pkt Len Mean"],
    "Fwd Packet Length Std": ["Fwd Packet Length Std", "Fwd Pkt Len Std"],
    "Bwd Packet Length Max": ["Bwd Packet Length Max", "Bwd Pkt Len Max"],
    "Bwd Packet Length Min": ["Bwd Packet Length Min", "Bwd Pkt Len Min"],
    "Bwd Packet Length Mean": ["Bwd Packet Length Mean", "Bwd Pkt Len Mean"],
    "Bwd Packet Length Std": ["Bwd Packet Length Std", "Bwd Pkt Len Std"],
    "Min Packet Length": ["Min Packet Length", "Packet Length Min", "Pkt Len Min"],
    "Max Packet Length": ["Max Packet Length", "Packet Length Max", "Pkt Len Max"],
    "Packet Length Mean": ["Packet Length Mean", "Pkt Len Mean"],
    "Packet Length Std": ["Packet Length Std", "Pkt Len Std"],
    "Average Packet Size": ["Average Packet Size", "Pkt Size Avg"],
    "Avg Fwd Segment Size": ["Avg Fwd Segment Size", "Fwd Segment Size Avg", "Fwd Seg Size Avg"],
    "Avg Bwd Segment Size": ["Avg Bwd Segment Size", "Bwd Segment Size Avg", "Bwd Seg Size Avg"],
    "Flow IAT Mean": ["Flow IAT Mean"],
    "Flow IAT Std": ["Flow IAT Std"],
    "Flow IAT Max": ["Flow IAT Max"],
    "Flow IAT Min": ["Flow IAT Min"],
    "Fwd IAT Total": ["Fwd IAT Total", "Fwd IAT Tot"],
    "Fwd IAT Mean": ["Fwd IAT Mean"],
    "Fwd IAT Std": ["Fwd IAT Std"],
    "Fwd IAT Max": ["Fwd IAT Max"],
    "Fwd IAT Min": ["Fwd IAT Min"],
    "Bwd IAT Total": ["Bwd IAT Total", "Bwd IAT Tot"],
    "Bwd IAT Mean": ["Bwd IAT Mean"],
    "Bwd IAT Std": ["Bwd IAT Std"],
    "Bwd IAT Max": ["Bwd IAT Max"],
    "Bwd IAT Min": ["Bwd IAT Min"],
    "Fwd PSH Flags": ["Fwd PSH Flags"],
    "FIN Flag Count": ["FIN Flag Count", "FIN Flag Cnt"],
    "SYN Flag Count": ["SYN Flag Count", "SYN Flag Cnt"],
    "RST Flag Count": ["RST Flag Count", "RST Flag Cnt"],
    "PSH Flag Count": ["PSH Flag Count", "PSH Flag Cnt"],
    "ACK Flag Count": ["ACK Flag Count", "ACK Flag Cnt"],
    "URG Flag Count": ["URG Flag Count", "URG Flag Cnt"],
    "ECE Flag Count": ["ECE Flag Count", "ECE Flag Cnt"],
    "Down/Up Ratio": ["Down/Up Ratio"],
    "Fwd Header Length": ["Fwd Header Length", "Fwd Header Len"],
    "Bwd Header Length": ["Bwd Header Length", "Bwd Header Len"],
    "Subflow Fwd Packets": ["Subflow Fwd Packets", "Subflow Fwd Pkts"],
    "Subflow Fwd Bytes": ["Subflow Fwd Bytes", "Subflow Fwd Byts"],
    "Subflow Bwd Packets": ["Subflow Bwd Packets", "Subflow Bwd Pkts"],
    "Subflow Bwd Bytes": ["Subflow Bwd Bytes", "Subflow Bwd Byts"],
    "Init_Win_bytes_forward": ["Init_Win_bytes_forward", "FWD Init Win Bytes", "Init Fwd Win Byts"],
    "Init_Win_bytes_backward": ["Init_Win_bytes_backward", "Bwd Init Win Bytes", "Init Bwd Win Byts"],
    "act_data_pkt_fwd": ["act_data_pkt_fwd", "Fwd Act Data Pkts", "Fwd Act Data Pkt"],
    "min_seg_size_forward": ["min_seg_size_forward", "Fwd Seg Size Min"],
    "Active Mean": ["Active Mean"],
    "Active Std": ["Active Std"],
    "Active Max": ["Active Max"],
    "Active Min": ["Active Min"],
    "Idle Mean": ["Idle Mean"],
    "Idle Std": ["Idle Std"],
    "Idle Max": ["Idle Max"],
    "Idle Min": ["Idle Min"],
    "Label": ["Label"],
}
CANONICAL = list(SCHEMA)
NUMERIC = [c for c in CANONICAL if c != "Label"]


def norm(name):
    """Whitespace/underscore/case-insensitive key for column matching."""
    return " ".join(str(name).replace("_", " ").split()).lower()


ALIAS_LOOKUP = {norm(a): canon for canon, aliases in SCHEMA.items() for a in aliases}


def extract_zips(folder):
    zips = glob.glob(os.path.join(folder, "*.zip"))
    for z in zips:
        print("Extracting {} ...".format(z))
        with zipfile.ZipFile(z, "r") as zf:
            zf.extractall(folder)
    if zips:
        print("Extracted {} zip file(s).\n".format(len(zips)))


def resolve_columns(csv_path):
    """Map this file header onto the canonical schema -> (source_cols, canon_cols, missing)."""
    header = pd.read_csv(csv_path, nrows=0, encoding="latin1")
    source_by_canon = {}
    for col in header.columns:
        canon = ALIAS_LOOKUP.get(norm(col))
        if canon and canon not in source_by_canon:
            source_by_canon[canon] = col
    missing = [c for c in CANONICAL if c not in source_by_canon]
    source_cols = [source_by_canon[c] for c in CANONICAL if c in source_by_canon]
    canon_cols = [c for c in CANONICAL if c in source_by_canon]
    return source_cols, canon_cols, missing


def clean_chunk(df):
    df["Label"] = df["Label"].astype(str).str.strip()
    for c in NUMERIC:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df[NUMERIC] = df[NUMERIC].replace([np.inf, -np.inf], np.nan)
    return df.dropna(subset=NUMERIC)


def main():
    if not os.path.isdir(INPUT_FOLDER):
        raise SystemExit("Input folder not found: {}".format(INPUT_FOLDER))
    extract_zips(INPUT_FOLDER)

    csv_files = sorted(
        f for f in glob.glob(os.path.join(INPUT_FOLDER, "**", "*.csv"), recursive=True)
        if os.path.basename(f) not in EXCLUDE_FILES
    )
    if not csv_files:
        raise SystemExit("No CSV files found inside {}".format(INPUT_FOLDER))

    print("Processing {} file(s); excluding {}\n".format(len(csv_files), sorted(EXCLUDE_FILES)))

    # Validate every file against the schema BEFORE writing anything, so a
    # mismatch can never be appended under a wrong header.
    plans = {}
    for path in csv_files:
        source_cols, canon_cols, missing = resolve_columns(path)
        if missing:
            raise SystemExit(
                "Schema mismatch in {}: {} canonical column(s) unmatched -> {}\n"
                "Add the correct alias to SCHEMA and re-run. Nothing was written.".format(
                    os.path.basename(path), len(missing), missing)
            )
        plans[path] = (source_cols, canon_cols)
    print("Schema check passed: all files map to all {} canonical columns.\n".format(len(CANONICAL)))

    if os.path.exists(OUTPUT_FILE):
        os.remove(OUTPUT_FILE)

    header_written = False
    seen_hashes = set()
    total_in = total_clean = total_out = 0
    label_counts = {}

    for path in csv_files:
        source_cols, canon_cols = plans[path]
        rename_map = dict(zip(source_cols, canon_cols))
        print("Processing: {}".format(os.path.basename(path)))
        f_in = f_clean = f_out = 0

        # NOTE: no low_memory=False here - it makes the C parser buffer the whole
        # file for dtype inference, which defeats chunksize and OOMs on the larger
        # files. Dtypes are coerced explicitly in clean_chunk() instead.
        reader = pd.read_csv(path, usecols=source_cols, chunksize=CHUNK_SIZE,
                             encoding="latin1")
        for chunk in reader:
            f_in += len(chunk)
            chunk = chunk.rename(columns=rename_map)[CANONICAL]
            chunk = clean_chunk(chunk)
            f_clean += len(chunk)
            if chunk.empty:
                continue

            # streaming de-duplication across the whole merged dataset
            h = pd.util.hash_pandas_object(chunk, index=False).to_numpy()
            keep = np.fromiter((x not in seen_hashes for x in h), dtype=bool, count=len(h))
            seen_hashes.update(h[keep].tolist())
            chunk = chunk[keep]
            f_out += len(chunk)
            if chunk.empty:
                continue

            for lbl, n in chunk["Label"].value_counts().items():
                label_counts[lbl] = label_counts.get(lbl, 0) + int(n)

            chunk.to_csv(OUTPUT_FILE, mode="a", header=not header_written, index=False)
            header_written = True

        print("  read {:,} -> cleaned {:,} -> written {:,} (dropped {:,} bad, {:,} duplicate)\n".format(
            f_in, f_clean, f_out, f_in - f_clean, f_clean - f_out))
        total_in += f_in
        total_clean += f_clean
        total_out += f_out

    print("================ DONE ================")
    print("Total rows read      : {:,}".format(total_in))
    print("After cleaning       : {:,} (dropped {:,})".format(total_clean, total_in - total_clean))
    print("After de-duplication : {:,} (dropped {:,})".format(total_out, total_clean - total_out))
    print("Columns              : {}".format(len(CANONICAL)))
    print("Label distribution:")
    for lbl, n in sorted(label_counts.items(), key=lambda kv: -kv[1]):
        print("  {:<28} {:>10,}  ({:6.2%})".format(lbl, n, n / max(total_out, 1)))
    print("Output               : {}".format(OUTPUT_FILE))


if __name__ == "__main__":
    main()
