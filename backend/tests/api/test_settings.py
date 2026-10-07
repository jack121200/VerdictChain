import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from backend.api.main import app
from backend.db import runtime_settings
from backend.db.audit import find_first_break
from backend.db.models import AuditTrail
from backend.db.session import SessionLocal
from backend.tests.fixtures.auth import auth_headers
from backend.watchdog import credibility

client = TestClient(app)

DEFAULTS = {
    "eta": 0.15,
    "isolation_threshold": 0.30,
    "verdict_confidence_threshold": 0.80,
    "intake_paused": False,
}
NEW = {"eta": 0.2, "isolation_threshold": 0.25, "verdict_confidence_threshold": 0.9, "intake_paused": True}


def _audit_rows(action: str) -> list[AuditTrail]:
    with SessionLocal() as session:
        return session.query(AuditTrail).filter(AuditTrail.action == action).order_by(AuditTrail.seq).all()


def _chain_is_valid() -> bool:
    with SessionLocal() as session:
        return find_first_break(session.query(AuditTrail).order_by(AuditTrail.seq).all()) is None


def _stored() -> dict:
    with SessionLocal() as session:
        return runtime_settings.load(session).values()


def test_get_settings_needs_a_token(db_session):
    assert client.get("/settings").status_code == 401


def test_get_settings_returns_the_defaults_and_read_only_constants(db_session):
    resp = client.get("/settings", headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 200
    body = resp.json()
    assert {key: body[key] for key in DEFAULTS} == DEFAULTS
    assert body["debate_rounds"] == 3
    assert body["starting_crs"] == 0.5
    assert body["updated_by"] is None


def test_starting_crs_agrees_with_the_watchdog_constant():
    from backend.api.routes.settings import STARTING_CRS

    assert STARTING_CRS == credibility.STARTING_CRS


def test_lead_replaces_the_settings_and_the_change_is_audited(db_session):
    headers = auth_headers("secops_lead")
    resp = client.put("/settings", headers=headers, json=NEW)
    assert resp.status_code == 200
    assert {key: resp.json()[key] for key in NEW} == NEW
    assert resp.json()["updated_by"] is not None

    assert {key: client.get("/settings", headers=headers).json()[key] for key in NEW} == NEW
    assert _stored() == NEW

    entries = _audit_rows("settings_changed")
    assert len(entries) == 1
    assert entries[0].detail == {"before": DEFAULTS, "after": NEW}
    assert _chain_is_valid()


@pytest.mark.parametrize("role", ["forensic_analyst", "red_team_auditor", "watchdog_supervisor"])
def test_non_leads_cannot_replace_the_settings(db_session, role):
    resp = client.put("/settings", headers=auth_headers(role), json=NEW)
    assert resp.status_code == 403
    assert resp.json()["detail"] == "Missing capability: edit_settings"
    assert _stored() == DEFAULTS
    assert _audit_rows("settings_changed") == []


@pytest.mark.parametrize(
    "field, value",
    [
        ("eta", 0.0),
        ("eta", 0.51),
        ("isolation_threshold", 0.04),
        ("isolation_threshold", 0.46),
        ("verdict_confidence_threshold", 0.49),
        ("verdict_confidence_threshold", 1.0),
    ],
)
def test_out_of_range_values_are_rejected_and_nothing_is_written(db_session, field, value):
    headers = auth_headers("secops_lead")
    body = {**NEW, field: value}
    resp = client.put("/settings", headers=headers, json=body)
    assert resp.status_code == 422
    assert _stored() == DEFAULTS
    assert _audit_rows("settings_changed") == []


def test_range_boundaries_are_accepted(db_session):
    headers = auth_headers("secops_lead")
    low = {
        "eta": 0.01,
        "isolation_threshold": 0.05,
        "verdict_confidence_threshold": 0.50,
        "intake_paused": False,
    }
    high = {
        "eta": 0.5,
        "isolation_threshold": 0.45,
        "verdict_confidence_threshold": 0.99,
        "intake_paused": False,
    }
    assert client.put("/settings", headers=headers, json=low).status_code == 200
    assert client.put("/settings", headers=headers, json=high).status_code == 200
    assert _stored() == high


@pytest.mark.parametrize(
    "body",
    [
        {**NEW, "role": "secops_lead"},  # extra fields are forbidden
        {
            "eta": 0.2,
            "isolation_threshold": 0.25,
            "verdict_confidence_threshold": 0.9,
        },  # full replace: intake_paused required
        {**NEW, "eta": "high"},
        {**NEW, "intake_paused": "yes"},
    ],
)
def test_extra_missing_or_mistyped_fields_are_422(db_session, body):
    resp = client.put("/settings", headers=auth_headers("secops_lead"), json=body)
    assert resp.status_code == 422
    assert _stored() == DEFAULTS


def test_a_failed_audit_write_rolls_the_settings_change_back(db_session, monkeypatch):
    def broken_append(*args, **kwargs):
        raise RuntimeError("audit unavailable")

    monkeypatch.setattr("backend.api.routes.settings.append_entry", broken_append)
    headers = auth_headers("secops_lead")
    failing = TestClient(app, raise_server_exceptions=False)
    resp = failing.put("/settings", headers=headers, json=NEW)
    assert resp.status_code == 500
    assert _stored() == DEFAULTS


def test_load_returns_the_defaults_when_the_row_is_missing(db_session):
    with SessionLocal() as session:
        session.execute(text("DELETE FROM runtime_settings"))
        session.commit()
    assert runtime_settings.load().values() == DEFAULTS
    assert runtime_settings.load().updated_at is None


def test_load_reads_the_stored_row(db_session):
    with SessionLocal() as session:
        runtime_settings.save(session, NEW, updated_by="tester")
        session.commit()
    stored = runtime_settings.load()
    assert stored.values() == NEW
    assert stored.updated_by == "tester"
    assert stored.updated_at is not None


def test_save_does_not_commit_so_the_caller_owns_the_transaction(db_session):
    session = SessionLocal()
    try:
        runtime_settings.save(session, NEW, updated_by="tester")
        session.rollback()
    finally:
        session.close()
    assert _stored() == DEFAULTS


@pytest.mark.parametrize(
    "values, message",
    [
        ({**NEW, "eta": 0.9}, "eta must be between"),
        ({**NEW, "isolation_threshold": 0.9}, "isolation_threshold must be between"),
        ({**NEW, "verdict_confidence_threshold": 0.1}, "verdict_confidence_threshold must be between"),
        ({"eta": 0.2}, "missing"),
        ({**NEW, "extra": 1}, "unknown"),
        ({**NEW, "eta": True}, "must be a number"),
        ({**NEW, "intake_paused": 1}, "must be a boolean"),
    ],
)
def test_save_validates_the_values(db_session, values, message):
    with SessionLocal() as session:
        with pytest.raises(ValueError, match=message):
            runtime_settings.save(session, values, updated_by="tester")


def test_each_put_writes_one_settings_changed_entry_with_before_and_after(db_session):
    headers = auth_headers("secops_lead")
    client.put("/settings", headers=headers, json=DEFAULTS)
    client.put("/settings", headers=headers, json=NEW)
    entries = _audit_rows("settings_changed")
    assert [(entry.detail["before"], entry.detail["after"]) for entry in entries] == [
        (DEFAULTS, DEFAULTS),
        (DEFAULTS, NEW),
    ]
