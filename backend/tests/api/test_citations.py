"""Citation re-checks (plan section 3.4): check_citation statuses, one IN-query per batch, the row
fingerprint, the per-(agent, round) match rate against credibility_log, and the global /citations ledger.
"""

import hashlib
import json
import uuid
from collections import defaultdict

from fastapi.testclient import TestClient
from sqlalchemy import event

from backend.agents.schemas import CitedEvidence
from backend.api.main import app
from backend.db.models import CredibilityLog
from backend.db.session import SessionLocal, engine
from backend.tests.fixtures.read_seed import (
    BASE_TIME,
    add_credibility,
    add_investigation,
    add_raw,
    add_transcript,
    bearer_for,
    cite,
)
from backend.watchdog.verification import (
    check_citation,
    check_citations,
    row_fingerprint,
    verify_cited_evidence,
)

client = TestClient(app)


def _entry(row_id: str, field: str, value: str) -> CitedEvidence:
    return CitedEvidence(row_id=row_id, field=field, value=value)


def test_check_citation_verified_has_expected_value_and_fingerprint(db_session):
    row = add_raw(db_session, raw_fields={"Destination Port": 445})
    db_session.commit()

    check = check_citation(db_session, _entry(str(row.row_id), "Destination Port", "445"))

    assert (check.status, check.reason) == ("VERIFIED", "ok")
    assert check.expected == "445"
    assert check.row_fingerprint is not None and len(check.row_fingerprint) == 64


def test_value_mismatch_is_a_discrepancy_with_expected_value(db_session):
    row = add_raw(db_session, raw_fields={"Destination Port": 445})
    db_session.commit()

    check = check_citation(db_session, _entry(str(row.row_id), "Destination Port", "9999"))

    assert (check.status, check.reason, check.expected) == ("DISCREPANCY", "value_mismatch", "445")


def test_exact_matching_has_no_numeric_tolerance(db_session):
    row = add_raw(db_session, raw_fields={"Flow IAT Mean": "0.30"})
    db_session.commit()

    check = check_citation(db_session, _entry(str(row.row_id), "Flow IAT Mean", "0.3"))

    assert (check.status, check.reason, check.expected) == ("DISCREPANCY", "value_mismatch", "0.30")


def test_missing_field_is_a_discrepancy(db_session):
    row = add_raw(db_session, raw_fields={"Destination Port": 445})
    db_session.commit()

    check = check_citation(db_session, _entry(str(row.row_id), "No Such Field", "x"))

    assert (check.status, check.reason, check.expected) == ("DISCREPANCY", "field_not_found", None)


def test_missing_row_and_malformed_id_are_invalid_rows(db_session):
    missing = check_citation(db_session, _entry(str(uuid.uuid4()), "x", "y"))
    malformed = check_citation(db_session, _entry("not-a-uuid", "x", "y"))

    assert (missing.status, missing.reason, missing.row_fingerprint) == ("INVALID_ROW", "row_not_found", None)
    assert (malformed.status, malformed.reason) == ("INVALID_ROW", "malformed_row_id")


def test_top_level_fields_are_checked_on_the_row(db_session):
    row = add_raw(db_session, user_id="U1")
    db_session.commit()

    ok = check_citation(db_session, _entry(str(row.row_id), "user_id", "U1"))
    null_field = check_citation(db_session, _entry(str(row.row_id), "host_id", "H1"))

    assert ok.status == "VERIFIED"
    assert (null_field.status, null_field.reason) == ("DISCREPANCY", "value_mismatch")


def test_batch_check_issues_one_in_query(db_session):
    rows = [add_raw(db_session, raw_fields={"Destination Port": n}) for n in (1, 2, 3)]
    db_session.commit()
    entries = [_entry(str(r.row_id), "Destination Port", str(r.raw_fields["Destination Port"])) for r in rows]
    entries.append(_entry("not-a-uuid", "x", "y"))

    statements: list[str] = []

    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        checks = check_citations(db_session, entries)
    finally:
        event.remove(engine, "before_cursor_execute", record)

    raw_selects = [s for s in statements if "FROM raw_logs" in s]
    assert len(raw_selects) == 1
    assert " IN " in raw_selects[0]
    assert [c.status for c in checks] == ["VERIFIED", "VERIFIED", "VERIFIED", "INVALID_ROW"]


def test_row_fingerprint_is_sha256_of_the_canonical_row(db_session):
    row = add_raw(
        db_session,
        user_id="U1",
        host_id="H1",
        raw_fields={"b": 2, "a": "x"},
        timestamp=BASE_TIME,
    )
    db_session.commit()
    db_session.refresh(row)

    payload = {
        "row_id": str(row.row_id),
        "timestamp": "2026-01-15T12:00:00+00:00",
        "source": "cicids2017",
        "source_file": "cicids2017.csv",
        "event_type": "network_flow",
        "user_id": "U1",
        "host_id": "H1",
        "severity": None,
        "raw_fields": {"a": "x", "b": 2},
    }
    expected = hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    assert row_fingerprint(row) == expected


def test_verify_cited_evidence_keeps_its_rate(db_session):
    row = add_raw(db_session, raw_fields={"Destination Port": 445})
    db_session.commit()

    rate = verify_cited_evidence(
        [
            _entry(str(row.row_id), "Destination Port", "445"),
            _entry(str(row.row_id), "Destination Port", "9999"),
        ]
    )

    assert rate == 0.5


