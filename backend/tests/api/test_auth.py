import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi.testclient import TestClient

from backend.api.auth import CurrentAnalyst, create_access_token, get_current_user
from backend.api.main import app
from backend.config import settings
from backend.db.audit import find_first_break
from backend.db.models import Analyst, AuditTrail
from backend.db.session import SessionLocal
from backend.tests.fixtures.auth import auth_headers, make_analyst

client = TestClient(app)
PASSWORD = "a_strong_password_123"
PROTECTED_PATHS = (
    "/investigations",
    "/users",
    "/auth/me",
    "/settings",
    "/system/status",
    "/rbac/matrix",
    "/audit-trail",
)


def _unique_username() -> str:
    return f"test_user_{uuid.uuid4().hex[:8]}"


def _analyst_count(username: str) -> int:
    with SessionLocal() as session:
        return session.query(Analyst).filter(Analyst.username == username).count()


def _audit_rows(action: str, actor: str | None = None) -> list[AuditTrail]:
    with SessionLocal() as session:
        query = session.query(AuditTrail).filter(AuditTrail.action == action)
        if actor is not None:
            query = query.filter(AuditTrail.actor == actor)
        return query.order_by(AuditTrail.seq).all()


def _chain_is_valid() -> bool:
    with SessionLocal() as session:
        return find_first_break(session.query(AuditTrail).order_by(AuditTrail.seq).all()) is None


