"""Real-API proof for the two CERT-branch agents, same purpose as
smoke_test_agent_live.py: manual, deliberately outside pytest.

Run: python -m backend.scripts.smoke_test_cert_agents_live
"""

from sqlalchemy import select

from backend.agents import access_log, endpoint_behavior
from backend.db.models import RawLog
from backend.db.session import SessionLocal


def _rows(source: str, limit: int = 3) -> list[RawLog]:
    session = SessionLocal()
    try:
        rows = session.execute(select(RawLog).where(RawLog.source == source).limit(limit)).scalars().all()
        for r in rows:
            session.refresh(r)
        return rows
    finally:
        session.close()


def main() -> None:
    file_rows = _rows("cert_r4.2_file", limit=3)
    print(f"Access-Log Agent: {len(file_rows)} rows")
    response, provider = access_log.investigate(file_rows, round_no=1)
    print(f"  served by {provider}: theory={response.theory!r} confidence={response.confidence}")
    print(f"  cited: {[e.row_id for e in response.cited_evidence]}")

    logon_rows = _rows("cert_r4.2_logon", limit=2)
    device_rows = _rows("cert_r4.2_device", limit=2)
    mixed_rows = logon_rows + device_rows
    print(f"\nEndpoint-Behavior Agent: {len(mixed_rows)} rows (logon+device)")
    response, provider = endpoint_behavior.investigate(mixed_rows, round_no=1)
    print(f"  served by {provider}: theory={response.theory!r} confidence={response.confidence}")
    print(f"  cited: {[e.row_id for e in response.cited_evidence]}")


if __name__ == "__main__":
    main()
