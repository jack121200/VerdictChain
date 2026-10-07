import pytest
from fastapi.testclient import TestClient

from backend.api.main import app
from backend.api.rbac import CAPABILITIES, ROLES
from backend.tests.fixtures.auth import auth_headers

client = TestClient(app)

VALID_SETTINGS = {
    "eta": 0.15,
    "isolation_threshold": 0.30,
    "verdict_confidence_threshold": 0.80,
    "intake_paused": False,
}


def test_matrix_needs_a_token(db_session):
    assert client.get("/rbac/matrix").status_code == 401


def test_matrix_returns_the_roles_and_the_capability_map(db_session):
    resp = client.get("/rbac/matrix", headers=auth_headers("forensic_analyst"))
    assert resp.status_code == 200
    body = resp.json()
    assert body["roles"] == list(ROLES)
    assert body["capabilities"] == {name: sorted(roles) for name, roles in sorted(CAPABILITIES.items())}


@pytest.mark.parametrize("role", ROLES)
def test_every_role_can_read_the_matrix(db_session, role):
    assert client.get("/rbac/matrix", headers=auth_headers(role)).status_code == 200


def test_matrix_is_read_only(db_session):
    headers = auth_headers("secops_lead")
    assert client.post("/rbac/matrix", headers=headers, json={}).status_code == 405
    assert client.put("/rbac/matrix", headers=headers, json={}).status_code == 405


@pytest.mark.parametrize("role", ROLES)
def test_manage_users_is_granted_to_secops_lead_only(db_session, role):
    resp = client.get("/users", headers=auth_headers(role))
    if role == "secops_lead":
        assert resp.status_code == 200
    else:
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Missing capability: manage_users"


@pytest.mark.parametrize("role", ROLES)
def test_edit_settings_is_granted_to_secops_lead_only(db_session, role):
    resp = client.put("/settings", headers=auth_headers(role), json=VALID_SETTINGS)
    if role == "secops_lead":
        assert resp.status_code == 200
    else:
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Missing capability: edit_settings"