def _signed_token(
    username: str, role: str | None = None, *, secret: str | None = None, minutes: int = 60
) -> str:
    payload: dict = {"sub": username, "exp": datetime.now(timezone.utc) + timedelta(minutes=minutes)}
    if role is not None:
        payload["role"] = role
    return jwt.encode(payload, secret or settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def test_register_then_login_roundtrip(db_session):
    username = _unique_username()

    register_resp = client.post("/auth/register", json={"username": username, "password": PASSWORD})
    assert register_resp.status_code == 200
    assert register_resp.json()["token_type"] == "bearer"
    assert register_resp.json()["access_token"]

    login_resp = client.post("/auth/login", json={"username": username, "password": PASSWORD})
    assert login_resp.status_code == 200
    assert login_resp.json()["access_token"]


def test_tokens_carry_the_role_claim(db_session):
    username = _unique_username()
    token = client.post("/auth/register", json={"username": username, "password": PASSWORD}).json()[
        "access_token"
    ]
    claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    assert claims["sub"] == username
    assert claims["role"] == "forensic_analyst"


def test_register_duplicate_username_rejected(db_session):
    username = _unique_username()
    client.post("/auth/register", json={"username": username, "password": PASSWORD})
    resp = client.post("/auth/register", json={"username": username, "password": "another_password_456"})
    assert resp.status_code == 409


def test_register_with_a_role_field_is_422_and_creates_no_row(db_session):
    username = _unique_username()
    resp = client.post(
        "/auth/register", json={"username": username, "password": PASSWORD, "role": "secops_lead"}
    )
    assert resp.status_code == 422
    assert _analyst_count(username) == 0
    assert _audit_rows("register", actor=username) == []


def test_register_creates_a_forensic_analyst_and_audits_it(db_session):
    username = _unique_username()
    assert client.post("/auth/register", json={"username": username, "password": PASSWORD}).status_code == 200
    with SessionLocal() as session:
        analyst = session.query(Analyst).filter(Analyst.username == username).one()
        assert analyst.role == "forensic_analyst"
    entries = _audit_rows("register", actor=username)
    assert len(entries) == 1
    assert entries[0].detail == {"role": "forensic_analyst"}
    assert _chain_is_valid()


def test_login_is_audited_and_a_failed_login_is_not(db_session):
    username = _unique_username()
    client.post("/auth/register", json={"username": username, "password": PASSWORD})
    assert (
        client.post("/auth/login", json={"username": username, "password": "wrong_password"}).status_code
        == 401
    )
    assert _audit_rows("login", actor=username) == []

    assert client.post("/auth/login", json={"username": username, "password": PASSWORD}).status_code == 200
    entries = _audit_rows("login", actor=username)
    assert len(entries) == 1
    assert entries[0].detail == {"role": "forensic_analyst"}
    assert _chain_is_valid()


def test_login_nonexistent_user_rejected(db_session):
    resp = client.post("/auth/login", json={"username": "nonexistent_user_xyz", "password": "whatever123"})
    assert resp.status_code == 401


def test_no_token_is_401_with_a_bearer_challenge_never_403(db_session):
    for path in PROTECTED_PATHS:
        resp = client.get(path)
        assert resp.status_code == 401, path
        assert resp.headers["www-authenticate"] == "Bearer", path


def test_a_non_bearer_scheme_is_401(db_session):
    resp = client.get("/auth/me", headers={"Authorization": "Basic dXNlcjpwYXNz"})
    assert resp.status_code == 401
    assert resp.headers["www-authenticate"] == "Bearer"


def test_garbage_expired_wrong_secret_and_deleted_analyst_tokens_are_401(db_session):
    headers = auth_headers("forensic_analyst")
    username = client.get("/auth/me", headers=headers).json()["username"]

    assert client.get("/auth/me", headers={"Authorization": "Bearer not-a-real-token"}).status_code == 401
    assert client.get("/auth/me", headers=_bearer(_signed_token(username, minutes=-5))).status_code == 401
    wrong_secret = _signed_token(username, secret="x" * 40)
    assert client.get("/auth/me", headers=_bearer(wrong_secret)).status_code == 401

    gone = client.get("/auth/me", headers=_bearer(_signed_token(_unique_username())))
    assert gone.status_code == 401
    assert gone.json()["detail"] == "Analyst no longer exists"


def test_db_role_wins_over_a_forged_role_claim_that_claims_more(db_session):
    analyst = make_analyst("forensic_analyst")
    forged = _bearer(_signed_token(analyst.username, "secops_lead"))  # real secret, forged claim

    assert client.get("/users", headers=forged).status_code == 403
    assert client.get("/users", headers=forged).json()["detail"] == "Missing capability: manage_users"
    me = client.get("/auth/me", headers=forged).json()
    assert me["role"] == "forensic_analyst"
    assert me["capabilities"] == ["inject_scenario"]


def test_db_role_wins_over_a_stale_role_claim_that_claims_less(db_session):
    analyst = make_analyst("secops_lead")
    stale = _bearer(_signed_token(analyst.username, "forensic_analyst"))
    assert client.get("/users", headers=stale).status_code == 200


def test_me_returns_identity_capabilities_and_token_expiry(db_session):
    headers = auth_headers("red_team_auditor")
    body = client.get("/auth/me", headers=headers).json()
    assert set(body) == {"analyst_id", "username", "role", "capabilities", "token_expires_at"}
    assert body["role"] == "red_team_auditor"
    assert body["capabilities"] == ["inject_scenario", "override_fault_weights"]
    uuid.UUID(body["analyst_id"])
    expires = datetime.fromisoformat(body["token_expires_at"])
    remaining = expires - datetime.now(timezone.utc)
    assert (
        timedelta(minutes=settings.jwt_expire_minutes - 2)
        < remaining
        <= timedelta(minutes=settings.jwt_expire_minutes)
    )


def test_get_current_user_is_a_thin_wrapper_returning_the_username():
    analyst = CurrentAnalyst(
        analyst_id=uuid.uuid4(),
        username="alice",
        role="secops_lead",
        token_expires_at=datetime.now(timezone.utc),
    )
    assert get_current_user(analyst) == "alice"


def test_create_access_token_round_trips_the_role_claim():
    token = create_access_token("bob", "watchdog_supervisor")
    claims = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    assert claims["sub"] == "bob"
    assert claims["role"] == "watchdog_supervisor"


@pytest.mark.parametrize("role", ["secops_lead", "forensic_analyst"])
def test_fixture_login_returns_a_working_token(db_session, role):
    headers = auth_headers(role)
    assert client.get("/auth/me", headers=headers).json()["role"] == role
