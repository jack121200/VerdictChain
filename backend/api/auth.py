"""JWT auth (SKILL-security.md Section 2): hashed passwords (bcrypt), a
short-lived JWT on login, and a FastAPI dependency protected routes require.
"""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.config import settings
from backend.db.models import Analyst
from backend.db.session import SessionLocal

_bearer = HTTPBearer()


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def create_access_token(username: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def _decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    return username


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> str:
    """FastAPI dependency - protected routes take `username: str = Depends(get_current_user)`."""
    username = _decode_token(credentials.credentials)

    session = SessionLocal()
    try:
        analyst = session.query(Analyst).filter(Analyst.username == username).one_or_none()
    finally:
        session.close()

    if analyst is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Analyst no longer exists")
    return username
