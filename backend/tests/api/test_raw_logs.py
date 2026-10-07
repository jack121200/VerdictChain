"""Raw-log reads (plan section 3.4): allow-list, no ground-truth label, sanitised raw_fields, counts,
status codes.
"""

import math
import uuid

from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.routes.raw_logs import MAX_DEPTH, MAX_STRING_LENGTH, sanitize_raw_fields
from backend.tests.fixtures.read_seed import BASE_TIME, add_raw, bearer_for

client = TestClient(app)

ALLOWED_KEYS = {
    "row_id",
    "timestamp",
    "source",
    "source_file",
    "event_type",
    "user_id",
    "host_id",
    "severity",
    "raw_fields",
}
SECRET_LABEL = "insider_scenario_2"


def test_get_row_returns_only_the_allow_listed_fields(db_session):
    row = add_raw(
        db_session,
        source="cert_r4.2_file",
        event_type="file_access",
        user_id="ACM2278",
        host_id="PC-1",
        raw_fields={"file_name": "report.doc", "department": "R&D"},
        label=SECRET_LABEL,
        timestamp=BASE_TIME,
    )
    db_session.commit()

    resp = client.get(f"/raw-logs/{row.row_id}", headers=bearer_for("forensic_analyst"))

    assert resp.status_code == 200
    body = resp.json()
    assert set(body) == ALLOWED_KEYS
    assert body["row_id"] == str(row.row_id)
    assert body["user_id"] == "ACM2278"
    assert body["raw_fields"] == {"file_name": "report.doc", "department": "R&D"}


def test_ground_truth_label_never_appears_in_any_raw_log_response(db_session):
    row = add_raw(db_session, raw_fields={"Destination Port": 22}, label=SECRET_LABEL)
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    responses = [
        client.get(f"/raw-logs/{row.row_id}", headers=headers),
        client.get("/raw-logs/recent?limit=10", headers=headers),
        client.get("/raw-logs/counts", headers=headers),
    ]

    for resp in responses:
        assert resp.status_code == 200
        assert SECRET_LABEL not in resp.text
        assert "ground_truth_label" not in resp.text


def test_non_uuid_is_422_and_missing_row_is_404(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.get("/raw-logs/not-a-uuid", headers=headers).status_code == 422
    assert client.get(f"/raw-logs/{uuid.uuid4()}", headers=headers).status_code == 404


def test_recent_rows_are_limited_and_filterable_by_source(db_session):
    for n in range(3):
        add_raw(db_session, source="cicids2017", raw_fields={"n": n}, timestamp=BASE_TIME)
    add_raw(
        db_session, source="cert_r4.2_logon", event_type="logon", raw_fields={"n": 9}, timestamp=BASE_TIME
    )
    db_session.commit()
    headers = bearer_for("forensic_analyst")

    all_recent = client.get("/raw-logs/recent?limit=200", headers=headers).json()
    assert len(all_recent) == 4

    limited = client.get("/raw-logs/recent?limit=2", headers=headers).json()
    assert len(limited) == 2

    logon_only = client.get("/raw-logs/recent?source=cert_r4.2_logon", headers=headers).json()
    assert [r["source"] for r in logon_only] == ["cert_r4.2_logon"]


def test_recent_validates_limit(db_session):
    headers = bearer_for("forensic_analyst")

    assert client.get("/raw-logs/recent?limit=0", headers=headers).status_code == 422
    assert client.get("/raw-logs/recent?limit=201", headers=headers).status_code == 422


def test_counts_are_metric_envelopes_and_zero_is_real(db_session):
    add_raw(db_session, source="cicids2017")
    add_raw(db_session, source="cicids2017")
    db_session.commit()

    body = client.get("/raw-logs/counts", headers=bearer_for("forensic_analyst")).json()

    assert body["total"]["value"] == 2
    assert body["total"]["n"] == 2
    by_source = {s["source"]: s["count"] for s in body["sources"]}
    assert by_source["cicids2017"]["value"] == 2
    assert by_source["cert_r4.2_logon"]["value"] == 0
    assert by_source["cert_r4.2_logon"]["reason"] is None
    assert {"value", "n", "as_of", "source", "definition", "reason"} <= set(by_source["cicids2017"])


def test_sanitizer_drops_non_finite_numbers_and_unsafe_types():
    raw = {
        "ok": 1.5,
        "nan": math.nan,
        "inf": math.inf,
        "neg": -math.inf,
        "list": [1, math.nan, "x"],
        "obj": object(),
    }

    safe = sanitize_raw_fields(raw)

    assert safe == {"ok": 1.5, "list": [1, "x"]}


def test_sanitizer_truncates_strings_and_strips_control_characters():
    raw = {"text": "a\x07b\x00c" + "z" * (MAX_STRING_LENGTH + 50)}

    safe = sanitize_raw_fields(raw)

    assert safe["text"].startswith("abc")
    assert "\x07" not in safe["text"] and "\x00" not in safe["text"]
    assert len(safe["text"]) == MAX_STRING_LENGTH


def test_sanitizer_caps_nesting_depth():
    deep: dict = {"leaf": "value"}
    for _ in range(MAX_DEPTH + 3):
        deep = {"child": deep}

    safe = sanitize_raw_fields({"root": deep})

    node = safe["root"]
    depth = 0
    while isinstance(node, dict) and "child" in node:
        node = node["child"]
        depth += 1
    assert depth < MAX_DEPTH + 3
    assert "leaf" not in str(safe)


def test_endpoint_sanitises_control_characters_from_storage(db_session):
    row = add_raw(db_session, raw_fields={"note": "line\x07one", "count": 3})
    db_session.commit()

    body = client.get(f"/raw-logs/{row.row_id}", headers=bearer_for("forensic_analyst")).json()

    assert body["raw_fields"] == {"note": "lineone", "count": 3}
