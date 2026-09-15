"""Request identity + RBAC dependencies (reused by every router)."""

import uuid
from typing import Callable

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.security import TokenError, decode_token
from app.domain.auth.models import Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


class RequestContext(BaseModel):
    user_id: uuid.UUID
    role: Role
    hospital_id: uuid.UUID | None


def get_current_context(
    token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)
) -> RequestContext:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
    except TokenError:
        raise credentials_exc from None
    if payload.get("type") != "access":
        raise credentials_exc
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, AttributeError, TypeError):
        raise credentials_exc from None

    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise credentials_exc
    # Source of truth is the DB row, not the (possibly stale) JWT claims.
    return RequestContext(
        user_id=user.id, role=user.role, hospital_id=user.hospital_id
    )


def require_role(*roles: Role) -> Callable[[RequestContext], RequestContext]:
    def checker(ctx: RequestContext = Depends(get_current_context)) -> RequestContext:
        if ctx.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient role for this operation",
            )
        return ctx

    return checker
