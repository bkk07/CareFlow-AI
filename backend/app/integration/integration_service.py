"""IntegrationService — the ONLY caller of EHR connectors.

It owns the mapping lifecycle: vendor patient/provider/facility records
are ensured (looked up or created on first sync, never hardcoded) and the
links recorded; appointment calls delegate to the connector and write the
appointment link on success.
"""

import uuid
from datetime import datetime

from sqlalchemy.orm import Session

from app.core.config import settings
from app.domain.auth.models import User
from app.domain.doctor.models import Doctor
from app.domain.hospital.models import Hospital
from app.integration.connector_interface import (
    CreateAppointmentRequest,
    ExternalAppointment,
    UpdateAppointmentRequest,
)
from app.integration.mapping.models import MappingEntityType
from app.integration.mapping.service import get_mapping, get_or_create_mapping
from app.integration.mock_ehr.connector import MockEHRConnector


def build_default_connector() -> MockEHRConnector:
    return MockEHRConnector(
        base_url=settings.ehr_mock_base_url,
        timeout_s=settings.ehr_http_timeout_s,
    )


class IntegrationService:
    # The appointment calls below go through the EHRConnector protocol, but
    # vendor record sync (ensure_*) is inherently vendor-specific, so the
    # concrete mock connector is required until a second vendor exists.
    def __init__(
        self, session: Session, connector: MockEHRConnector | None = None
    ) -> None:
        self.session = session
        self.connector = connector or build_default_connector()

    # -- vendor record sync ------------------------------------------------------

    def ensure_patient(self, hospital_id: uuid.UUID, patient: User) -> str:
        existing = get_mapping(
            self.session, hospital_id, MappingEntityType.patient, patient.id
        )
        if existing is not None:
            return existing.external_id
        record = self.connector.ensure_patient(
            mrn=f"patient-{patient.id}", full_name=f"Patient {patient.email}"
        )
        return get_or_create_mapping(
            self.session,
            hospital_id,
            MappingEntityType.patient,
            patient.id,
            external_id=str(record["id"]),
        ).external_id

    def ensure_doctor(self, hospital_id: uuid.UUID, doctor: Doctor) -> str:
        existing = get_mapping(
            self.session, hospital_id, MappingEntityType.doctor, doctor.id
        )
        if existing is not None:
            return existing.external_id
        record = self.connector.ensure_provider(
            provider_code=f"doctor-{doctor.id}", full_name=doctor.name
        )
        return get_or_create_mapping(
            self.session,
            hospital_id,
            MappingEntityType.doctor,
            doctor.id,
            external_id=str(record["id"]),
        ).external_id

    def ensure_facility(self, hospital: Hospital) -> str:
        existing = get_mapping(
            self.session, hospital.id, MappingEntityType.facility, hospital.id
        )
        if existing is not None:
            return existing.external_id
        record = self.connector.ensure_facility(
            code=f"facility-{hospital.id}", name=hospital.name
        )
        return get_or_create_mapping(
            self.session,
            hospital.id,
            MappingEntityType.facility,
            hospital.id,
            external_id=str(record["id"]),
        ).external_id

    # -- appointment delegation ----------------------------------------------------

    def create_appointment(
        self,
        *,
        hospital: Hospital,
        patient: User,
        doctor: Doctor,
        start: datetime,
        end: datetime,
        idempotency_key: str,
        internal_appointment_id: uuid.UUID | None = None,
    ) -> ExternalAppointment:
        patient_ext = self.ensure_patient(hospital.id, patient)
        provider_ext = self.ensure_doctor(hospital.id, doctor)
        facility_ext = self.ensure_facility(hospital)
        result = self.connector.create_appointment(
            CreateAppointmentRequest(
                patient_external_id=patient_ext,
                provider_external_id=provider_ext,
                facility_external_id=facility_ext,
                start=start,
                end=end,
                idempotency_key=idempotency_key,
            )
        )
        if internal_appointment_id is not None:
            get_or_create_mapping(
                self.session,
                hospital.id,
                MappingEntityType.appointment,
                internal_appointment_id,
                external_id=result.external_id,
            )
        return result

    def update_appointment(
        self, external_id: str, start: datetime, end: datetime
    ) -> ExternalAppointment:
        return self.connector.update_appointment(
            external_id, UpdateAppointmentRequest(start=start, end=end)
        )

    def cancel_appointment(self, external_id: str) -> ExternalAppointment:
        return self.connector.cancel_appointment(external_id)

    def get_appointment(self, external_id: str) -> ExternalAppointment:
        return self.connector.get_appointment(external_id)

    def find_appointment_by_idempotency_key(
        self, idempotency_key: str
    ) -> ExternalAppointment | None:
        return self.connector.find_appointment_by_idempotency_key(idempotency_key)
