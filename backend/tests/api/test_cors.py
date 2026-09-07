"""Regression test for a real bug hit live: Vite auto-increments its port
(5173 -> 5174 -> ...) whenever the default is already taken, which happens
often in practice. A hardcoded single-origin CORS allowlist silently breaks
the browser the moment that happens - caught live via the browser console's
"No 'Access-Control-Allow-Origin' header" error, not by any test until now.
"""

from fastapi.testclient import TestClient

from backend.api.main import app

client = TestClient(app)


def test_cors_allows_any_localhost_port():
    for port in (5173, 5174, 5175, 3000):
        origin = f"http://localhost:{port}"
        resp = client.options(
            "/auth/register",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert resp.status_code == 200
        assert resp.headers.get("access-control-allow-origin") == origin


def test_cors_allows_127_0_0_1_too():
    origin = "http://127.0.0.1:5173"
    resp = client.options(
        "/auth/register",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert resp.headers.get("access-control-allow-origin") == origin


def test_cors_rejects_non_localhost_origin():
    resp = client.options(
        "/auth/register",
        headers={
            "Origin": "http://evil.example.com",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    # Starlette's CORS middleware doesn't 403 a rejected preflight - it just
    # omits the allow-origin header, which is what makes the browser block it.
    assert "access-control-allow-origin" not in resp.headers
