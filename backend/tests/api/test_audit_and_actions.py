from fastapi.testclient import TestClient

from backend.api.main import app
from backend.db.audit import append_entry
from backend.db.models import ResponseAction
from backend.db.session import SessionLocal

client = TestClient(app)


def _auth_headers() -> dict:
    import uuid

    username = f"test_user_{uuid.uuid4().hex[:8]}"
    password = "a_strong_password_123"
    client.post("/auth/register", json={"username": username, "password": password})
    token = client.post("/auth/login", json={"username": username, "password": password}).json()[
        "access_token"
    ]
    return {"Authorization": f"Bearer {token}"}


def _non_auth_entries(entries: list[dict]) -> list[dict]:
    # register and login are audited (plan 3.6); these tests only check the entries they write.
    return [e for e in entries if e["action"] not in ("register", "login")]


def test_audit_trail_empty_chain_is_valid(db_session):
    headers = _auth_headers()
    resp = client.get("/audit-trail", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["chain_valid"] is True
    assert _non_auth_entries(resp.json()["entries"]) == []


def test_audit_trail_returns_entries_and_valid_chain(db_session):
    session = SessionLocal()
    try:
        append_entry(session, actor="self_healing", action="lock_account", detail={"target": "u1"})
        session.flush()  # SessionLocal has autoflush=False - next append_entry must see this as chain tail
        append_entry(session, actor="self_healing", action="trigger_audit", detail={"target": "u1"})
        session.commit()
    finally:
        session.close()

    headers = _auth_headers()
    resp = client.get("/audit-trail", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["chain_valid"] is True
    assert len(_non_auth_entries(body["entries"])) == 2


def test_response_actions_list_returns_all(db_session):
    session = SessionLocal()
    try:
        session.add(ResponseAction(action_type="lock_account", target="u1", reason="test", is_simulated=True))
        session.commit()
    finally:
        session.close()

    headers = _auth_headers()
    resp = client.get("/response-actions", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1
    assert resp.json()[0]["action_type"] == "lock_account"
