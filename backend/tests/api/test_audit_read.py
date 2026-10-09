"""Audit-trail reads and verification (plan section 3.2 and 3.4): hash_input recomputes entry_hash, the chain
summary covers the whole log, filters and paging, and POST /audit-trail/verify (10 per minute, not audited).

Tampering is simulated by INSERTing a forged row with a wrong entry_hash. No UPDATE is issued against
audit_trail (SKILL-security.md Section 5).
"""

import hashlib
import uuid

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.db.audit import compute_entry_hash
from backend.db.models import AuditTrail
from backend.tests.fixtures.read_seed import add_investigation, audit, bearer_for

client = TestClient(app)


def _seed_chain(db_session):
    inv = add_investigation(db_session, status="verdict_reached")
    audit(
        db_session,
        "watchdog",
        "credibility_update",
        {"agent_id": "network_traffic", "crs": 0.5},
        inv.investigation_id,
    )
    audit(
        db_session,
        "self_healing",
        "lock_account",
        {"target": "U7", "score": 0.1234567891},
        inv.investigation_id,
    )
    audit(db_session, "analyst", "analyst_feedback", {"verdict_was_correct": True})
    db_session.commit()
    return inv


def test_entries_carry_a_hash_input_that_recomputes_entry_hash(db_session):
    _seed_chain(db_session)

    body = client.get("/audit-trail", headers=bearer_for("forensic_analyst")).json()

    assert len(body["entries"]) == 3
    for entry in body["entries"]:
        assert set(entry) >= {
            "seq",
            "prev_hash",
            "entry_hash",
            "hash_input",
            "actor",
            "action",
            "detail",
            "investigation_id",
            "created_at",
        }
        assert hashlib.sha256(entry["hash_input"].encode("utf-8")).hexdigest() == entry["entry_hash"]


def test_entries_are_newest_first_and_chain_summary_is_whole_log(db_session):
    _seed_chain(db_session)

    body = client.get("/audit-trail?limit=2", headers=bearer_for("forensic_analyst")).json()

    seqs = [e["seq"] for e in body["entries"]]
    assert seqs == sorted(seqs, reverse=True)
    assert len(seqs) == 2
    assert body["chain"] == {"valid": True, "head_seq": seqs[0], "total": 3}
    assert body["chain_valid"] is True


def test_before_seq_pages_backwards(db_session):
    _seed_chain(db_session)
    headers = bearer_for("forensic_analyst")

    first = client.get("/audit-trail?limit=2", headers=headers).json()["entries"]
    older = client.get(f"/audit-trail?limit=2&before_seq={first[-1]['seq']}", headers=headers).json()[
        "entries"
    ]

    assert [e["seq"] for e in older] == [first[-1]["seq"] - 1]


def test_filters_by_action_actor_and_investigation(db_session):
    inv = _seed_chain(db_session)
    headers = bearer_for("forensic_analyst")

    by_action = client.get("/audit-trail?action=lock_account", headers=headers).json()["entries"]
    by_actor = client.get("/audit-trail?actor=analyst", headers=headers).json()["entries"]
    by_inv = client.get(f"/audit-trail?investigation_id={inv.investigation_id}", headers=headers).json()[
        "entries"
    ]

    assert [e["action"] for e in by_action] == ["lock_account"]
    assert [e["actor"] for e in by_actor] == ["analyst"]
    assert {e["investigation_id"] for e in by_inv} == {str(inv.investigation_id)}


def test_validation_of_limit_and_action(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.get("/audit-trail?limit=0", headers=headers).status_code == 422
    assert client.get("/audit-trail?limit=501", headers=headers).status_code == 422
    assert client.get("/audit-trail?action=not_a_real_action", headers=headers).status_code == 422


def test_empty_chain_is_valid_with_no_head(db_session):
    body = client.get("/audit-trail", headers=bearer_for("forensic_analyst")).json()

    assert body["entries"] == []
    assert body["chain"] == {"valid": True, "head_seq": None, "total": 0}


def test_verify_reports_a_valid_chain_and_is_not_audited(db_session):
    _seed_chain(db_session)
    headers = bearer_for("forensic_analyst")
    total_before = len(client.get("/audit-trail?limit=500", headers=headers).json()["entries"])
    head_hash = client.get("/audit-trail?limit=1", headers=headers).json()["entries"][0]["entry_hash"]

    resp = client.post("/audit-trail/verify", headers=headers)

    assert resp.status_code == 200
    assert resp.json() == {
        "chain_valid": True,
        "entries_checked": 3,
        "first_break_seq": None,
        "reason": "ok",
        "head_hash": head_hash,
        "mode": "full",  # no checkpoint existed yet, so the whole chain was walked
        "verified_from_seq": 1,
    }
    assert len(client.get("/audit-trail?limit=500", headers=headers).json()["entries"]) == total_before


def test_verify_detects_a_forged_entry(db_session):
    """A forged row with a wrong entry_hash is caught and located, and the chain summary reports it."""
    _seed_chain(db_session)
    last = db_session.query(AuditTrail).order_by(AuditTrail.seq.desc()).first()
    forged_hash = compute_entry_hash("intruder", "lock_account", {"target": "U1"}, last.entry_hash)
    db_session.add(
        AuditTrail(
            investigation_id=None,
            actor="intruder",
            action="lock_account",
            detail={"target": "U1"},
            prev_hash=last.entry_hash,
            entry_hash=forged_hash[::-1],
        )
    )
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    body = client.post("/audit-trail/verify", headers=headers).json()
    summary = client.get("/audit-trail?limit=1", headers=headers).json()

    assert body["chain_valid"] is False
    assert body["reason"] == "hash_mismatch"
    assert body["first_break_seq"] == last.seq + 1
    assert body["entries_checked"] == 4
    assert summary["chain"]["valid"] is False


def test_verify_detects_a_broken_link(db_session):
    _seed_chain(db_session)
    last = db_session.query(AuditTrail).order_by(AuditTrail.seq.desc()).first()
    entry_hash = compute_entry_hash("intruder", "lock_account", {"target": "U1"}, str(uuid.uuid4()))
    db_session.add(
        AuditTrail(
            investigation_id=None,
            actor="intruder",
            action="lock_account",
            detail={"target": "U1"},
            prev_hash="not-the-previous-hash",
            entry_hash=entry_hash,
        )
    )
    db_session.commit()

    body = client.post("/audit-trail/verify", headers=bearer_for("forensic_analyst")).json()

    assert body["chain_valid"] is False
    assert body["reason"] == "prev_hash_mismatch"
    assert body["first_break_seq"] == last.seq + 1


def test_verify_is_rate_limited_to_ten_per_minute_per_analyst(db_session):
    headers = bearer_for("forensic_analyst")

    codes = [client.post("/audit-trail/verify", headers=headers).status_code for _ in range(11)]

    assert codes[:10] == [200] * 10
    assert codes[10] == 429
