"""GET /investigations/{id}/audit-chain: one case's entries in chain order, each recomputable, with how it
links into the global chain and a digest over the case's entry hashes. It is a view of audit_trail, and
nothing about it is stored.
"""

import hashlib
import uuid

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.tests.fixtures.read_seed import add_investigation, audit, bearer_for

client = TestClient(app)

SECRET_LABEL = "insider_scenario_secret_label"


def _interleaved(db_session):
    """Case A and case B write alternately, with one system entry in between: A1 B1 A2 S A3."""
    a = add_investigation(db_session, scenario_label=SECRET_LABEL)
    b = add_investigation(db_session, scenario_label="DDoS")
    entries = [
        audit(db_session, "debate_engine", "investigation_started", {"n": 1}, a.investigation_id),
        audit(db_session, "debate_engine", "investigation_started", {"n": 2}, b.investigation_id),
        audit(db_session, "watchdog", "credibility_update", {"crs": 0.5123456789}, a.investigation_id),
        audit(db_session, "analyst", "login", {"user": "x"}),
        audit(db_session, "debate_engine", "verdict_reached", {"verdict_class": "ddos"}, a.investigation_id),
    ]
    db_session.commit()
    return a, b, entries


def _get(investigation_id, role="forensic_analyst"):
    return client.get(f"/investigations/{investigation_id}/audit-chain", headers=bearer_for(role))


def test_returns_only_this_cases_entries_oldest_first(db_session):
    a, b, entries = _interleaved(db_session)

    body = _get(a.investigation_id).json()

    assert body["investigation_id"] == str(a.investigation_id)
    assert [e["action"] for e in body["entries"]] == [
        "investigation_started",
        "credibility_update",
        "verdict_reached",
    ]
    seqs = [e["seq"] for e in body["entries"]]
    assert seqs == sorted(seqs)
    assert {e["investigation_id"] for e in body["entries"]} == {str(a.investigation_id)}
    assert body["count"]["value"] == 3 and body["count"]["n"] == 3
    # Case B's own view holds its single entry.
    other = _get(b.investigation_id).json()
    assert [e["action"] for e in other["entries"]] == ["investigation_started"]


def test_each_entry_recomputes_from_its_hash_input(db_session):
    a, _, _ = _interleaved(db_session)

    for entry in _get(a.investigation_id).json()["entries"]:
        assert hashlib.sha256(entry["hash_input"].encode("utf-8")).hexdigest() == entry["entry_hash"]


def test_links_to_says_how_an_entry_joins_the_global_chain(db_session):
    a, _, _ = _interleaved(db_session)

    links = [e["links_to"] for e in _get(a.investigation_id).json()["entries"]]

    # A1 is the genesis of the whole chain; A2 follows B1 (another case); A3 follows a system entry.
    assert links == ["genesis", "other", "other"]


def test_consecutive_entries_of_one_case_link_to_each_other(db_session):
    a = add_investigation(db_session)
    audit(db_session, "debate_engine", "investigation_started", {"n": 1}, a.investigation_id)
    audit(db_session, "watchdog", "credibility_update", {"n": 2}, a.investigation_id)
    audit(db_session, "debate_engine", "verdict_reached", {"n": 3}, a.investigation_id)
    db_session.commit()

    body = _get(a.investigation_id).json()

    assert [e["links_to"] for e in body["entries"]] == ["genesis", "case", "case"]
    assert body["entries"][1]["prev_hash"] == body["entries"][0]["entry_hash"]


def test_the_digest_is_sha256_of_the_entry_hashes_joined_by_newlines(db_session):
    a, _, _ = _interleaved(db_session)

    body = _get(a.investigation_id).json()

    joined = "\n".join(entry["entry_hash"] for entry in body["entries"])
    assert body["case_digest"] == hashlib.sha256(joined.encode("utf-8")).hexdigest()
    assert "newline" in body["digest_rule"] and "oldest first" in body["digest_rule"]
    assert body["case_digest"] == _get(a.investigation_id).json()["case_digest"]  # stable between reads


def test_the_digest_changes_when_the_case_gets_a_new_entry(db_session):
    a = add_investigation(db_session)
    audit(db_session, "debate_engine", "investigation_started", {"n": 1}, a.investigation_id)
    db_session.commit()
    before = _get(a.investigation_id).json()["case_digest"]

    audit(db_session, "debate_engine", "verdict_reached", {"n": 2}, a.investigation_id)
    db_session.commit()

    assert _get(a.investigation_id).json()["case_digest"] != before


def test_a_case_with_no_entries_has_no_digest_and_a_count_of_zero(db_session):
    a = add_investigation(db_session)
    db_session.commit()

    body = _get(a.investigation_id).json()

    assert body["entries"] == []
    assert body["case_digest"] is None
    assert body["count"]["value"] == 0  # a real zero, not a missing value
    assert body["chain"] == {"valid": True, "head_seq": None, "total": 0}


def test_the_global_chain_summary_is_part_of_the_answer(db_session):
    a, _, _ = _interleaved(db_session)

    body = _get(a.investigation_id).json()

    assert body["chain"]["valid"] is True
    assert body["chain"]["total"] == 5  # the whole log, not just this case
    assert body["chain"]["head_seq"] == max(e["seq"] for e in body["entries"])


def test_the_scenario_label_is_nowhere_in_the_answer(db_session):
    a, _, _ = _interleaved(db_session)

    assert SECRET_LABEL not in _get(a.investigation_id).text


def test_an_unknown_case_is_404_and_a_malformed_id_is_422(db_session):
    assert _get(uuid.uuid4()).status_code == 404
    assert (
        client.get(
            "/investigations/not-a-uuid/audit-chain", headers=bearer_for("forensic_analyst")
        ).status_code
        == 422
    )


def test_a_token_is_required(db_session):
    a = add_investigation(db_session)
    db_session.commit()

    assert client.get(f"/investigations/{a.investigation_id}/audit-chain").status_code == 401


def test_every_role_may_read_it(db_session):
    a, _, _ = _interleaved(db_session)

    for role in ("secops_lead", "forensic_analyst", "red_team_auditor", "watchdog_supervisor"):
        assert _get(a.investigation_id, role).status_code == 200
