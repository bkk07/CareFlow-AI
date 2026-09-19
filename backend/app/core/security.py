"""Password hashing + JWT helpers (Auth / RBAC).

Token shapes:
- access:  {"sub": user_id, "role": ..., "hospital_id": ...|None,
             "type": "access", "exp": now+2days}
- refresh: {"sub": user_id, "type": "refresh", "exp": now+2days}

`hospital_id` inside the access token is a convenience claim only — every
request re-loads the user row in `get_current_context()` and uses the DB
value, so stale claims can never widen a tenant scope.
"""

import uuid
from datetime import datetime, timedelta, timezone

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.core.config import settings

_ph = PasswordHasher()


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, ValueError, AttributeError):
        return False


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(
    user_id: uuid.UUID, role: str, hospital_id: uuid.UUID | None
) -> str:
    payload = {
        "sub": str(user_id),
        "role": role,
        "hospital_id": str(hospital_id) if hospital_id else None,
        "type": "access",
        "exp": _utcnow()
        + timedelta(minutes=settings.access_token_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: uuid.UUID) -> str:
    payload = {
        "sub": str(user_id),
        "type": "refresh",
        "exp": _utcnow() + timedelta(days=settings.refresh_token_expire_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


class TokenError(ValueError):
    pass


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
    except jwt.ExpiredSignatureError as exc:
        raise TokenError("Token has expired") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenError("Invalid token") from exc
