"""ehr/patient_mapping: one patient, one vendor record, forever."""

import uuid

from app.domain.auth.models import User
from app.integration.integration_service import IntegrationService
from app.integration.mapping.models import MappingEntityType
from app.integration.mapping.service import get_mapping
from tests.test_mcp_agent import seed_setup


def test_patient_mapped_once_then_reused(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrpat")
    patient = db.get(User, uuid.UUID(setup["patient"]["id"]))
    hospital_id = uuid.UUID(setup["hid"])
    integration = IntegrationService(session=db, connector=ehr_stub)

    first = integration.ensure_patient(hospital_id, patient)
    second = integration.ensure_patient(hospital_id, patient)
    assert first == second == "ext-patient-1"
    assert ehr_stub.ensure_patient_calls == 1
    row = get_mapping(db, hospital_id, MappingEntityType.patient, patient.id)
    assert row is not None
    assert row.external_id == "ext-patient-1"
