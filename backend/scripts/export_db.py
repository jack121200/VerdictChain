"""Logical export of the database as JSON lines (SD9).

Run from the repo root:  python -m backend.scripts.export_db --out <dir> [--include-raw-logs]

Writes one `<table>.jsonl` per table (one JSON object per row, every column) and a `manifest.json` last, so a
directory without a manifest is an unfinished export. `analysts.jsonl` has no `password_hash`.
`raw_logs.jsonl` is written only with --include-raw-logs: it is the large table and can be rebuilt from the
datasets. The manifest holds the row counts, the creation time, the audit chain head (seq and entry_hash)
and whether the exported audit chain verifies with backend.db.audit.verify_chain.

All tables are read in one read-only REPEATABLE READ transaction, so the files describe one moment. Rows are
streamed in batches. The script reads with the ORM only and refuses to write into a non-empty directory.
"""

import argparse
import json
import sys
import uuid
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.db.audit import verify_chain
from backend.db.models import (
    AgentQuarantine,
    Analyst,
    AnalystFeedback,
    AuditTrail,
    CredibilityLog,
    DebateTranscript,
    Investigation,
    ModelVersion,
    RawLog,
    ResponseAction,
    RuntimeSettings,
)
from backend.db.session import SessionLocal

BATCH_SIZE = 1000
FORMAT = "jsonl"

# table name -> (model, ORDER BY). Rows are ordered by a stable key so two exports of one state are identical.
TABLES: dict[str, tuple[type, tuple[Any, ...]]] = {
    "investigations": (Investigation, (Investigation.created_at, Investigation.investigation_id)),
    "debate_transcripts": (DebateTranscript, (DebateTranscript.created_at, DebateTranscript.id)),
    "credibility_log": (CredibilityLog, (CredibilityLog.created_at, CredibilityLog.id)),
    "response_actions": (ResponseAction, (ResponseAction.created_at, ResponseAction.id)),
    "audit_trail": (AuditTrail, (AuditTrail.seq,)),  # chain order
    "analyst_feedback": (AnalystFeedback, (AnalystFeedback.created_at, AnalystFeedback.id)),
    "agent_quarantine": (AgentQuarantine, (AgentQuarantine.agent_id,)),
    "runtime_settings": (RuntimeSettings, (RuntimeSettings.id,)),
    "model_versions": (ModelVersion, (ModelVersion.trained_at, ModelVersion.version_id)),
    "analysts": (Analyst, (Analyst.created_at, Analyst.username)),
}
RAW_LOGS_TABLE = {"raw_logs": (RawLog, (RawLog.timestamp, RawLog.row_id))}
EXCLUDED_COLUMNS: dict[str, tuple[str, ...]] = {"analysts": ("password_hash",)}


class ExportError(RuntimeError):
    """The export was refused before any file was written."""


class _ChainRow(NamedTuple):
    actor: str
    action: str
    detail: dict[str, Any] | None
    prev_hash: str | None
    entry_hash: str
    seq: int


def _json_default(value: Any) -> str:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    raise TypeError(f"cannot export a {type(value).__name__}")


def _prepare_out_dir(out: Path) -> None:
    if out.exists():
        if not out.is_dir():
            raise ExportError(f"{out} exists and is not a directory")
        if any(out.iterdir()):
            raise ExportError(f"{out} is not empty; refusing to overwrite it")
    else:
        out.mkdir(parents=True)


def _export_table(
    session: Session, name: str, model: type, order_by: tuple[Any, ...], out: Path
) -> tuple[int, list[_ChainRow]]:
    """Streams one table to `<name>.jsonl`. Returns the row count and, for audit_trail, the chain rows."""
    table = model.__table__
    columns = [column for column in table.c if column.name not in EXCLUDED_COLUMNS.get(name, ())]
    query = select(*columns).order_by(*order_by).execution_options(yield_per=BATCH_SIZE)
    chain: list[_ChainRow] = []
    count = 0
    with (out / f"{name}.{FORMAT}").open("w", encoding="utf-8", newline="\n") as handle:
        for row in session.execute(query).mappings():
            record = dict(row)
            handle.write(
                json.dumps(record, default=_json_default, ensure_ascii=False, allow_nan=False, sort_keys=True)
            )
            handle.write("\n")
            count += 1
            if name == "audit_trail":
                chain.append(
                    _ChainRow(
                        record["actor"],
                        record["action"],
                        record["detail"],
                        record["prev_hash"],
                        record["entry_hash"],
                        record["seq"],
                    )
                )
    return count, chain


def export_database(
    out: Path, *, include_raw_logs: bool = False, session_factory: Any = SessionLocal
) -> dict[str, Any]:
    """Writes the export into `out` and returns the manifest. Raises ExportError for an unusable `out`."""
    _prepare_out_dir(out)
    tables = TABLES | RAW_LOGS_TABLE if include_raw_logs else TABLES

    counts: dict[str, int] = {}
    chain: list[_ChainRow] = []
    with session_factory() as session:
        session.connection(
            execution_options={"isolation_level": "REPEATABLE READ", "postgresql_readonly": True}
        )
        for name, (model, order_by) in tables.items():
            counts[name], rows = _export_table(session, name, model, order_by, out)
            chain.extend(rows)

    manifest = {
        "format": FORMAT,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "include_raw_logs": include_raw_logs,
        "tables": {name: {"file": f"{name}.{FORMAT}", "rows": count} for name, count in counts.items()},
        "excluded_columns": {name: list(columns) for name, columns in EXCLUDED_COLUMNS.items()},
        "audit": {
            "entries": len(chain),
            "head_seq": chain[-1].seq if chain else None,
            "head_entry_hash": chain[-1].entry_hash if chain else None,
            "chain_valid": verify_chain(chain),
        },
    }
    (out / "manifest.json").write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8", newline="\n"
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Logical JSON-lines export of the VerdictChain database.")
    parser.add_argument("--out", required=True, type=Path, help="directory to write into (new or empty)")
    parser.add_argument(
        "--include-raw-logs", action="store_true", help="also export raw_logs (large; rebuildable)"
    )
    args = parser.parse_args(argv)
    try:
        manifest = export_database(args.out, include_raw_logs=args.include_raw_logs)
    except ExportError as exc:
        print(f"export refused: {exc}", file=sys.stderr)
        return 2
    for name, info in manifest["tables"].items():
        print(f"{name}: {info['rows']} rows")
    audit = manifest["audit"]
    print(
        f"audit chain: {'valid' if audit['chain_valid'] else 'BROKEN'}, "
        f"{audit['entries']} entries, head seq {audit['head_seq']}"
    )
    print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
