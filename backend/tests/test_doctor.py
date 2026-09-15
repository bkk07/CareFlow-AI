"""Doctor management tests: CRUD, activation gate, constraints, isolation."""

import uuid

from tests.conftest import approved_hospital


def seed_config(client, hosp, specialty="Cardiology"):
    hid = hosp["id"]
    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": specialty},
        headers=hosp["owner"],
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": "Heart Center"},
        headers=hosp["owner"],
    ).json()
    return spec, dept


def create_doctor(client, hosp, **overrides):
    body = {"name": "Dr. Rao"}
    body.update(overrides)
    return client.post(
        f"/hospitals/{hosp['id']}/doctors", json=body, headers=hosp["owner"]
    )


def test_doctor_crud(client):
    hosp = approved_hospital(client, tag="doc")
    spec, dept = seed_config(client, hosp)

    created = create_doctor(
        client,
        hosp,
        specialty_id=spec["id"],
        department_id=dept["id"],
        experience_years=12,
        languages=["en", "hi"],
        external_provider_id="EHR-001",
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["status"] == "invited"
    assert body["external_provider_id"] == "EHR-001"
    doctor_id = body["id"]

    fetched = client.get(
        f"/hospitals/{hosp['id']}/doctors/{doctor_id}", headers=hosp["owner"]
    )
    assert fetched.status_code == 200
    assert fetched.json()["languages"] == ["en", "hi"]

    listed = client.get(
        f"/hospitals/{hosp['id']}/doctors", headers=hosp["owner"]
    ).json()
    assert [d["id"] for d in listed] == [doctor_id]

    updated = client.put(
        f"/hospitals/{hosp['id']}/doctors/{doctor_id}",
        json={"experience_years": 13},
        headers=hosp["owner"],
    )
    assert updated.status_code == 200
    assert updated.json()["experience_years"] == 13

    assert (
        client.delete(
            f"/hospitals/{hosp['id']}/doctors/{doctor_id}", headers=hosp["owner"]
        ).status_code
        == 204
    )


def test_activation_requires_specialty_department_compatible_type(client):
    hosp = approved_hospital(client, tag="act")
    spec, dept = seed_config(client, hosp)
    hid = hosp["id"]

    doctor_id = create_doctor(client, hosp).json()["id"]
    base = f"/hospitals/{hid}/doctors/{doctor_id}"

    # No specialty/department yet.
    assert client.post(f"{base}/activate", headers=hosp["owner"]).status_code == 422

    client.put(
        base,
        json={"specialty_id": spec["id"], "department_id": dept["id"]},
        headers=hosp["owner"],
    )
    # Specialty/department set, but no appointment type exists yet.
    assert client.post(f"{base}/activate", headers=hosp["owner"]).status_code == 422

    # An incompatible appointment type does not satisfy the gate.
    other_spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": "Dermatology"},
        headers=hosp["owner"],
    ).json()
    client.post(
        f"/hospitals/{hid}/appointment-types",
        json={
            "name": "Skin Check",
            "duration_minutes": 15,
            "compatible_specialty_ids": [other_spec["id"]],
        },
        headers=hosp["owner"],
    )
    assert client.post(f"{base}/activate", headers=hosp["owner"]).status_code == 422

    # A compatible appointment type unlocks activation.
    client.post(
        f"/hospitals/{hid}/appointment-types",
        json={
            "name": "Cardio Consult",
            "duration_minutes": 30,
            "compatible_specialty_ids": [spec["id"]],
        },
        headers=hosp["owner"],
    )
    activated = client.post(f"{base}/activate", headers=hosp["owner"])
    assert activated.status_code == 200, activated.text
    assert activated.json()["status"] == "active"

    # Activating twice conflicts; deactivation works; deactivating twice conflicts.
    assert client.post(f"{base}/activate", headers=hosp["owner"]).status_code == 409
    deactivated = client.post(f"{base}/deactivate", headers=hosp["owner"])
    assert deactivated.status_code == 200
    assert deactivated.json()["status"] == "inactive"
    assert client.post(f"{base}/deactivate", headers=hosp["owner"]).status_code == 409


def test_universal_appointment_type_counts_as_compatible(client):
    hosp = approved_hospital(client, tag="uni")
    spec, dept = seed_config(client, hosp)
    client.post(
        f"/hospitals/{hosp['id']}/appointment-types",
        json={"name": "General Visit", "duration_minutes": 20},
        headers=hosp["owner"],
    )
    doctor_id = create_doctor(
        client, hosp, specialty_id=spec["id"], department_id=dept["id"]
    ).json()["id"]
    resp = client.post(
        f"/hospitals/{hosp['id']}/doctors/{doctor_id}/activate",
        headers=hosp["owner"],
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"


def test_doctor_refs_must_belong_to_hospital(client):
    hosp_a = approved_hospital(client, tag="refa")
    hosp_b = approved_hospital(client, tag="refb")
    spec_b, _ = seed_config(client, hosp_b)

    resp = create_doctor(client, hosp_a, specialty_id=spec_b["id"])
    assert resp.status_code == 422


def test_external_provider_id_unique_per_hospital(client):
    hosp_a = approved_hospital(client, tag="exta")
    hosp_b = approved_hospital(client, tag="extb")

    first = create_doctor(client, hosp_a, external_provider_id="EHR-007")
    assert first.status_code == 201, first.text
    clash = create_doctor(client, hosp_a, external_provider_id="EHR-007")
    assert clash.status_code == 409
    # Same external id is fine in a different hospital.
    other = create_doctor(client, hosp_b, external_provider_id="EHR-007")
    assert other.status_code == 201, other.text


def test_specialty_delete_blocked_when_referenced(client):
    hosp = approved_hospital(client, tag="del")
    spec, dept = seed_config(client, hosp)
    create_doctor(
        client, hosp, specialty_id=spec["id"], department_id=dept["id"]
    )

    blocked = client.delete(
        f"/hospitals/{hosp['id']}/specialties/{spec['id']}",
        headers=hosp["owner"],
    )
    assert blocked.status_code == 409

    blocked_dept = client.delete(
        f"/hospitals/{hosp['id']}/departments/{dept['id']}",
        headers=hosp["owner"],
    )
    assert blocked_dept.status_code == 409

    # Unreferenced entities delete cleanly.
    free = client.post(
        f"/hospitals/{hosp['id']}/specialties",
        json={"name": "Free Specialty"},
        headers=hosp["owner"],
    ).json()
    assert (
        client.delete(
            f"/hospitals/{hosp['id']}/specialties/{free['id']}",
            headers=hosp["owner"],
        ).status_code
        == 204
    )


def test_doctor_endpoints_are_tenant_isolated(client):
    hosp_a = approved_hospital(client, tag="isoa")
    hosp_b = approved_hospital(client, tag="isob")
    doctor_id = create_doctor(client, hosp_a).json()["id"]

    assert (
        client.get(
            f"/hospitals/{hosp_a['id']}/doctors", headers=hosp_b["owner"]
        ).status_code
        == 403
    )
    assert (
        client.get(
            f"/hospitals/{hosp_a['id']}/doctors/{doctor_id}",
            headers=hosp_b["owner"],
        ).status_code
        in (403, 404)
    )
    assert (
        client.post(
            f"/hospitals/{hosp_a['id']}/doctors/{doctor_id}/activate",
            headers=hosp_b["owner"],
        ).status_code
        == 403
    )
