"""Mapping helpers: idempotent internal ↔ external links."""

import uuid

from sqlalchemy.orm import Session

from app.integration.mapping.models import (
    ExternalIdentifierMapping,
    MappingEntityType,
)


def get_mapping(
    session: Session,
    hospital_id: uuid.UUID,
    entity_type: MappingEntityType,
    internal_id: uuid.UUID,
) -> ExternalIdentifierMapping | None:
    return (
        session.query(ExternalIdentifierMapping)
        .filter(
            ExternalIdentifierMapping.hospital_id == hospital_id,
            ExternalIdentifierMapping.entity_type == entity_type,
            ExternalIdentifierMapping.internal_id == internal_id,
        )
        .first()
    )


def get_or_create_mapping(
    session: Session,
    hospital_id: uuid.UUID,
    entity_type: MappingEntityType,
    internal_id: uuid.UUID,
    external_id: str,
    healthcare_system_connection_id: str | None = None,
) -> ExternalIdentifierMapping:
    existing = get_mapping(session, hospital_id, entity_type, internal_id)
    if existing is not None:
        return existing
    mapping = ExternalIdentifierMapping(
        hospital_id=hospital_id,
        entity_type=entity_type,
        internal_id=internal_id,
        external_id=external_id,
        healthcare_system_connection_id=healthcare_system_connection_id,
    )
    session.add(mapping)
    session.commit()
    session.refresh(mapping)
    return mapping
