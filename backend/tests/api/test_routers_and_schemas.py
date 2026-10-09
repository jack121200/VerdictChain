"""App wiring after the router and schema split: every route family is mounted, the moved routes
keep their paths, and the schema package still exports every original name.
"""

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.api.main import app

_HTTP_METHODS = {"get", "post", "put", "patch", "delete", "head", "options"}


def _http_routes() -> set[tuple[str, str]]:
    """(METHOD, path) for every HTTP route. Read from the OpenAPI schema: FastAPI 0.141 nests included
    routers (app.routes holds _IncludedRouter objects), so walking app.routes would miss them.
    """
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method in _HTTP_METHODS
    }


def test_existing_route_families_are_mounted():
    http = _http_routes()
    assert ("POST", "/auth/register") in http
    assert ("POST", "/auth/login") in http
    assert ("POST", "/investigations/simulate") in http
    assert ("GET", "/investigations") in http
    assert ("GET", "/investigations/{investigation_id}") in http
    assert ("POST", "/investigations/{investigation_id}/feedback") in http
    assert ("GET", "/agents/fleet") in http
    assert ("GET", "/audit-trail") in http
    assert ("GET", "/response-actions") in http
    assert ("GET", "/health") in http


def test_the_legacy_unauthenticated_scenario_websocket_is_gone():
    """BE7: /ws/scenarios/{label} took no ticket. An unknown WebSocket path is refused at the handshake."""
    with pytest.raises(WebSocketDisconnect):
        with TestClient(app).websocket_connect("/ws/scenarios/DDoS"):
            pass


def test_the_ticketed_websocket_routes_are_still_mounted():
    for path in (
        "/ws/events?ticket=bad",
        "/ws/investigations/11111111-1111-1111-1111-111111111111?ticket=bad",
    ):
        with TestClient(app).websocket_connect(path) as socket:
            with pytest.raises(WebSocketDisconnect) as closed:
                socket.receive_json()
        assert closed.value.code == 4401  # accepted, then closed for the bad ticket: the route exists


def test_simulate_moved_to_its_own_module_with_the_same_path():
    import backend.api.routes.investigations as investigation_routes
    from backend.api.routes import simulate

    assert not hasattr(investigation_routes, "simulate_scenario")
    assert simulate.router.prefix == "/investigations"
    assert ("POST", "/investigations/simulate") in _http_routes()


def test_schema_package_re_exports_every_original_name():
    import backend.api.schemas as schemas

    original_names = (
        "RegisterRequest",
        "LoginRequest",
        "TokenResponse",
        "ScenarioLabel",
        "SimulateScenarioRequest",
        "CitedEvidenceOut",
        "DebateRoundOut",
        "CredibilityLogOut",
        "ResponseActionOut",
        "InvestigationSummaryOut",
        "InvestigationDetailOut",
        "FeedbackRequest",
        "AgentFleetEntryOut",
    )
    for name in original_names:
        assert hasattr(schemas, name), name
