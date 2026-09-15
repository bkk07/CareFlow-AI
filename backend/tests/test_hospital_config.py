"""Hospital configuration CRUD tests: departments, specialties, types."""

import uuid

from tests.conftest import approved_hospital


def test_department_crud(client):
    hosp = approved_hospital(client, tag="dept")
    base = f"/hospitals/{hosp['id']}/departments"

    assert client.get(base, headers=hosp["owner"]).json() == []

    created = client.post(base, json={"name": "Cardiology"}, headers=hosp["owner"])
    assert created.status_code == 201, created.text
    dept_id = created.json()["id"]

    fetched = client.get(f"{base}/{dept_id}", headers=hosp["owner"])
    assert fetched.status_code == 200
    assert fetched.json()["name"] == "Cardiology"

    updated = client.put(
        f"{base}/{dept_id}", json={"name": "Cardio"}, headers=hosp["owner"]
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "Cardio"

    # Duplicate names are rejected per hospital.
    dup = client.post(base, json={"name": "Cardio"}, headers=hosp["owner"])
    assert dup.status_code == 409

    assert client.delete(f"{base}/{dept_id}", headers=hosp["owner"]).status_code == 204
    assert client.get(f"{base}/{dept_id}", headers=hosp["owner"]).status_code == 404


def test_specialty_and_appointment_type_crud(client):
    hosp = approved_hospital(client, tag="spec")
    hid = hosp["id"]

    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": "Cardiology"},
        headers=hosp["owner"],
    )
    assert spec.status_code == 201, spec.text
    spec_id = spec.json()["id"]

    listed = client.get(f"/hospitals/{hid}/specialties", headers=hosp["owner"]).json()
    assert [s["name"] for s in listed] == ["Cardiology"]

    # Appointment type referencing an unknown specialty is rejected.
    bad = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={
            "name": "Echo",
            "duration_minutes": 30,
            "compatible_specialty_ids": [str(uuid.uuid4())],
        },
        headers=hosp["owner"],
    )
    assert bad.status_code == 422

    good = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={
            "name": "Echo",
            "duration_minutes": 30,
            "compatible_specialty_ids": [spec_id],
        },
        headers=hosp["owner"],
    )
    assert good.status_code == 201, good.text
    assert good.json()["compatible_specialty_ids"] == [spec_id]

    # Invalid duration rejected by schema validation.
    invalid = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={"name": "Bad", "duration_minutes": 0},
        headers=hosp["owner"],
    )
    assert invalid.status_code == 422


def test_config_is_tenant_isolated(client):
    hosp_a = approved_hospital(client, tag="a")
    hosp_b = approved_hospital(client, tag="b")

    dept = client.post(
        f"/hospitals/{hosp_a['id']}/departments",
        json={"name": "Oncology"},
        headers=hosp_a["owner"],
    ).json()

    # Hospital B's admin cannot read/write hospital A's config.
    assert (
        client.get(
            f"/hospitals/{hosp_a['id']}/departments", headers=hosp_b["owner"]
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/hospitals/{hosp_a['id']}/departments/{dept['id']}",
            headers=hosp_b["owner"],
        ).status_code
        in (403, 404)
    )
    assert (
        client.post(
            f"/hospitals/{hosp_a['id']}/departments",
            json={"name": "Sneaky"},
            headers=hosp_b["owner"],
        ).status_code
        == 403
    )
    # Unknown hospital id.
    assert (
        client.get(
            f"/hospitals/{uuid.uuid4()}/departments", headers=hosp_a["owner"]
        ).status_code
        == 404
    )


def test_config_requires_hospital_admin_role(client):
    hosp = approved_hospital(client, tag="roles")
    base = f"/hospitals/{hosp['id']}/departments"

    assert client.get(base).status_code == 401

    patient_reg = client.post(
        "/auth/register",
        json={
            "email": f"pat-roles-{uuid.uuid4().hex[:6]}@example.com",
            "password": "correct-horse-42",
            "role": "patient",
        },
    )
    assert patient_reg.status_code == 201
    ptokens = client.post(
        "/auth/login",
        json={"email": patient_reg.json()["email"], "password": "correct-horse-42"},
    ).json()
    patient = {"Authorization": f"Bearer {ptokens['access_token']}"}
    assert client.get(base, headers=patient).status_code == 403
    # Per the access model, platform admins do not manage hospital config.
    assert client.get(base, headers=hosp["platform"]).status_code == 403


def test_config_blocked_for_unapproved_hospital(client):
    payload = {
        "name": "Pending Hospital",
        "address": "2 Side St",
        "contact_email": f"pending-{uuid.uuid4().hex[:6]}@example.com",
        "contact_phone": "+1-555-0101",
        "admin_email": f"pending-admin-{uuid.uuid4().hex[:6]}@example.com",
        "admin_password": "correct-horse-42",
    }
    hid = client.post("/hospitals", json=payload).json()["id"]
    tokens = client.post(
        "/auth/login",
        json={"email": payload["admin_email"], "password": "correct-horse-42"},
    ).json()
    owner = {"Authorization": f"Bearer {tokens['access_token']}"}
    # Still `submitted` → the go-live gate blocks configuration.
    resp = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": "Cardiology"},
        headers=owner,
    )
    assert resp.status_code == 403
