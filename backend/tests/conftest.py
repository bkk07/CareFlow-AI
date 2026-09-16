"""Shared test fixtures: isolated SQLite DB + dependency overrides."""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.db import Base, get_db
from app.domain.auth import models as auth_models  # noqa: F401 — register metadata
from app.domain.appointment import models as appointment_models  # noqa: F401
from app.domain.doctor import models as doctor_models  # noqa: F401
from app.domain.hospital import models as hospital_models  # noqa: F401
from app.domain.hospital_config import models as config_models  # noqa: F401
from app.integration.mock_ehr import models as mock_ehr_models  # noqa: F401
from app.integration.mapping import models as mapping_models  # noqa: F401
from app.core import audit as audit_module  # noqa: F401
from app.main import app

engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)

Base.metadata.create_all(bind=engine)


@pytest.fixture()
def db():
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


def approved_hospital(client, tag="x"):
    """Register + approve a hospital.

    Returns {"id", "owner", "platform", "admin_email"} where owner/platform
    are ready-to-use Authorization header dicts.
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
    ptokens = client.post(
        "/auth/login", json={"email": root_email, "password": "correct-horse-42"}
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
