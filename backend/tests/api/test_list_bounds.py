"""Bounded list endpoints (BE8): /users takes limit (default 200, max 1000) and offset, /response-actions
takes offset next to its existing limit, out-of-range values are 422, and no GET route can return an
unbounded array unless it is bounded by construction.
"""

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from backend.api.auth import hash_password
from backend.api.main import app
from backend.db.models import Analyst
from backend.tests.fixtures.read_seed import BASE_TIME, add_action, add_investigation, bearer_for

client = TestClient(app)

# Arrays whose size is fixed by the code: the three investigators and the eight scenario labels.
BOUNDED_BY_CONSTRUCTION = {"/agents/fleet", "/scenarios"}


def _add_users(db_session, count: int) -> None:
    password_hash = hash_password("a_strong_password_123")  # hashed once: bcrypt is slow
    for index in range(count):
        db_session.add(
            Analyst(username=f"bulk_{index:04d}", password_hash=password_hash, role="forensic_analyst")
        )
    db_session.commit()


def test_users_default_limit_is_200_and_offset_reaches_the_rest(db_session):
    _add_users(db_session, 201)
    headers = bearer_for("secops_lead")  # the 202nd analyst

    page = client.get("/users", headers=headers).json()
    rest = client.get("/users?offset=200", headers=headers).json()

    assert len(page) == 200 and len(rest) == 2
    assert {row["username"] for row in page}.isdisjoint(row["username"] for row in rest)


def test_users_limit_and_offset_page_in_a_stable_order(db_session):
    _add_users(db_session, 5)
    headers = bearer_for("secops_lead")
    everyone = [row["username"] for row in client.get("/users", headers=headers).json()]

    first = [row["username"] for row in client.get("/users?limit=2", headers=headers).json()]
    second = [row["username"] for row in client.get("/users?limit=2&offset=2", headers=headers).json()]

    assert len(everyone) == 6
    assert first == everyone[:2] and second == everyone[2:4]


@pytest.mark.parametrize("query", ["limit=0", "limit=1001", "limit=-1", "offset=-1", "limit=abc"])
def test_users_out_of_range_paging_is_422(db_session, query):
    headers = bearer_for("secops_lead")

    assert client.get(f"/users?{query}", headers=headers).status_code == 422


def test_users_limit_1000_is_allowed_and_the_shape_is_unchanged(db_session):
    headers = bearer_for("secops_lead")

    response = client.get("/users?limit=1000", headers=headers)

    assert response.status_code == 200
    assert set(response.json()[0]) == {"analyst_id", "username", "role", "created_at"}


def test_users_still_needs_manage_users(db_session):
    assert client.get("/users?limit=1", headers=bearer_for("forensic_analyst")).status_code == 403


def _seed_actions(db_session, count: int) -> list[str]:
    inv = add_investigation(db_session)
    ids = []
    for index in range(count):
        row = add_action(db_session, inv.investigation_id, target=f"U{index}")
        row.created_at = BASE_TIME + timedelta(minutes=index)  # newest first is index 4, 3, 2, ...
        db_session.flush()
        ids.append(f"U{index}")
    db_session.commit()
    return ids


def test_response_actions_offset_pages_newest_first(db_session):
    _seed_actions(db_session, 5)
    headers = bearer_for("forensic_analyst")

    everything = [r["target"] for r in client.get("/response-actions", headers=headers).json()]
    page = [r["target"] for r in client.get("/response-actions?limit=2&offset=2", headers=headers).json()]
    past_the_end = client.get("/response-actions?offset=5", headers=headers).json()

    assert everything == ["U4", "U3", "U2", "U1", "U0"]
    assert page == ["U2", "U1"]
    assert past_the_end == []


@pytest.mark.parametrize("query", ["limit=0", "limit=201", "offset=-1"])
def test_response_actions_out_of_range_paging_is_422(db_session, query):
    headers = bearer_for("forensic_analyst")

    assert client.get(f"/response-actions?{query}", headers=headers).status_code == 422


def _parameter(path: str, name: str) -> dict:
    parameters = app.openapi()["paths"][path]["get"]["parameters"]
    return next(p["schema"] for p in parameters if p["name"] == name)


def test_existing_defaults_and_maximums_are_unchanged():
    assert _parameter("/response-actions", "limit")["default"] == 100
    assert _parameter("/response-actions", "limit")["maximum"] == 200
    assert _parameter("/citations", "limit")["default"] == 50
    assert _parameter("/citations", "limit")["maximum"] == 200
    assert _parameter("/users", "limit") | {"title": ""} == {
        "type": "integer",
        "minimum": 1,
        "maximum": 1000,
        "default": 200,
        "title": "",
    }
    assert _parameter("/users", "offset")["default"] == 0


def test_every_get_route_that_returns_an_array_has_a_limit():
    """A new list route without a limit fails here: add `limit`, or list it as bounded by construction."""
    unbounded = []
    for path, operations in app.openapi()["paths"].items():
        get = operations.get("get")
        if get is None:
            continue
        schema = (
            get["responses"].get("200", {}).get("content", {}).get("application/json", {}).get("schema", {})
        )
        if schema.get("type") != "array" or path in BOUNDED_BY_CONSTRUCTION:
            continue
        limits = [p for p in get.get("parameters", []) if p["name"] == "limit"]
        if not limits or "maximum" not in limits[0]["schema"]:
            unbounded.append(path)
    assert unbounded == []
