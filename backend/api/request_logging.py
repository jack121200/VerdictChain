"""One structured log line per HTTP request, and an X-Request-ID response header (BE10).

The line carries the method, the route template (`/investigations/{investigation_id}`, never the concrete
path), the status, the duration in ms and the request id. It never carries a body, a header, a query string
or a path parameter, so a token or a password in any of those cannot reach the logs. A request slower than
the threshold is logged at WARNING as "slow request", otherwise at INFO.

An incoming X-Request-ID is reused when it is a short token, otherwise a new id is generated. WebSocket
connections are not logged here: their tickets travel in the query string.
"""

import logging
import re
import time
import uuid
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

logger = logging.getLogger("verdictchain.request")

REQUEST_ID_HEADER = "X-Request-ID"
_SANE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{1,64}")
UNMATCHED_ROUTE = "<unmatched>"


class RequestLogSettings(BaseSettings):
    """SLOW_REQUEST_MS in .env. Kept here, not in backend/config.py, which this module does not own."""

    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[2] / ".env", extra="ignore")

    slow_request_ms: float = Field(1000.0, gt=0)


def _request_id(scope: Scope) -> str:
    for name, value in scope["headers"]:
        if name == b"x-request-id":
            candidate = value.decode("latin-1")
            if _SANE_REQUEST_ID.fullmatch(candidate):
                return candidate
            break
    return uuid.uuid4().hex


class RequestLoggingMiddleware:
    def __init__(self, app: ASGIApp, slow_ms: float | None = None) -> None:
        self.app = app
        self.slow_ms = RequestLogSettings().slow_request_ms if slow_ms is None else slow_ms

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = _request_id(scope)
        started = time.perf_counter()
        status_code = 500  # what the client gets if the app raises before it sends a response

        async def send_with_request_id(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        try:
            await self.app(scope, receive, send_with_request_id)
        finally:
            self._log(scope, request_id, status_code, (time.perf_counter() - started) * 1000.0)

    def _log(self, scope: Scope, request_id: str, status_code: int, duration_ms: float) -> None:
        route = getattr(scope.get("route"), "path", None) or UNMATCHED_ROUTE
        method = scope["method"]
        slow = duration_ms > self.slow_ms
        logger.log(
            logging.WARNING if slow else logging.INFO,
            "%srequest method=%s route=%s status=%d duration_ms=%.1f request_id=%s",
            "slow " if slow else "",
            method,
            route,
            status_code,
            duration_ms,
            request_id,
            extra={
                "http_method": method,
                "http_route": route,
                "http_status": status_code,
                "duration_ms": round(duration_ms, 1),
                "request_id": request_id,
            },
        )
