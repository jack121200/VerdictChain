"""Audit-chain ordering and concurrency (plan section 3.2, migration 0003).

The chain is ordered by seq, not created_at: entries written in one transaction share a
created_at, and two writers could read the same tail (a fork). These tests fail on the
pre-fix implementation: (a) because the tail is not flushed before it is read, (b) because
concurrent writers fork the chain.
"""

import threading
import uuid

from backend.db.audit import append_entry, verify_chain
from backend.db.models import AuditTrail
from backend.db.session import SessionLocal


def _ordered(session) -> list[AuditTrail]:
    return session.query(AuditTrail).order_by(AuditTrail.seq).all()


def test_three_entries_in_one_transaction_form_a_valid_chain(db_session):
    for action in ("lock_account", "block_ip_range", "trigger_audit"):
        append_entry(db_session, actor="self_healing", action=action, detail={"target": "u1"})
    db_session.commit()

    entries = _ordered(db_session)
    seqs = [e.seq for e in entries]
    assert len(entries) == 3
    assert seqs == sorted(set(seqs))  # strictly ascending and unique
    assert verify_chain(entries) is True


def test_concurrent_writers_produce_one_linear_chain(db_session):
    barrier = threading.Barrier(2)
    errors: list[BaseException] = []

    def writer(actor: str) -> None:
        try:
            barrier.wait()
            for i in range(20):
                session = SessionLocal()
                try:
                    append_entry(session, actor=actor, action="round_completed", detail={"i": i})
                    session.commit()
                finally:
                    session.close()
        except BaseException as exc:  # noqa: BLE001 - reported by the assertion below
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(name,)) for name in ("network_traffic", "access_log")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=120)

    assert not errors
    assert not any(thread.is_alive() for thread in threads)
    entries = _ordered(db_session)
    assert len(entries) == 40
    predecessors = [e.prev_hash for e in entries[1:]]
    assert len(set(predecessors)) == len(predecessors)  # no two entries share a predecessor
    assert verify_chain(entries) is True


def test_find_first_break_reports_the_tampered_index(db_session):
    from backend.db.audit import find_first_break

    for i in range(4):
        append_entry(db_session, actor="self_healing", action="trigger_audit", detail={"n": i})
    db_session.commit()
    assert find_first_break(_ordered(db_session)) is None

    _ordered(db_session)[2].detail = {"n": 999}  # an attacker edits history in place
    db_session.commit()

    entries = _ordered(db_session)
    assert find_first_break(entries) == (2, "hash_mismatch")
    assert verify_chain(entries) is False


def test_float_and_uuid_detail_round_trip_through_jsonb_and_still_verify(db_session):
    row_id = uuid.uuid4()
    append_entry(
        db_session,
        actor="watchdog",
        action="credibility_update",
        detail={"crs": 0.1234567891, "row_id": row_id, "rate": {"value": 1 / 3}},
    )
    append_entry(db_session, actor="watchdog", action="credibility_update", detail={"crs": 0.5})
    db_session.commit()
    db_session.expire_all()

    entries = _ordered(db_session)
    assert entries[0].detail == {"crs": 0.123457, "row_id": str(row_id), "rate": {"value": 0.333333}}
    assert verify_chain(entries) is True
