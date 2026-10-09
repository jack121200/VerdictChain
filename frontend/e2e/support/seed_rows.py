"""State helper for the Playwright E2E stack (test tooling only; the application never imports it).

Run from the repo root with the E2E environment (frontend/e2e/support/stack.mjs builds it):

  python frontend/e2e/support/seed_rows.py ensure-db
      create the E2E database when it is missing
  python frontend/e2e/support/seed_rows.py reset [--rows keep|seed|empty] [--drop-users]
      wipe investigations, debate transcripts, credibility log, response actions, feedback, audit trail,
      quarantine, runtime settings and Redis; --rows replaces raw_logs (seed = the synthetic rows below,
      empty = none), --drop-users also deletes every analyst
  python frontend/e2e/support/seed_rows.py seed
      insert the synthetic raw_logs rows (the table must not hold them already)
  python frontend/e2e/support/seed_rows.py seed-live
      insert the logon rows the live feed spec replays (use after reset --rows empty)

Every command refuses to touch anything but the database verdictchain_test_pw and Redis db 7, so it can
never reach the dev database (verdictchain, Redis db 0).
"""

import argparse
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

E2E_DATABASE = "verdictchain_test_pw"
E2E_REDIS_DB = 7

# Everything an investigation writes. CASCADE also clears the tables that point at investigations.
DATA_TABLES = (
    "investigations, debate_transcripts, credibility_log, response_actions, analyst_feedback, audit_trail"
)

# The scenario labels of backend.api.schemas (ScenarioLabel) other than DDoS, with the source they live in.
OTHER_NETWORK_LABELS = ("Portscan", "FTP-Patator", "SSH-Patator", "Botnet")
OTHER_INSIDER_LABELS = ("insider_scenario_1", "insider_scenario_2", "insider_scenario_3")


def _database_url() -> str:
    url = os.environ.get("LOCAL_DATABASE_URL", "")
    from sqlalchemy.engine import make_url

    name = make_url(url).database if url else None
    if name != E2E_DATABASE:
        sys.exit(f"seed_rows: refusing to run against database {name!r}; only {E2E_DATABASE!r} is allowed")
    return url


def _redis_client():
    import redis

    url = os.environ.get("REDIS_URL", "")
    client = redis.Redis.from_url(url) if url else None
    if client is None or client.connection_pool.connection_kwargs.get("db") != E2E_REDIS_DB:
        sys.exit(f"seed_rows: refusing to run against Redis {url!r}; only db {E2E_REDIS_DB} is allowed")
    return client


def ensure_db() -> None:
    """CREATE DATABASE through the maintenance database, so no docker CLI is needed."""
    import psycopg
    from sqlalchemy.engine import make_url

    url = make_url(_database_url())
    with psycopg.connect(
        host=url.host,
        port=url.port,
        user=url.username,
        password=url.password,
        dbname="postgres",
        autocommit=True,
    ) as conn:
        exists = conn.execute("SELECT 1 FROM pg_database WHERE datname = %s", (E2E_DATABASE,)).fetchone()
        if exists is None:
            conn.execute(f'CREATE DATABASE "{E2E_DATABASE}"')  # the name is the constant above
            print(f"seed_rows: created database {E2E_DATABASE}")


def seed() -> None:
    """A DDoS scenario for the network agent plus rows the two CERT agents can cite (the same rows as
    backend/tests/api/test_isolation_flow.py::_seed), and one row for every other scenario label so that
    GET /scenarios names a primary agent for all eight scenarios, like the ingested datasets do."""
    from backend.db.session import SessionLocal
    from backend.scripts import e2e_server as stub

    network = stub.sample_rows("network_traffic")
    for row in network:
        row.ground_truth_label = "DDoS"
    others = stub.sample_rows("access_log") + stub.sample_rows("endpoint_behavior")
    for row in others:
        row.ground_truth_label = "BENIGN"

    extra = []
    for label in OTHER_NETWORK_LABELS:
        (row,) = stub.sample_rows("network_traffic")[:1]
        row.ground_truth_label = label
        extra.append(row)
    for label in OTHER_INSIDER_LABELS:
        (row,) = stub.sample_rows("access_log")[:1]
        row.ground_truth_label = label
        extra.append(row)

    with SessionLocal() as session:
        session.add_all(network + others + extra)
        session.commit()
    print(f"seed_rows: seeded {len(network)} DDoS, {len(others)} BENIGN and {len(extra)} other-label raw_logs rows")


def seed_live() -> None:
    """The dataset of the live feed spec: 300 ordinary logons, 20 of them off-hours so the baseline has a spread,
    100 logons of one scenario that are all off-hours, so the segments the sensor takes from the scenario are
    flagged by the monitor, and a few network and file rows for the other two investigators. The stack runs
    with LIVE_FEED_ATTACK_SHARE=1 (see stack.mjs)."""
    from datetime import datetime, timedelta, timezone

    from backend.db.models import RawLog
    from backend.db.session import SessionLocal
    from backend.scripts import e2e_server as stub

    start = datetime(2010, 3, 1, tzinfo=timezone.utc)

    def logon(index: int, off_hours: bool, label: str) -> RawLog:
        return RawLog(
            timestamp=start + timedelta(minutes=index),
            source="cert_r4.2_logon",
            event_type="logon",
            user_id=f"U{index % 7:03d}",
            host_id=f"PC-{index % 5}",
            raw_fields={"off_hours": off_hours, "logon_count": 1},
            ground_truth_label=label,
        )

    rows = [logon(i, i >= 280, "benign") for i in range(300)]
    rows += [logon(300 + i, True, "insider_scenario_1") for i in range(100)]
    others = stub.sample_rows("network_traffic") + stub.sample_rows("access_log")
    for row in others:
        row.ground_truth_label = "BENIGN"
    rows += others
    with SessionLocal() as session:
        session.add_all(rows)
        session.commit()
    print(f"seed_rows: seeded {len(rows)} rows for the live feed")


def reset(rows: str, drop_users: bool) -> None:
    from sqlalchemy import create_engine, text

    engine = create_engine(_database_url())
    with engine.begin() as conn:
        tables = DATA_TABLES
        if drop_users:
            tables += ", analysts"
        if rows != "keep":
            tables += ", raw_logs"
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        # Back to the migration's initial state: the singleton settings row and the three quarantine rows.
        conn.execute(text("DELETE FROM runtime_settings"))
        conn.execute(text("INSERT INTO runtime_settings (id) VALUES (1)"))
        conn.execute(
            text("UPDATE agent_quarantine SET active = false, reason = NULL, set_by = NULL, updated_at = now()")
        )
    engine.dispose()
    _redis_client().flushdb()  # CrS, debate slot, rate limits, daily caps, ws tickets of this stack only
    print(f"seed_rows: reset (rows={rows}, users={'dropped' if drop_users else 'kept'})")
    if rows == "seed":
        seed()


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("ensure-db")
    sub.add_parser("seed")
    sub.add_parser("seed-live")
    reset_parser = sub.add_parser("reset")
    reset_parser.add_argument("--rows", choices=("keep", "seed", "empty"), default="keep")
    reset_parser.add_argument("--drop-users", action="store_true")
    args = parser.parse_args(argv)

    _database_url()  # the guard runs before anything else
    if args.command == "ensure-db":
        ensure_db()
    elif args.command == "seed":
        seed()
    elif args.command == "seed-live":
        seed_live()
    else:
        reset(args.rows, args.drop_users)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
