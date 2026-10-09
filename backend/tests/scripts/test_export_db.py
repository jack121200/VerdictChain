"""Logical export (SD9, backend/scripts/export_db.py), run against the test database."""

import inspect
import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import func, select, text

from backend.config import settings
from backend.scripts import export_db
from backend.scripts.export_db import ExportError, export_database
from backend.tests.fixtures.auth import make_analyst
from backend.tests.fixtures.read_seed import (
    add_action,
    add_credibility,
    add_feedback,
    add_investigation,
    add_raw,
    add_transcript,
    audit,
    cite,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
EVERY_TABLE = {
    "investigations",
    "debate_transcripts",
    "credibility_log",
    "response_actions",
    "audit_trail",
    "analyst_feedback",
    "agent_quarantine",
    "runtime_settings",
    "model_versions",
    "analysts",
}


@pytest.fixture()
def seeded(db_session):
    row = add_raw(db_session, raw_fields={"Destination Port": 80}, label="DDoS")
    for port in (81, 82):
        add_raw(db_session, raw_fields={"Destination Port": port})
    inv = add_investigation(db_session, scenario_label="DDoS")
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="network_traffic",
        theory="SUPPORT: flood",
        cited=[cite(row, "Destination Port", "80")],
    )
    add_credibility(
        db_session,
        inv.investigation_id,
        agent_id="network_traffic",
        round_no=1,
        before=0.5,
        after=0.6,
        rate=1.0,
    )
    add_action(db_session, inv.investigation_id)
    add_feedback(db_session, inv.investigation_id, True)
    for n in range(4):
        audit(
            db_session, "watchdog", "credibility_update", {"n": n, "score": 0.1234567}, inv.investigation_id
        )
    db_session.commit()
    make_analyst("forensic_analyst", username="export_target")
    return inv


