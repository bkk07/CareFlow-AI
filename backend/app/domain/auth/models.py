"""User identity model (Auth / RBAC / tenant isolation).

Patients are hospital-agnostic identities: `hospital_id` is NULL for
`platform_admin` and `patient` roles. Tenant scoping for patient data
happens on child rows (appointments, …), not on the user row.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Role(str, enum.Enum):
    platform_admin = "platform_admin"
    hospital_admin = "hospital_admin"
    doctor = "doctor"
    patient = "patient"


HOSPITAL_SCOPED_ROLES = {Role.hospital_admin, Role.doctor}


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[Role] = mapped_column(
        Enum(Role, name="user_role", validate_strings=True), nullable=False
    )
    hospital_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, nullable=True, index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now(),
    )


# Re-exported so Alembic autogenerate sees every model via one import.
__all__ = ["Base", "HOSPITAL_SCOPED_ROLES", "Role", "User"]
