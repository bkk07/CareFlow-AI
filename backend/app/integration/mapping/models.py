"""Internal ↔ vendor identifier links (our table, not the vendor's)."""

import enum
import uuid

from sqlalchemy import Enum, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class MappingEntityType(str, enum.Enum):
    patient = "patient"
    doctor = "doctor"
    facility = "facility"
    appointment = "appointment"


class ExternalIdentifierMapping(Base):
    __tablename__ = "external_identifier_mappings"
    __table_args__ = (
        UniqueConstraint("hospital_id", "entity_type", "internal_id"),
        UniqueConstraint("hospital_id", "entity_type", "external_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    hospital_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False, index=True)
    entity_type: Mapped[MappingEntityType] = mapped_column(
        Enum(MappingEntityType, name="mapping_entity", validate_strings=True),
        nullable=False,
    )
    internal_id: Mapped[uuid.UUID] = mapped_column(Uuid, nullable=False)
    external_id: Mapped[str] = mapped_column(String(100), nullable=False)
    # Reserved for the future HealthcareSystemConnection entity; unset until
    # a hospital connects a real (non-mock) vendor.
    healthcare_system_connection_id: Mapped[str | None] = mapped_column(
        String(100), nullable=True, default=None
    )


__all__ = ["Base", "ExternalIdentifierMapping", "MappingEntityType"]
