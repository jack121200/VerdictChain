"""Request logging middleware (BE10, backend/api/request_logging.py): one structured line per request, the
route template instead of the path, an X-Request-ID header, a slow-request WARNING, and nothing sensitive.
"""

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.api.main import app
from backend.api.request_logging import (
    REQUEST_ID_HEADER,
    RequestLoggingMiddleware,
    RequestLogSettings,
)

LOGGER = "verdictchain.request"
client = TestClient(app)


@pytest.fixture()
def lines(caplog):
    caplog.set_level(logging.INFO, logger=LOGGER)
    return lambda: [r for r in caplog.records if r.name == LOGGER]


def _tiny_app(slow_ms: float) -> FastAPI:
    tiny = FastAPI()
    tiny.add_middleware(RequestLoggingMiddleware, slow_ms=slow_ms)

    @tiny.get("/ok/{item_id}")
    def ok(item_id: str) -> dict:
        return {"item": item_id}

    @tiny.get("/boom")
    def boom() -> dict:
        raise RuntimeError("boom")

    return tiny


def test_one_structured_line_per_request(lines):
    response = client.get("/health")

    (record,) = lines()
    assert record.levelno == logging.INFO
    assert (record.http_method, record.http_route, record.http_status) == ("GET", "/health", 200)
    assert record.duration_ms >= 0
    assert record.request_id == response.headers[REQUEST_ID_HEADER]
    message = record.getMessage()
    assert message.startswith("request method=GET route=/health status=200 duration_ms=")
    assert message.endswith(f"request_id={record.request_id}")


def test_the_route_template_is_logged_not_the_concrete_path(lines):
    concrete = "11111111-2222-3333-4444-555555555555"

    response = client.get(f"/investigations/{concrete}")

    (record,) = lines()
    assert response.status_code == 401
    assert record.http_route == "/investigations/{investigation_id}"
    assert record.http_status == 401
    assert concrete not in record.getMessage()


def test_an_unmatched_path_is_logged_as_unmatched(lines):
    client.get("/no/such/path/secret-sentinel-4417")

    (record,) = lines()
    assert (record.http_route, record.http_status) == ("<unmatched>", 404)
    assert "secret-sentinel-4417" not in record.getMessage()


def test_every_response_carries_a_fresh_request_id(lines):
    first = client.get("/health").headers[REQUEST_ID_HEADER]
    second = client.get("/health").headers[REQUEST_ID_HEADER]

    assert first != second and len(first) == 32
    assert {r.request_id for r in lines()} == {first, second}


def test_a_sane_incoming_request_id_is_reused(lines):
    response = client.get("/health", headers={REQUEST_ID_HEADER: "web-4f2a.9_Z"})

    assert response.headers[REQUEST_ID_HEADER] == "web-4f2a.9_Z"
    assert lines()[0].request_id == "web-4f2a.9_Z"


@pytest.mark.parametrize(
    "bad", ["has space", "x" * 65, "semi;colon", 'quote"mark', "a=b request_id=forged", ""]
)
def test_an_unsafe_incoming_request_id_is_replaced(lines, bad):
    response = client.get("/health", headers={REQUEST_ID_HEADER: bad})

    issued = response.headers[REQUEST_ID_HEADER]
    assert issued != bad and len(issued) == 32
    assert lines()[0].request_id == issued


def test_a_slow_request_is_logged_at_warning(lines):
    slow = TestClient(_tiny_app(slow_ms=0.0))
    fast = TestClient(_tiny_app(slow_ms=60_000.0))

    slow.get("/ok/1")
    fast.get("/ok/1")

    slow_record, fast_record = lines()
    assert slow_record.levelno == logging.WARNING
    assert slow_record.getMessage().startswith("slow request method=GET route=/ok/{item_id} status=200")
    assert fast_record.levelno == logging.INFO
    assert fast_record.getMessage().startswith("request method=GET")


def test_the_slow_threshold_defaults_to_one_second_and_comes_from_the_environment(monkeypatch):
    monkeypatch.delenv("SLOW_REQUEST_MS", raising=False)
    assert RequestLogSettings(_env_file=None).slow_request_ms == 1000.0
    monkeypatch.setenv("SLOW_REQUEST_MS", "250")
    assert RequestLogSettings(_env_file=None).slow_request_ms == 250.0
    assert RequestLoggingMiddleware(app=lambda *_: None).slow_ms == 250.0
    monkeypatch.setenv("SLOW_REQUEST_MS", "0")
    with pytest.raises(ValidationError):
        RequestLogSettings(_env_file=None)


def test_an_unhandled_error_is_logged_as_500(lines):
    crashing = TestClient(_tiny_app(slow_ms=60_000.0), raise_server_exceptions=False)

    response = crashing.get("/boom")

    assert response.status_code == 500
    (record,) = lines()
    assert (record.http_route, record.http_status) == ("/boom", 500)


def test_no_body_header_or_query_string_reaches_the_log(lines, caplog):
    secrets = ("bearer-sentinel-1181", "query-sentinel-2292", "password-sentinel-3303")

    client.get(f"/health?token={secrets[1]}", headers={"Authorization": f"Bearer {secrets[0]}"})
    client.post("/auth/login", json={"username": "nobody", "password": secrets[2]})

    assert len(lines()) == 2
    for secret in secrets:
        assert secret not in caplog.text


def test_websocket_connections_are_not_logged(lines, caplog):
    with pytest.raises(Exception):  # noqa: B017 - a bad ticket closes the socket with 4401
        with client.websocket_connect("/ws/events?ticket=ticket-sentinel-4414") as socket:
            socket.receive_json()

    assert lines() == []
    assert "ticket-sentinel-4414" not in caplog.text


def test_cors_exposes_the_request_id_header_to_the_browser():
    response = client.get("/health", headers={"Origin": "http://localhost:5173"})

    assert response.headers["access-control-expose-headers"] == REQUEST_ID_HEADER
