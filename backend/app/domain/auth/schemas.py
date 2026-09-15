"""Auth request/response schemas."""

import uuid

from pydantic import BaseModel, EmailStr, Field

from app.domain.auth.models import Role


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    role: Role
    hospital_id: uuid.UUID | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class RefreshIn(BaseModel):
    refresh_token: str


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    role: Role
    hospital_id: uuid.UUID | None
    is_active: bool
