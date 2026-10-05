import pytest
from fastapi.testclient import TestClient

from backend.api.auth import verify_password
from backend.api.main import app
from backend.tests.fixtures.auth import TEST_PASSWORD, auth_headers, make_analyst

client = TestClient(app)


def test_make_analyst_stores_a_bcrypt_hash_and_the_role(db_session):
    analyst = make_analyst("secops_lead")
    assert analyst.role == "secops_lead"
    assert analyst.password_hash.startswith("$2")
    assert verify_password(TEST_PASSWORD, analyst.password_hash)


def test_make_analyst_rejects_an_unknown_role(db_session):
    with pytest.raises(ValueError, match="unknown role"):
        make_analyst("root")


def test_auth_headers_log_in_and_the_header_opens_a_protected_route(db_session):
    headers = auth_headers("forensic_analyst")
    assert headers["Authorization"].startswith("Bearer ")
    assert client.get("/investigations", headers=headers).status_code == 200


def test_auth_headers_create_a_fresh_analyst_on_each_call(db_session):
    first = auth_headers("secops_lead")
    second = auth_headers("secops_lead")
    assert first["Authorization"] != second["Authorization"]