def _investigation_with_mixed_citations(db_session):
    """Network-traffic round 1 has 1 verified, 1 discrepancy and 2 invalid citations (0.25)."""
    inv = add_investigation(db_session, status="verdict_reached", verdict_class="brute_force")
    row = add_raw(db_session, raw_fields={"Destination Port": 22, "Flow IAT Mean": "0.30"})
    add_transcript(
        db_session,
        inv.investigation_id,
        round_no=1,
        agent_id="network_traffic",
        theory="CHALLENGE: brute force patator login rhythm",
        cited=[
            cite(row, "Destination Port", "22"),
            cite(row, "Flow IAT Mean", "0.3"),
            cite(row, "Destination Port", "22", row_id=str(uuid.uuid4())),
            cite(row, "Destination Port", "22", row_id="not-a-uuid"),
        ],
    )
    db_session.commit()
    return inv, row


def test_investigation_citations_summary_and_items(db_session):
    inv, row = _investigation_with_mixed_citations(db_session)
    headers = bearer_for("forensic_analyst")

    resp = client.get(f"/investigations/{inv.investigation_id}/citations", headers=headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["investigation_id"] == str(inv.investigation_id)
    summary = body["summary"]
    assert (summary["total"], summary["verified"], summary["discrepancy"], summary["invalid_row"]) == (
        4,
        1,
        1,
        2,
    )
    assert summary["match_rate"]["value"] == 0.25
    assert summary["match_rate"]["n"] == 4
    assert summary["match_rate"]["reason"] is None
    assert {"value", "n", "as_of", "source", "definition", "reason"} <= set(summary["match_rate"])

    statuses = [c["status"] for c in body["citations"]]
    assert statuses == ["VERIFIED", "DISCREPANCY", "INVALID_ROW", "INVALID_ROW"]
    first = body["citations"][0]
    assert set(first) == {
        "row_id",
        "field",
        "value",
        "expected",
        "status",
        "reason",
        "agent_id",
        "round",
        "row_fingerprint",
    }
    assert first["agent_id"] == "network_traffic"
    assert first["round"] == 1
    assert first["row_fingerprint"] == row_fingerprint(row)
    assert body["citations"][1]["expected"] == "0.30"


def test_per_agent_round_match_rate_equals_credibility_log(db_session):
    """The rate the engine stores in credibility_log is verify_cited_evidence over the same citations."""
    inv = add_investigation(db_session, status="verdict_reached", verdict_class="brute_force")
    row = add_raw(db_session, raw_fields={"Destination Port": 22, "Flow IAT Mean": "0.30"})
    plan = {
        ("network_traffic", 1): [cite(row, "Destination Port", "22"), cite(row, "Flow IAT Mean", "0.3")],
        ("network_traffic", 2): [cite(row, "Destination Port", "22")],
        ("access_log", 1): [cite(row, "Destination Port", "22"), cite(row, "Destination Port", "99")],
    }
    for (agent_id, round_no), cited in plan.items():
        add_transcript(
            db_session,
            inv.investigation_id,
            round_no=round_no,
            agent_id=agent_id,
            theory="SUPPORT: ddos flood",
            cited=cited,
        )
    db_session.commit()
    for (agent_id, round_no), cited in plan.items():
        engine_rate = verify_cited_evidence(
            [CitedEvidence(row_id=c["row_id"], field=c["field"], value=c["value"]) for c in cited]
        )
        add_credibility(
            db_session,
            inv.investigation_id,
            agent_id=agent_id,
            round_no=round_no,
            before=0.5,
            after=0.5,
            rate=engine_rate,
        )
    db_session.commit()

    resp = client.get(
        f"/investigations/{inv.investigation_id}/citations", headers=bearer_for("forensic_analyst")
    )
    assert resp.status_code == 200

    per_group: dict[tuple[str, int], list[str]] = defaultdict(list)
    for item in resp.json()["citations"]:
        per_group[(item["agent_id"], item["round"])].append(item["status"])

    session = SessionLocal()
    try:
        logged = {
            (c.agent_id, c.round): c.verification_match_rate
            for c in session.query(CredibilityLog).filter(
                CredibilityLog.investigation_id == inv.investigation_id
            )
        }
    finally:
        session.close()
    assert set(logged) == set(per_group) == set(plan)
    for key, statuses in per_group.items():
        assert statuses.count("VERIFIED") / len(statuses) == logged[key]


def test_unknown_investigation_is_404_and_bad_id_is_422(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.get(f"/investigations/{uuid.uuid4()}/citations", headers=headers).status_code == 404
    assert client.get("/investigations/not-a-uuid/citations", headers=headers).status_code == 422


def test_global_citations_are_paged_and_filtered(db_session):
    _investigation_with_mixed_citations(db_session)
    inv_b = add_investigation(db_session, status="verdict_reached", verdict_class="ddos")
    row = add_raw(db_session, raw_fields={"Destination Port": 80})
    add_transcript(
        db_session,
        inv_b.investigation_id,
        round_no=1,
        agent_id="access_log",
        theory="SUPPORT: file access spike",
        cited=[cite(row, "Destination Port", "80")],
    )
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    everything = client.get("/citations?limit=200", headers=headers).json()
    assert len(everything) == 5
    assert all("investigation_id" in item for item in everything)

    verified = client.get("/citations?status=VERIFIED", headers=headers).json()
    assert [c["status"] for c in verified] == ["VERIFIED", "VERIFIED"]

    access_only = client.get("/citations?agent_id=access_log", headers=headers).json()
    assert [c["agent_id"] for c in access_only] == ["access_log"]
    assert access_only[0]["investigation_id"] == str(inv_b.investigation_id)

    page = client.get("/citations?limit=2&offset=2", headers=headers).json()
    assert page == everything[2:4]


def test_global_citations_validate_limits_and_status(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.get("/citations?limit=0", headers=headers).status_code == 422
    assert client.get("/citations?limit=201", headers=headers).status_code == 422
    assert client.get("/citations?status=BOGUS", headers=headers).status_code == 422