def _lines(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _count(db_session, table: str) -> int:
    model = export_db.TABLES[table][0]
    return db_session.execute(select(func.count()).select_from(model)).scalar_one()


def test_writes_one_file_per_table_and_a_manifest_with_the_real_counts(db_session, seeded, tmp_path):
    manifest = export_database(tmp_path / "out")

    out = tmp_path / "out"
    assert {p.stem for p in out.glob("*.jsonl")} == EVERY_TABLE
    assert json.loads((out / "manifest.json").read_text(encoding="utf-8")) == manifest
    assert set(manifest["tables"]) == EVERY_TABLE
    for table in EVERY_TABLE:
        rows = _lines(out / f"{table}.jsonl")
        assert manifest["tables"][table] == {"file": f"{table}.jsonl", "rows": len(rows)}
        assert len(rows) == _count(db_session, table), table
    assert manifest["tables"]["audit_trail"]["rows"] == 4 and manifest["tables"]["analysts"]["rows"] == 1
    assert manifest["include_raw_logs"] is False and "created_at" in manifest


def test_raw_logs_are_exported_only_with_the_flag(db_session, seeded, tmp_path):
    without = export_database(tmp_path / "plain")
    with_logs = export_database(tmp_path / "full", include_raw_logs=True)

    assert not (tmp_path / "plain" / "raw_logs.jsonl").exists() and "raw_logs" not in without["tables"]
    rows = _lines(tmp_path / "full" / "raw_logs.jsonl")
    assert with_logs["tables"]["raw_logs"]["rows"] == len(rows) == 3
    assert with_logs["include_raw_logs"] is True
    assert {r["raw_fields"]["Destination Port"] for r in rows} == {80, 81, 82}


def test_analysts_are_exported_without_password_hashes(db_session, seeded, tmp_path):
    out = tmp_path / "out"
    manifest = export_database(out, include_raw_logs=True)

    (analyst,) = _lines(out / "analysts.jsonl")
    assert set(analyst) == {"analyst_id", "username", "role", "created_at"}
    assert analyst["username"] == "export_target"
    assert manifest["excluded_columns"] == {"analysts": ["password_hash"]}
    for path in out.iterdir():
        assert "$2b$" not in path.read_text(encoding="utf-8"), path.name  # no bcrypt hash anywhere


def test_the_manifest_carries_the_audit_head_and_a_chain_flag(db_session, seeded, tmp_path):
    out = tmp_path / "out"

    manifest = export_database(out)

    entries = _lines(out / "audit_trail.jsonl")
    assert [e["seq"] for e in entries] == sorted(e["seq"] for e in entries)
    assert manifest["audit"] == {
        "entries": 4,
        "head_seq": entries[-1]["seq"],
        "head_entry_hash": entries[-1]["entry_hash"],
        "chain_valid": True,
    }


def test_a_tampered_chain_is_exported_and_flagged_not_hidden(db_session, seeded, tmp_path):
    db_session.execute(text("UPDATE audit_trail SET detail = CAST('{\"x\": 1}' AS jsonb) WHERE seq = 2"))
    db_session.commit()

    manifest = export_database(tmp_path / "out")

    assert manifest["audit"]["chain_valid"] is False
    assert manifest["tables"]["audit_trail"]["rows"] == 4


def test_values_round_trip_as_json(db_session, seeded, tmp_path):
    out = tmp_path / "out"
    export_database(out)

    (investigation,) = _lines(out / "investigations.jsonl")
    (transcript,) = _lines(out / "debate_transcripts.jsonl")
    assert investigation["investigation_id"] == str(seeded.investigation_id)
    assert investigation["scenario_label"] == "DDoS"  # an operator export keeps the hidden label
    assert datetime.fromisoformat(investigation["created_at"]).utcoffset() is not None  # a timezone is kept
    assert transcript["cited_evidence"][0]["field"] == "Destination Port"
    assert _lines(out / "audit_trail.jsonl")[0]["detail"]["score"] == 0.123457  # canonical form, as stored


def test_rows_are_streamed_in_batches(db_session, seeded, tmp_path, monkeypatch):
    monkeypatch.setattr(export_db, "BATCH_SIZE", 2)

    manifest = export_database(tmp_path / "out", include_raw_logs=True)

    assert manifest["tables"]["raw_logs"]["rows"] == 3 and manifest["tables"]["audit_trail"]["rows"] == 4


def test_a_non_empty_output_directory_is_refused_and_left_alone(db_session, seeded, tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "keep.txt").write_text("precious", encoding="utf-8")

    with pytest.raises(ExportError, match="not empty"):
        export_database(out)

    assert sorted(p.name for p in out.iterdir()) == ["keep.txt"]
    assert (out / "keep.txt").read_text(encoding="utf-8") == "precious"


def test_an_existing_empty_directory_and_a_new_nested_one_are_fine(db_session, seeded, tmp_path):
    (tmp_path / "empty").mkdir()

    export_database(tmp_path / "empty")
    export_database(tmp_path / "a" / "b" / "new")

    assert (tmp_path / "empty" / "manifest.json").exists() and (
        tmp_path / "a" / "b" / "new" / "manifest.json"
    ).exists()


def test_an_output_path_that_is_a_file_is_refused(db_session, tmp_path):
    target = tmp_path / "file.txt"
    target.write_text("x", encoding="utf-8")

    with pytest.raises(ExportError, match="not a directory"):
        export_database(target)


def test_an_empty_database_exports_empty_files(db_session, tmp_path):
    manifest = export_database(tmp_path / "out")

    assert manifest["tables"]["investigations"]["rows"] == 0
    assert manifest["audit"] == {"entries": 0, "head_seq": None, "head_entry_hash": None, "chain_valid": True}


def test_the_script_uses_the_orm_and_no_raw_sql():
    source = inspect.getsource(export_db)

    assert not re.search(r"\btext\(|execute\(f?[\"']", source)


def test_cli_exports_then_refuses_a_second_run_into_the_same_directory(db_session, seeded, tmp_path):
    assert "test" in settings.sqlalchemy_url.lower(), "refusing to run the CLI against a non-test database"
    env = {**os.environ, "ENVIRONMENT": "development", "LOCAL_DATABASE_URL": settings.local_database_url}
    out = tmp_path / "cli_out"

    def run() -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-m", "backend.scripts.export_db", "--out", str(out), "--include-raw-logs"],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )

    first, second = run(), run()

    assert first.returncode == 0, first.stderr
    assert "audit_trail: 4 rows" in first.stdout and "audit chain: valid" in first.stdout
    assert second.returncode == 2 and "not empty" in second.stderr
    assert settings.local_database_url not in first.stdout + first.stderr + second.stdout + second.stderr
