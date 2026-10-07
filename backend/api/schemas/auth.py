"""Request and response models for registration, login and the current-analyst view."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class RegisterRequest(BaseModel):
    # extra="forbid": a role field is a 422. New analysts are always forensic_analyst (plan section 3.6).
    model_config = ConfigDict(extra="forbid")

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"


class MeOut(BaseModel):
    analyst_id: str
    username: str
    role: str
    capabilities: list[str]
    token_expires_at: datetime
