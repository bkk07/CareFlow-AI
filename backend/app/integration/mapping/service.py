"""Mapping helpers: idempotent internal ↔ external links."""

import uuid

from sqlalchemy.exc import IntegrityError
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
    try:
        session.commit()
    except IntegrityError:
        # R4: concurrent first-time syncs race the same link — return the
        # winner instead of 500ing the loser.
        session.rollback()
        winner = get_mapping(session, hospital_id, entity_type, internal_id)
        if winner is not None:
            return winner
        # Unique on (hospital, entity, external_id) fired instead: fetch by
        # external side.
        winner = (
            session.query(ExternalIdentifierMapping)
            .filter(
                ExternalIdentifierMapping.hospital_id == hospital_id,
                ExternalIdentifierMapping.entity_type == entity_type,
                ExternalIdentifierMapping.external_id == external_id,
            )
            .first()
        )
        if winner is not None:
            return winner
        raise
    session.refresh(mapping)
    return mapping
