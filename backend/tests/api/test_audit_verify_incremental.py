"""POST /audit-trail/verify: incremental by default, full on request (BE6, backend/api/audit_chain.py).

An old row is tampered with a parameterized UPDATE in the test only. The application never updates
audit_trail.
What is proved: the default pass re-checks the checkpoint entry and walks only newer entries, says so
(`mode`, `verified_from_seq`, `entries_checked`) and does not claim to cover older rows; `full=true` finds a
change to an old row; the checkpoint moves only after a pass that found no break.
"""

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.api import audit_chain
from backend.api.main import app
from backend.api.rate_limit import _client
from backend.db.audit import compute_entry_hash
from backend.tests.fixtures.read_seed import audit, bearer_for

client = TestClient(app)


def _append(db_session, count: int, start: int = 0) -> None:
    for index in range(start, start + count):
        audit(db_session, "watchdog", "credibility_update", {"n": index})
    db_session.commit()


def _verify(headers: dict, *, full: bool = False) -> dict:
    response = client.post("/audit-trail/verify" + ("?full=true" if full else ""), headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def _checkpoint() -> dict | None:
    raw = _client().get(audit_chain.CHECKPOINT_KEY)
    return json.loads(raw) if raw else None


def _tamper(db_session, seq: int) -> None:
    db_session.execute(
        text("UPDATE audit_trail SET detail = CAST(:detail AS jsonb) WHERE seq = :seq"),
        {"detail": json.dumps({"tampered": True}), "seq": seq},
    )
    db_session.commit()


def test_without_a_checkpoint_the_pass_is_full_and_says_so(db_session):
    _append(db_session, 5)
    headers = bearer_for("forensic_analyst")
    assert _checkpoint() is None

    body = _verify(headers)

    assert body["mode"] == "full"
    assert body["verified_from_seq"] == 1
    assert body["entries_checked"] == 5
    assert body["chain_valid"] is True and body["reason"] == "ok"
    assert _checkpoint() == {"seq": 5, "entry_hash": body["head_hash"]}


def test_the_next_pass_is_incremental_and_checks_only_the_checkpoint_entry(db_session):
    _append(db_session, 5)
    headers = bearer_for("forensic_analyst")
    _verify(headers)

    body = _verify(headers)

    assert body["mode"] == "incremental"
    assert body["verified_from_seq"] == 5
    assert body["entries_checked"] == 1  # the checkpoint entry; nothing newer exists
    assert body["chain_valid"] is True


def test_new_entries_are_walked_and_the_checkpoint_advances(db_session):
    _append(db_session, 3)
    headers = bearer_for("forensic_analyst")
    _verify(headers)
    _append(db_session, 2, start=3)

    body = _verify(headers)

    assert (body["mode"], body["verified_from_seq"], body["entries_checked"]) == ("incremental", 3, 3)
    assert body["chain_valid"] is True
    assert _checkpoint() == {"seq": 5, "entry_hash": body["head_hash"]}
    assert _verify(headers)["entries_checked"] == 1


def test_a_tampered_old_row_is_found_only_by_a_full_pass(db_session):
    _append(db_session, 5)
    headers = bearer_for("forensic_analyst")
    _verify(headers)
    _tamper(db_session, 2)

    incremental = _verify(headers)
    full = _verify(headers, full=True)

    # The default pass does not pretend to cover the prefix: it says where it started and how little it read.
    assert incremental["mode"] == "incremental"
    assert incremental["verified_from_seq"] == 5 > 2
    assert incremental["entries_checked"] == 1 < 5
    assert incremental["chain_valid"] is True
    assert full["mode"] == "full"
    assert full["chain_valid"] is False
    assert full["reason"] == "hash_mismatch"
    assert full["first_break_seq"] == 2
    assert full["entries_checked"] == 2


def test_a_failed_pass_does_not_move_the_checkpoint(db_session):
    _append(db_session, 5)
    headers = bearer_for("forensic_analyst")
    _verify(headers)
    before = _checkpoint()
    _tamper(db_session, 2)

    assert _verify(headers, full=True)["chain_valid"] is False

    assert _checkpoint() == before


def test_a_row_tampered_after_the_checkpoint_is_found_by_the_incremental_pass(db_session):
    _append(db_session, 3)
    headers = bearer_for("forensic_analyst")
    _verify(headers)
    _append(db_session, 2, start=3)
    _tamper(db_session, 5)
    before = _checkpoint()

    body = _verify(headers)

    assert body["mode"] == "incremental"
    assert body["chain_valid"] is False
    assert body["reason"] == "hash_mismatch"
    assert body["first_break_seq"] == 5
    assert body["entries_checked"] == 3  # the checkpoint entry, seq 4, then the broken seq 5
    assert _checkpoint() == before


def test_a_forged_link_after_the_checkpoint_is_reported_as_prev_hash_mismatch(db_session):
    _append(db_session, 3)
    headers = bearer_for("forensic_analyst")
    _verify(headers)
    _append(db_session, 2, start=3)
    db_session.execute(text("UPDATE audit_trail SET prev_hash = 'forged' WHERE seq = 4"))
    db_session.commit()

    body = _verify(headers)

    assert (body["chain_valid"], body["reason"], body["first_break_seq"]) == (False, "prev_hash_mismatch", 4)


def test_a_content_change_to_the_checkpoint_entry_is_found(db_session):
    _append(db_session, 3)
    headers = bearer_for("forensic_analyst")
    _verify(headers)
    _tamper(db_session, 3)

    body = _verify(headers)

    assert body["mode"] == "incremental"
    assert (body["chain_valid"], body["reason"], body["first_break_seq"]) == (False, "hash_mismatch", 3)


def test_a_rewritten_checkpoint_entry_is_a_checkpoint_mismatch_and_a_full_pass_re_anchors(db_session):
    """The entry is rewritten with a hash that recomputes, so the chain is consistent but the entry is no
    longer the one that was verified. Only the remembered hash can tell. A full pass accepts the table as it
    is now and moves the checkpoint, which is the way to re-anchor after a deliberate change."""
    _append(db_session, 3)
    headers = bearer_for("forensic_analyst")
    _verify(headers)
    last = db_session.execute(text("SELECT prev_hash FROM audit_trail WHERE seq = 3")).one()
    new_detail = {"rewritten": True}
    new_hash = compute_entry_hash("watchdog", "credibility_update", new_detail, last.prev_hash)
    db_session.execute(
        text("UPDATE audit_trail SET detail = CAST(:d AS jsonb), entry_hash = :h WHERE seq = 3"),
        {"d": json.dumps(new_detail), "h": new_hash},
    )
    db_session.commit()

    stale = _verify(headers)
    reanchored = _verify(headers, full=True)
    after = _verify(headers)

    assert (stale["chain_valid"], stale["reason"], stale["first_break_seq"]) == (
        False,
        "checkpoint_mismatch",
        3,
    )
    assert reanchored["chain_valid"] is True and reanchored["mode"] == "full"
    assert (after["chain_valid"], after["mode"]) == (True, "incremental")


def test_a_checkpoint_beyond_the_table_is_a_mismatch_with_nothing_checked(db_session):
    _append(db_session, 2)
    headers = bearer_for("forensic_analyst")
    _client().set(audit_chain.CHECKPOINT_KEY, json.dumps({"seq": 9, "entry_hash": "x" * 64}))

    body = _verify(headers)

    assert (body["chain_valid"], body["reason"], body["first_break_seq"]) == (False, "checkpoint_mismatch", 9)
    assert body["entries_checked"] == 0
    assert body["head_hash"] is not None  # the real head is still reported


def test_an_empty_chain_is_valid_and_clears_an_old_checkpoint(db_session):
    headers = bearer_for("forensic_analyst")
    _client().set(audit_chain.CHECKPOINT_KEY, json.dumps({"seq": 9, "entry_hash": "x" * 64}))

    body = _verify(headers, full=True)

    assert body["chain_valid"] is True and body["mode"] == "full"
    assert (body["entries_checked"], body["verified_from_seq"], body["head_hash"]) == (0, None, None)
    assert _checkpoint() is None


def test_an_unreadable_checkpoint_falls_back_to_a_full_pass(db_session):
    _append(db_session, 3)
    headers = bearer_for("forensic_analyst")
    _client().set(audit_chain.CHECKPOINT_KEY, "not json")

    body = _verify(headers)

    assert (body["mode"], body["entries_checked"], body["chain_valid"]) == ("full", 3, True)
    assert _checkpoint()["seq"] == 3  # repaired by the successful pass


def test_a_redis_failure_never_fails_the_pass(db_session, monkeypatch):
    _append(db_session, 3)
    headers = bearer_for("forensic_analyst")

    class Broken:
        def get(self, *_args, **_kwargs):
            raise ConnectionError("redis is down")

        set = delete = get

    monkeypatch.setattr(audit_chain, "_redis", lambda: Broken())

    body = _verify(headers)

    assert (body["mode"], body["entries_checked"], body["chain_valid"]) == ("full", 3, True)


def test_full_must_be_a_boolean(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.post("/audit-trail/verify?full=maybe", headers=headers).status_code == 422


@pytest.mark.parametrize("path", ["/audit-trail/verify", "/audit-trail/verify?full=true"])
def test_verify_still_needs_a_token(db_session, path):
    assert client.post(path).status_code == 401
