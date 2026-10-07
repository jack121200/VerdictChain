import os
import subprocess
import sys
import threading
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.api.auth import create_access_token
from backend.api.main import app
from backend.config import settings
from backend.db.audit import find_first_break
from backend.db.models import Analyst, AuditTrail
from backend.db.session import SessionLocal
from backend.scripts import bootstrap_lead
from backend.tests.fixtures.auth import TEST_PASSWORD, make_analyst

client = TestClient(app)
REPO_ROOT = Path(__file__).resolve().parents[3]


def _headers_for(analyst: Analyst) -> dict[str, str]:
    """A real login token for an analyst created by make_analyst (fixtures.auth returns only the row)."""
    response = client.post("/auth/login", json={"username": analyst.username, "password": TEST_PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _audit_rows(action: str, actor: str | None = None) -> list[AuditTrail]:
    with SessionLocal() as session:
        query = session.query(AuditTrail).filter(AuditTrail.action == action)
        if actor is not None:
            query = query.filter(AuditTrail.actor == actor)
        return query.order_by(AuditTrail.seq).all()


def _chain_is_valid() -> bool:
    with SessionLocal() as session:
        return find_first_break(session.query(AuditTrail).order_by(AuditTrail.seq).all()) is None


def _role_of(analyst_id: uuid.UUID) -> str:
    with SessionLocal() as session:
        return session.get(Analyst, analyst_id).role


def _lead_count() -> int:
    with SessionLocal() as session:
        return session.query(Analyst).filter(Analyst.role == "secops_lead").count()


def test_listing_users_returns_every_analyst(db_session):
    lead = make_analyst("secops_lead")
    analyst = make_analyst("forensic_analyst")
    resp = client.get("/users", headers=_headers_for(lead))
    assert resp.status_code == 200
    rows = {row["analyst_id"]: row for row in resp.json()}
    assert rows[str(lead.analyst_id)]["role"] == "secops_lead"
    assert rows[str(analyst.analyst_id)]["role"] == "forensic_analyst"
    assert set(resp.json()[0]) == {"analyst_id", "username", "role", "created_at"}


def test_listing_users_needs_a_token(db_session):
    assert client.get("/users").status_code == 401


def test_lead_promotes_an_analyst_and_the_change_is_audited(db_session):
    lead = make_analyst("secops_lead")
    target = make_analyst("forensic_analyst")
    resp = client.put(
        f"/users/{target.analyst_id}/role", headers=_headers_for(lead), json={"role": "watchdog_supervisor"}
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "watchdog_supervisor"
    assert _role_of(target.analyst_id) == "watchdog_supervisor"

    entries = _audit_rows("role_changed", actor=lead.username)
    assert len(entries) == 1
    assert entries[0].detail == {
        "analyst_id": str(target.analyst_id),
        "username": target.username,
        "before": "forensic_analyst",
        "after": "watchdog_supervisor",
    }
    assert _chain_is_valid()


def test_a_no_op_role_change_writes_no_audit_entry(db_session):
    lead = make_analyst("secops_lead")
    target = make_analyst("forensic_analyst")
    resp = client.put(
        f"/users/{target.analyst_id}/role", headers=_headers_for(lead), json={"role": "forensic_analyst"}
    )
    assert resp.status_code == 200
    assert _audit_rows("role_changed") == []


@pytest.mark.parametrize(
    "body",
    [{"role": "root"}, {}, {"role": "secops_lead", "username": "x"}],
)
def test_role_body_is_validated(db_session, body):
    lead = make_analyst("secops_lead")
    target = make_analyst("forensic_analyst")
    resp = client.put(f"/users/{target.analyst_id}/role", headers=_headers_for(lead), json=body)
    assert resp.status_code == 422
    assert _role_of(target.analyst_id) == "forensic_analyst"


def test_unknown_analyst_is_404(db_session):
    lead = make_analyst("secops_lead")
    resp = client.put(
        f"/users/{uuid.uuid4()}/role", headers=_headers_for(lead), json={"role": "forensic_analyst"}
    )
    assert resp.status_code == 404


def test_the_last_secops_lead_cannot_demote_itself(db_session):
    lead = make_analyst("secops_lead")
    resp = client.put(
        f"/users/{lead.analyst_id}/role", headers=_headers_for(lead), json={"role": "forensic_analyst"}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Cannot demote the last secops_lead"
    assert _role_of(lead.analyst_id) == "secops_lead"
    assert _audit_rows("role_changed") == []


def test_a_lead_can_be_demoted_while_another_lead_remains(db_session):
    first = make_analyst("secops_lead")
    second = make_analyst("secops_lead")
    resp = client.put(
        f"/users/{second.analyst_id}/role", headers=_headers_for(first), json={"role": "forensic_analyst"}
    )
    assert resp.status_code == 200
    assert _lead_count() == 1


def test_a_demoted_lead_loses_access_on_the_next_request(db_session):
    first = make_analyst("secops_lead")
    second = make_analyst("secops_lead")
    second_headers = _headers_for(second)  # a token issued while second was still a lead
    client.put(
        f"/users/{second.analyst_id}/role", headers=_headers_for(first), json={"role": "forensic_analyst"}
    )
    assert client.get("/users", headers=second_headers).status_code == 403


def test_concurrent_demotions_of_the_two_leads_keep_one_lead(db_session):
    """Two leads demote each other at once. The lock order (all leads first) lets exactly one succeed."""
    first = make_analyst("secops_lead")
    second = make_analyst("secops_lead")
    tokens = {
        "first": create_access_token(first.username, "secops_lead"),
        "second": create_access_token(second.username, "secops_lead"),
    }
    targets = {"first": second.analyst_id, "second": first.analyst_id}
    start = threading.Barrier(2)
    statuses: dict[str, int] = {}

    def demote(actor: str) -> None:
        start.wait()
        resp = TestClient(app).put(
            f"/users/{targets[actor]}/role",
            headers={"Authorization": f"Bearer {tokens[actor]}"},
            json={"role": "forensic_analyst"},
        )
        statuses[actor] = resp.status_code

    threads = [threading.Thread(target=demote, args=(actor,)) for actor in ("first", "second")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=60)

    # Exactly one demotion succeeds. The other is refused: 409 (last lead), or 403 (actor just demoted).
    assert sorted(statuses.values())[0] == 200 and set(statuses.values()) <= {200, 403, 409}, statuses
    assert _lead_count() == 1


def test_bootstrap_creates_the_lead_once(db_session):
    username = f"boot_{uuid.uuid4().hex[:8]}"
    assert bootstrap_lead.bootstrap_lead(username, TEST_PASSWORD) == "created"
    assert bootstrap_lead.bootstrap_lead(username, TEST_PASSWORD) == "unchanged"
    with SessionLocal() as session:
        assert session.query(Analyst).filter(Analyst.username == username).one().role == "secops_lead"
    entries = _audit_rows("register", actor="system")
    assert [entry.detail["username"] for entry in entries] == [username]
    assert _chain_is_valid()


def test_bootstrap_promotes_an_existing_analyst_once(db_session):
    analyst = make_analyst("forensic_analyst")
    assert bootstrap_lead.bootstrap_lead(analyst.username) == "promoted"
    assert bootstrap_lead.bootstrap_lead(analyst.username) == "unchanged"
    assert _role_of(analyst.analyst_id) == "secops_lead"
    entries = _audit_rows("role_changed", actor="system")
    assert len(entries) == 1
    assert entries[0].detail == {
        "username": analyst.username,
        "before": "forensic_analyst",
        "after": "secops_lead",
    }
    assert _chain_is_valid()


def test_bootstrap_refuses_a_short_password_when_creating(db_session):
    with pytest.raises(ValueError, match="password must be"):
        bootstrap_lead.bootstrap_lead(f"short_{uuid.uuid4().hex[:6]}", "short")


def test_bootstrap_cli_is_idempotent_and_never_prints_the_password(db_session):
    assert "test" in settings.sqlalchemy_url.lower(), "refusing to run the CLI against a non-test database"
    username = f"cli_lead_{uuid.uuid4().hex[:6]}"
    password = "cli_sentinel_password_7731"
    env = {
        **os.environ,
        "ENVIRONMENT": "development",
        "LOCAL_DATABASE_URL": settings.local_database_url,
        "BOOTSTRAP_LEAD_USERNAME": username,
        "BOOTSTRAP_LEAD_PASSWORD": password,
    }

    def run() -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, "-m", "backend.scripts.bootstrap_lead"],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=120,
        )

    first, second = run(), run()
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    assert "created" in first.stdout
    assert "nothing changed" in second.stdout
    assert password not in first.stdout + first.stderr + second.stdout + second.stderr
    assert len(_audit_rows("register", actor="system")) == 1


def test_bootstrap_cli_without_a_username_exits_2(monkeypatch):
    monkeypatch.setattr(settings, "bootstrap_lead_username", "  ")
    assert bootstrap_lead.main() == 2
