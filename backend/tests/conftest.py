"""Shared test fixtures: isolated SQLite DB + dependency overrides."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base, get_db
from app.domain.appointment.router import get_integration_service
from app.integration.connector_interface import (
    EHRConnectorError,
    ExternalAppointment,
)
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools import _base as tool_base
from app.domain.auth import models as auth_models  # noqa: F401 — register metadata
from app.domain.appointment import models as appointment_models  # noqa: F401
from app.reliability import models as reliability_models  # noqa: F401
from app.domain.doctor import models as doctor_models  # noqa: F401
from app.domain.hospital import models as hospital_models  # noqa: F401
from app.domain.hospital_config import models as config_models  # noqa: F401
from app.domain.patient import models as patient_models  # noqa: E402,F401 - register patient metadata
from app.domain.questionnaire import models as questionnaire_models  # noqa: F401
from app.integration.mock_ehr import models as mock_ehr_models  # noqa: F401
from app.integration.mapping import models as mapping_models  # noqa: F401
from app.mcp_server import models as mcp_models  # noqa: F401
from app.notification import models as notification_models  # noqa: F401
from app.workflow import models as workflow_models  # noqa: F401
from app.core import audit as audit_module  # noqa: F401
from app.main import app

# Tests must run with zero infrastructure: Celery eager mode executes
# published workflow events inline in-process, so `pytest` never blocks
# on a Redis broker connection. The eager task looks its execution row
# up in its own session (which never sees the test transaction), records
# "execution not found", and returns — handlers that need the test DB
# opt in explicitly via set_session_factory (see test_workflow.py).
from app.workflow.celery_app import celery_app  # noqa: E402

celery_app.conf.task_always_eager = True

# Same zero-infra rule for conversation memory: AIContext tries Redis on
# every get/save (each attempt stalls ~2s with no server running), so
# tests pin the documented process-local fallback store, which shares
# the same TTL semantics.
import app.ai.context.ai_context as _ai_context  # noqa: E402

_ai_context._redis = lambda: None  # noqa: E731

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base.metadata.create_all(bind=engine)

# Email/password of this test's bootstrapped platform_admin, if one has
# been created. Reset by the `db` fixture before every test.
_bootstrap_platform: dict | None = None


@pytest.fixture()
def db():
    global _bootstrap_platform
    _bootstrap_platform = None
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        # Full cleanup so tests never leak rows into each other.
        for table in reversed(Base.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()
        session.close()


@pytest.fixture()
def client(db):
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as c:
            yield c
    finally:
        app.dependency_overrides.clear()


def make_hospital_id() -> str:
    return str(uuid.uuid4())


class StubConnector:
    """Deterministic vendor stand-in for the Phase 16 testing pass.

    Mirrors the FakeConnector from test_mcp_agent: switchable create
    failures, an inspectable record store, and call counters so mapping
    tests can prove the second call never reaches the vendor.
    """

    def __init__(self) -> None:
        self.fail_create = False
        self.create_error: type[EHRConnectorError] = EHRConnectorError
        self.creates = 0
        self.ensure_patient_calls = 0
        self.ensure_provider_calls = 0
        self._records: dict[str, dict] = {}

    def ensure_patient(self, **kwargs):
        self.ensure_patient_calls += 1
        return {"id": "ext-patient-1"}

    def ensure_provider(self, **kwargs):
        self.ensure_provider_calls += 1
        return {"id": "ext-provider-1"}

    def ensure_facility(self, **kwargs):
        return {"id": "ext-facility-1"}

    def create_appointment(self, request):
        if self.fail_create:
            raise self.create_error("vendor down")
        self.creates += 1
        external_id = f"vendor-{request.idempotency_key}"
        self._records[external_id] = {
            "status": "scheduled",
            "start": request.start,
            "end": request.end,
        }
        return ExternalAppointment(
            external_id=external_id,
            status="scheduled",
            start=request.start,
            end=request.end,
        )

    def update_appointment(self, external_id, request):
        record = self._records.get(external_id)
        if record is None:
            from app.integration.connector_interface import EHRNotFoundError

            raise EHRNotFoundError("no such vendor record")
        record.update(
            {"status": "scheduled", "start": request.start, "end": request.end}
        )
        return ExternalAppointment(
            external_id=external_id,
            status="scheduled",
            start=request.start,
            end=request.end,
        )

    def cancel_appointment(self, external_id):
        record = self._records.get(external_id)
        if record is None:
            from app.integration.connector_interface import EHRNotFoundError

            raise EHRNotFoundError("no such vendor record")
        record["status"] = "cancelled"
        return ExternalAppointment(
            external_id=external_id,
            status=record["status"],
            start=record["start"],
            end=record["end"],
        )

    def get_appointment(self, external_id):
        record = self._records.get(external_id)
        if record is None:
            from app.integration.connector_interface import EHRNotFoundError

            raise EHRNotFoundError("no such vendor record")
        return ExternalAppointment(
            external_id=external_id,
            status=record["status"],
            start=record["start"],
            end=record["end"],
        )

    def find_appointment_by_idempotency_key(self, idempotency_key):
        external_id = f"vendor-{idempotency_key}"
        record = self._records.get(external_id)
        if record is None:
            return None
        return ExternalAppointment(
            external_id=external_id,
            status=record["status"],
            start=record["start"],
            end=record["end"],
        )


@pytest.fixture()
def ehr_stub(db):
    """Stubbed vendor for tools AND the REST booking route."""
    connector = StubConnector()
    stub = lambda session: IntegrationService(  # noqa: E731
        session=session, connector=connector
    )
    tool_base.set_integration_factory(stub)
    app.dependency_overrides[get_integration_service] = (
        lambda: IntegrationService(session=db, connector=connector)
    )
    yield connector
    app.dependency_overrides.clear()
    tool_base.set_integration_factory(None)


def approved_hospital(client, tag="x", platform=None):
    """Register + approve a hospital.

    Returns {"id", "owner", "platform", "admin_email"} where owner/platform
    are ready-to-use Authorization header dicts.

    Only the first platform_admin can self-register (deployment
    bootstrap); pass an existing hospital's ``platform`` headers when a
    test needs more than one hospital so all approvals share it.
    """
    uid = uuid.uuid4().hex[:6]
    payload = {
        "name": f"Hospital {tag}",
        "address": "1 Main St",
        "contact_email": f"contact-{tag}-{uid}@example.com",
        "contact_phone": "+1-555-0100",
        "admin_email": f"admin-{tag}-{uid}@example.com",
        "admin_password": "correct-horse-42",
    }
    reg = client.post("/hospitals", json=payload)
    assert reg.status_code == 201, reg.text
    hospital_id = reg.json()["id"]

    if platform is None:
        global _bootstrap_platform
        if _bootstrap_platform is None:
            root_email = f"root-{tag}-{uid}@example.com"
            assert (
                client.post(
                    "/auth/register",
                    json={
                        "email": root_email,
                        "password": "correct-horse-42",
                        "role": "platform_admin",
                    },
                ).status_code
                == 201
            )
            _bootstrap_platform = {
                "email": root_email,
                "password": "correct-horse-42",
            }
        ptokens = client.post(
            "/auth/login",
            json={
                "email": _bootstrap_platform["email"],
                "password": _bootstrap_platform["password"],
            },
        ).json()
        platform = {"Authorization": f"Bearer {ptokens['access_token']}"}

    approval = client.post(
        f"/platform/hospitals/{hospital_id}/approve", headers=platform
    )
    assert approval.status_code == 200, approval.text

    atokens = client.post(
        "/auth/login",
        json={"email": payload["admin_email"], "password": "correct-horse-42"},
    ).json()
    owner = {"Authorization": f"Bearer {atokens['access_token']}"}
    return {
        "id": hospital_id,
        "owner": owner,
        "platform": platform,
        "admin_email": payload["admin_email"],
    }
