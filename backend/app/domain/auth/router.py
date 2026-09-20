"""Auth endpoints: register / login / refresh / me."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import RequestContext, get_current_context, require_role
from app.core.security import (
    TokenError,
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.domain.auth.models import HOSPITAL_SCOPED_ROLES, Role, User
from app.domain.auth.schemas import (
    LoginIn,
    RefreshIn,
    RegisterIn,
    TokenOut,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_tokens(user: User) -> TokenOut:
    return TokenOut(
        access_token=create_access_token(user.id, user.role.value, user.hospital_id),
        refresh_token=create_refresh_token(user.id),
    )


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def register(body: RegisterIn, db: Session = Depends(get_db)) -> User:
    # Privileged roles are never self-registered here:
    # - hospital_admin accounts are provisioned via POST /hospitals
    #   (first admin) or POST /hospitals/{id}/staff (invited by an admin).
    # - platform_admin has no inviter by definition, so only the very
    #   first platform_admin account (deployment bootstrap) may be
    #   created through this endpoint.
    if body.role == Role.hospital_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="hospital_admin accounts must be created through hospital "
            "registration or staff invitation, not self-registration",
        )
    if body.role == Role.platform_admin:
        existing_admin = (
            db.query(User.id).filter(User.role == Role.platform_admin).first()
        )
        if existing_admin is not None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="platform_admin accounts can only be created when no "
                "platform administrator exists yet",
            )
    if body.role in HOSPITAL_SCOPED_ROLES and body.hospital_id is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"hospital_id is required for role {body.role.value}",
        )
    if body.role not in HOSPITAL_SCOPED_ROLES and body.hospital_id is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"hospital_id must not be set for role {body.role.value}",
        )
    user = User(
        email=body.email.lower(),
        password_hash=hash_password(body.password),
        role=body.role,
        hospital_id=body.hospital_id,
        is_active=True,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is already registered",
        ) from None
    db.refresh(user)
    return user


@router.post("/login", response_model=TokenOut)
def login(body: LoginIn, db: Session = Depends(get_db)) -> TokenOut:
    user = db.query(User).filter(User.email == body.email.lower()).first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is inactive",
        )
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenOut)
def refresh(body: RefreshIn, db: Session = Depends(get_db)) -> TokenOut:
    try:
        payload = decode_token(body.refresh_token)
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)
        ) from None
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not a refresh token",
        )
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, AttributeError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token subject",
        ) from None
    user = db.get(User, user_id)
    # Inactive/suspended users cannot mint new tokens, even with a valid
    # (pre-suspension) refresh token.
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
    return _issue_tokens(user)


@router.get("/me", response_model=UserOut)
def me(
    ctx: RequestContext = Depends(get_current_context),
    db: Session = Depends(get_db),
) -> User:
    user = db.get(User, ctx.user_id)
    if user is None:  # pragma: no cover — context guarantees existence
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )
    return user


@router.get("/platform-ping")
def platform_ping(
    ctx: RequestContext = Depends(require_role(Role.platform_admin)),
) -> dict:
    return {"ok": True, "user_id": str(ctx.user_id)}
