"""Login/register (SKILL-security.md Section 2). Both endpoints are rate-limited
by client IP - login against brute-force, register against account-creation spam.
"""

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from backend.api.auth import create_access_token, hash_password, verify_password
from backend.api.rate_limit import client_ip, enforce_rate_limit
from backend.api.schemas import LoginRequest, RegisterRequest, TokenResponse
from backend.db.models import Analyst
from backend.db.session import SessionLocal

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, request: Request) -> TokenResponse:
    enforce_rate_limit("register", client_ip(request), limit=5, window_seconds=60)

    session = SessionLocal()
    try:
        analyst = Analyst(username=payload.username, password_hash=hash_password(payload.password))
        session.add(analyst)
        try:
            session.commit()
        except IntegrityError as exc:
            session.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="Username already taken"
            ) from exc
    finally:
        session.close()

    return TokenResponse(access_token=create_access_token(payload.username))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request) -> TokenResponse:
    enforce_rate_limit("login", client_ip(request), limit=10, window_seconds=60)

    session = SessionLocal()
    try:
        analyst = session.query(Analyst).filter(Analyst.username == payload.username).one_or_none()
    finally:
        session.close()

    if analyst is None or not verify_password(payload.password, analyst.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    return TokenResponse(access_token=create_access_token(payload.username))
