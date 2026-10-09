"""Every migration can be undone: upgrade head -> downgrade base -> upgrade head on a scratch database.

The conftest test database is never touched. A throwaway database named verdictchain_test_mig_<hex> is
created on the same Postgres server (AUTOCOMMIT admin connection derived from the test database URL),
migrated with the same `python -m alembic` call that conftest.apply_migrations makes, and always dropped.
"""

import os
import re
import secrets
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.pool import NullPool

from backend.config import settings
from backend.db.models import Base
from backend.tests.fixtures.dbguard import refusal_reason

BACKEND_DIR = Path(__file__).resolve().parents[2]
SCRATCH_NAME = re.compile(r"verdictchain_test_mig_[0-9a-f]{8}")
INSUFFICIENT_PRIVILEGE = "42501"

# Tables, views, sequences and indexes in the public schema (what a downgrade must leave empty).
RELATIONS = text(
    "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
    "WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'i', 'f') ORDER BY c.relname"
)
# What Alembic itself keeps after `downgrade base`: its version table and that table's primary key index.
ALEMBIC_ONLY = {"alembic_version", "alembic_version_pkc"}


def _alembic(url: str, *args: str) -> str:
    """Runs `python -m alembic <args>` from backend/ against `url` and returns its output.

    A migration that fails exits with 1 (a Python exception). Any other non-zero code is the interpreter or
    a native library dying (seen once on Windows, 0xC0000005, while the machine was saturated), which says
    nothing about the migration, so that case is run once more before it counts as a failure."""
    for attempt in (1, 2):
        result = subprocess.run(
            [sys.executable, "-m", "alembic", *args],
            cwd=BACKEND_DIR,
            env={**os.environ, "ENVIRONMENT": "development", "LOCAL_DATABASE_URL": url},
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode in (0, 1) or attempt == 2:
            break
    output = result.stdout + result.stderr
    assert result.returncode == 0, f"alembic {' '.join(args)} failed ({result.returncode}):\n{output}"
    return output


@pytest.fixture()
def scratch_url() -> Iterator[str]:
    """URL of a freshly created, empty database on the test server. Dropped when the test ends."""
    base = make_url(settings.sqlalchemy_url)
    assert refusal_reason(base.render_as_string(hide_password=False)) is None
    name = f"verdictchain_test_mig_{secrets.token_hex(4)}"
    assert SCRATCH_NAME.fullmatch(name)  # generated here, so quoting it into DDL is safe

    admin = create_engine(base, isolation_level="AUTOCOMMIT", poolclass=NullPool)
    quoted = admin.dialect.identifier_preparer.quote(name)
    try:
        try:
            with admin.connect() as conn:
                conn.execute(text(f"CREATE DATABASE {quoted}"))
        except ProgrammingError as exc:
            if getattr(exc.orig, "sqlstate", None) != INSUFFICIENT_PRIVILEGE:
                raise
            pytest.skip("the test database role cannot CREATE DATABASE, so no scratch database")
        yield base.set(database=name).render_as_string(hide_password=False)
    finally:
        with admin.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {quoted} WITH (FORCE)"))
        admin.dispose()


def _snapshot(url: str) -> tuple[set[str], list[str], list[str]]:
    """(table names, public relation names, alembic_version rows) of the database at `url`."""
    engine = create_engine(url, poolclass=NullPool)
    try:
        with engine.connect() as conn:
            relations = [row[0] for row in conn.execute(RELATIONS)]
            versions = [row[0] for row in conn.execute(text("SELECT version_num FROM alembic_version"))]
        return set(inspect(engine).get_table_names()), relations, versions
    finally:
        engine.dispose()


def test_alembic_has_exactly_one_head():
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "db" / "migrations"))
    heads = ScriptDirectory.from_config(config).get_heads()
    assert len(heads) == 1, f"migration history has {len(heads)} heads: {heads}"


def test_upgrade_downgrade_upgrade_round_trip(scratch_url: str):
    config = Config()
    config.set_main_option("script_location", str(BACKEND_DIR / "db" / "migrations"))
    (head,) = ScriptDirectory.from_config(config).get_heads()
    expected = set(Base.metadata.tables)  # the ORM models are the schema the app expects

    _alembic(scratch_url, "upgrade", "head")
    tables, _, versions = _snapshot(scratch_url)
    assert tables == expected | {"alembic_version"}
    assert versions == [head]

    _alembic(scratch_url, "downgrade", "base")
    tables, relations, versions = _snapshot(scratch_url)
    assert tables == {"alembic_version"}, f"tables left after downgrade base: {sorted(tables)}"
    assert set(relations) <= ALEMBIC_ONLY, f"relations left after downgrade base: {relations}"
    assert versions == []

    _alembic(scratch_url, "upgrade", "head")
    tables, _, versions = _snapshot(scratch_url)
    assert tables == expected | {"alembic_version"}
    assert versions == [head]
