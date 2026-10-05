"""App wiring after the router and schema split: every route family is mounted, the moved routes
keep their paths, and the schema package still exports every original name.
"""

from fastapi.testclient import TestClient

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


def test_legacy_scenario_websocket_is_still_mounted_and_accepts_a_connection():
    with TestClient(app).websocket_connect("/ws/scenarios/DDoS"):
        pass  # the handshake succeeds; leaving the block closes the feed


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
