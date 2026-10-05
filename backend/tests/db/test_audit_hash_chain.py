from backend.db.audit import compute_entry_hash, verify_chain
from backend.db.models import AuditTrail, Investigation


def _two_chained_entries(db_session, inv_id):
    h1 = compute_entry_hash("watchdog", "credibility_update", {"agent_id": "network_traffic"}, None)
    e1 = AuditTrail(
        investigation_id=inv_id,
        actor="watchdog",
        action="credibility_update",
        detail={"agent_id": "network_traffic"},
        prev_hash=None,
        entry_hash=h1,
    )
    db_session.add(e1)
    db_session.flush()

    h2 = compute_entry_hash("self_healing", "response_action", {"action_type": "block_ip_range"}, h1)
    e2 = AuditTrail(
        investigation_id=inv_id,
        actor="self_healing",
        action="response_action",
        detail={"action_type": "block_ip_range"},
        prev_hash=h1,
        entry_hash=h2,
    )
    db_session.add(e2)
    db_session.commit()
    return e1, e2


def test_hash_chain_valid(db_session):
    inv = Investigation(trigger_type="manual")
    db_session.add(inv)
    db_session.flush()

    _two_chained_entries(db_session, inv.investigation_id)

    entries = db_session.query(AuditTrail).order_by(AuditTrail.seq).all()
    assert verify_chain(entries) is True


def test_hash_chain_detects_tampering(db_session):
    inv = Investigation(trigger_type="manual")
    db_session.add(inv)
    db_session.flush()

    e1, _e2 = _two_chained_entries(db_session, inv.investigation_id)

    # Simulate an attacker editing history after the fact.
    e1.detail = {"agent_id": "endpoint_behavior"}
    db_session.commit()

    entries = db_session.query(AuditTrail).order_by(AuditTrail.seq).all()
    assert verify_chain(entries) is False
