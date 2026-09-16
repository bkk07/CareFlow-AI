"""ehr/provider_mapping: one doctor, one vendor provider, forever."""

import uuid

from app.domain.doctor.models import Doctor
from app.integration.integration_service import IntegrationService
from app.integration.mapping.models import MappingEntityType
from app.integration.mapping.service import get_mapping
from tests.test_mcp_agent import seed_setup


def test_doctor_mapped_once_then_reused(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrprov")
    doctor = db.get(Doctor, uuid.UUID(setup["doctor"]["id"]))
    hospital_id = uuid.UUID(setup["hid"])
    integration = IntegrationService(session=db, connector=ehr_stub)

    first = integration.ensure_doctor(hospital_id, doctor)
    second = integration.ensure_doctor(hospital_id, doctor)
    assert first == second == "ext-provider-1"
    assert ehr_stub.ensure_provider_calls == 1
    row = get_mapping(db, hospital_id, MappingEntityType.doctor, doctor.id)
    assert row is not None
    assert row.external_id == "ext-provider-1"
