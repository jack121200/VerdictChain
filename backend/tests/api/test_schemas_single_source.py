"""ST1: every Pydantic model the API uses is defined in backend/api/schemas/ (the Metric envelope in
backend/api/metrics.py is the one shared exception). A model written inline in a route module fails here.
"""

import importlib
import inspect
import pkgutil

from pydantic import BaseModel
from pydantic_settings import BaseSettings

import backend.api
from backend.api.main import app

ALLOWED_HOMES = ("backend.api.schemas.", "backend.api.metrics")
FRAMEWORK_SCHEMAS = {"HTTPValidationError", "ValidationError"}


def _models_defined_in_api() -> list[type[BaseModel]]:
    found = []
    for info in pkgutil.walk_packages(backend.api.__path__, "backend.api."):
        module = importlib.import_module(info.name)
        for obj in vars(module).values():
            is_model = (
                inspect.isclass(obj) and issubclass(obj, BaseModel) and not issubclass(obj, BaseSettings)
            )
            if is_model and obj.__module__ == module.__name__:  # BaseSettings reads config, it is no schema
                found.append(obj)
    return found


def test_no_model_is_defined_inline_in_a_route_or_other_api_module():
    misplaced = [
        f"{model.__module__}.{model.__name__}"
        for model in _models_defined_in_api()
        if not model.__module__.startswith(ALLOWED_HOMES)
    ]
    assert misplaced == []


def test_every_openapi_schema_comes_from_the_schemas_package():
    known = {model.__name__ for model in _models_defined_in_api()} | FRAMEWORK_SCHEMAS
    unknown = [
        name
        for name in app.openapi()["components"]["schemas"]
        if name not in known and not name.startswith("Metric_")  # Metric[T] is named per parameter
    ]
    assert unknown == []
