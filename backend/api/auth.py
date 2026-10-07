"""JWT auth (SKILL-security.md Section 2): hashed passwords (bcrypt), a short-lived JWT on login, and
FastAPI dependencies that protected routes require.

The database is the authority for identity and role. The JWT carries a role claim, but it is advisory:
get_current_analyst re-reads the analyst row on every request, so a demoted analyst loses access at once.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.api.rbac import role_has
from backend.config import settings
from backend.db.models import Analyst
from backend.db.session import SessionLocal

# auto_error=False: a missing or malformed header reaches our code, which answers 401 (not FastAPI's 403).
_bearer = HTTPBearer(auto_error=False)
_UNAUTHORIZED_HEADERS = {"WWW-Authenticate": "Bearer"}


@dataclass(frozen=True)
class CurrentAnalyst:
    analyst_id: uuid.UUID
    username: str
    role: str  # read from the database on this request, never from the token
    token_expires_at: datetime


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(username: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": username, "role": role, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail=detail, headers=_UNAUTHORIZED_HEADERS
    )


def _decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise _unauthorized("Invalid or expired token") from exc
    if not isinstance(payload.get("sub"), str) or not isinstance(payload.get("exp"), int | float):
        raise _unauthorized("Invalid token payload")
    return payload


def get_current_analyst(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentAnalyst:
    """Authenticates the request. Missing, invalid, expired or deleted-analyst tokens all give 401."""
    if credentials is None:
        raise _unauthorized("Not authenticated")
    payload = _decode_token(credentials.credentials)

    with SessionLocal() as session:
        analyst = session.query(Analyst).filter(Analyst.username == payload["sub"]).one_or_none()
        if analyst is None:
            raise _unauthorized("Analyst no longer exists")
        return CurrentAnalyst(
            analyst_id=analyst.analyst_id,
            username=analyst.username,
            role=analyst.role,
            token_expires_at=datetime.fromtimestamp(payload["exp"], tz=timezone.utc),
        )


def get_current_user(analyst: CurrentAnalyst = Depends(get_current_analyst)) -> str:
    """Thin wrapper for routes that only need the username: `username: str = Depends(get_current_user)`."""
    return analyst.username


def require_capability(capability: str) -> Callable[..., CurrentAnalyst]:
    """Dependency factory: authenticates, then checks the DB role against the matrix (403 if denied)."""

    def _check(analyst: CurrentAnalyst = Depends(get_current_analyst)) -> CurrentAnalyst:
        if not role_has(analyst.role, capability):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=f"Missing capability: {capability}"
            )
        return analyst

    return _check
