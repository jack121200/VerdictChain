import uuid

from fastapi.testclient import TestClient

from backend.api.main import app

client = TestClient(app)


def _unique_username() -> str:
    return f"test_user_{uuid.uuid4().hex[:8]}"


def test_register_then_login_roundtrip(db_session):
    username = _unique_username()
    password = "a_strong_password_123"

    register_resp = client.post("/auth/register", json={"username": username, "password": password})
    assert register_resp.status_code == 200
    assert register_resp.json()["token_type"] == "bearer"
    assert register_resp.json()["access_token"]

    login_resp = client.post("/auth/login", json={"username": username, "password": password})
    assert login_resp.status_code == 200
    assert login_resp.json()["access_token"]


def test_register_duplicate_username_rejected(db_session):
    username = _unique_username()
    client.post("/auth/register", json={"username": username, "password": "a_strong_password_123"})
    resp = client.post("/auth/register", json={"username": username, "password": "another_password_456"})
    assert resp.status_code == 409


def test_login_wrong_password_rejected(db_session):
    username = _unique_username()
    client.post("/auth/register", json={"username": username, "password": "a_strong_password_123"})
    resp = client.post("/auth/login", json={"username": username, "password": "wrong_password"})
    assert resp.status_code == 401


def test_login_nonexistent_user_rejected(db_session):
    resp = client.post("/auth/login", json={"username": "nonexistent_user_xyz", "password": "whatever123"})
    assert resp.status_code == 401


def test_protected_route_requires_token():
    resp = client.get("/investigations")
    assert resp.status_code in (401, 403)  # HTTPBearer returns 403 when no header at all


def test_protected_route_rejects_garbage_token():
    resp = client.get("/investigations", headers={"Authorization": "Bearer not-a-real-token"})
    assert resp.status_code == 401
