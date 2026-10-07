"""Register, login and the current-analyst view (SKILL-security.md Section 2). Register and login are
rate-limited by client IP (brute force and account-creation spam), and both write an audit entry in
the same transaction as the account change.
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import IntegrityError

from backend.api.auth import (
    CurrentAnalyst,
    create_access_token,
    get_current_analyst,
    hash_password,
    verify_password,
)
from backend.api.rate_limit import client_ip, enforce_rate_limit
from backend.api.rbac import capabilities_for
from backend.api.schemas import LoginRequest, RegisterRequest, TokenResponse
from backend.api.schemas.auth import MeOut
from backend.db.audit import append_entry
from backend.db.models import Analyst
from backend.db.session import SessionLocal

router = APIRouter(prefix="/auth", tags=["auth"])

DEFAULT_ROLE = "forensic_analyst"


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, request: Request) -> TokenResponse:
    enforce_rate_limit("register", client_ip(request), limit=5, window_seconds=60)

    password_hash = hash_password(payload.password)
    session = SessionLocal()
    try:
        session.add(Analyst(username=payload.username, password_hash=password_hash, role=DEFAULT_ROLE))
        # append_entry flushes the new row, so a duplicate username raises here, before the audit row exists.
        append_entry(session, actor=payload.username, action="register", detail={"role": DEFAULT_ROLE})
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already taken") from exc
    finally:
        session.close()

    return TokenResponse(access_token=create_access_token(payload.username, DEFAULT_ROLE))


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, request: Request) -> TokenResponse:
    enforce_rate_limit("login", client_ip(request), limit=10, window_seconds=60)

    session = SessionLocal()
    try:
        analyst = session.query(Analyst).filter(Analyst.username == payload.username).one_or_none()
        if analyst is None or not verify_password(payload.password, analyst.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password"
            )
        username, role = analyst.username, analyst.role
        append_entry(session, actor=username, action="login", detail={"role": role})
        session.commit()
    finally:
        session.close()

    return TokenResponse(access_token=create_access_token(username, role))


@router.get("/me", response_model=MeOut)
def me(analyst: CurrentAnalyst = Depends(get_current_analyst)) -> MeOut:
    return MeOut(
        analyst_id=str(analyst.analyst_id),
        username=analyst.username,
        role=analyst.role,
        capabilities=capabilities_for(analyst.role),
        token_expires_at=analyst.token_expires_at,
    )
