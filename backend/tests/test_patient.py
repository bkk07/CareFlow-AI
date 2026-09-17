"""Patient management tests: self-scoped profile + preferences."""

import uuid

import pytest

from tests.conftest import approved_hospital


def register_patient(client, email=None):
    email = email or f"patient-{uuid.uuid4().hex[:8]}@example.com"
    reg = client.post(
        "/auth/register",
        json={"email": email, "password": "correct-horse-42", "role": "patient"},
    )
    assert reg.status_code == 201, reg.text
    tokens = client.post(
        "/auth/login", json={"email": email, "password": "correct-horse-42"}
    ).json()
    return email, {"Authorization": f"Bearer {tokens['access_token']}"}


def seed_refs(client, hosp):
    """A hospital + doctor + appointment type to reference from preferences."""
    hid = hosp["id"]
    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": "Cardiology"},
        headers=hosp["owner"],
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": "Heart"},
        headers=hosp["owner"],
    ).json()
    appt_type = client.post(
        f"/hospitals/{hid}/appointment-types",
        json={"name": "Consult", "duration_minutes": 30},
        headers=hosp["owner"],
    ).json()
    doctor = client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": "Dr. Pref",
            "specialty_id": spec["id"],
            "department_id": dept["id"],
        },
        headers=hosp["owner"],
    ).json()
    return hid, doctor["id"], appt_type["id"]


# --- profile -------------------------------------------------------------------


def test_patient_profile_read_and_email_update_persist(client):
    email, headers = register_patient(client)

    me = client.get("/patients/me", headers=headers)
    assert me.status_code == 200, me.text
    body = me.json()
    assert body["email"] == email
    assert body["role"] == "patient"
    assert body["hospital_id"] is None
    assert "password_hash" not in body

    updated = client.put(
        "/patients/me",
        json={"email": "new-address@example.com"},
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["email"] == "new-address@example.com"

    again = client.get("/patients/me", headers=headers)
    assert again.json()["email"] == "new-address@example.com"


def test_patient_email_update_rejects_duplicates(client):
    _, headers_a = register_patient(client)
    email_b, _ = register_patient(client)
    clash = client.put(
        "/patients/me", json={"email": email_b}, headers=headers_a
    )
    assert clash.status_code == 409


def test_patient_endpoints_require_patient_role(client):
    hosp = approved_hospital(client, tag="patroles")
    email, patient = register_patient(client)

    assert client.get("/patients/me").status_code == 401
    assert client.get("/patients/me/preferences").status_code == 401

    # Doctors, hospital admins, and platform admins cannot use patient routes.
    assert client.get("/patients/me", headers=hosp["platform"]).status_code == 403
    assert client.get("/patients/me", headers=hosp["owner"]).status_code == 403
    assert (
        client.put(
            "/patients/me/preferences",
            json={"preferred_time_of_day": "morning"},
            headers=hosp["owner"],
        ).status_code
        == 403
    )
    # The patient still sees only their own row.
    assert client.get("/patients/me", headers=patient).json()["email"] == email


# --- preferences ---------------------------------------------------------------


def test_fresh_patient_gets_clean_empty_preferences(client):
    _, headers = register_patient(client)
    resp = client.get("/patients/me/preferences", headers=headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["preferred_doctor_id"] is None
    assert body["preferred_hospital_id"] is None
    assert body["preferred_appointment_type_id"] is None
    assert body["preferred_time_of_day"] is None
    assert body["preferred_consultation_mode"] is None


def test_preferences_update_persists(client):
    hosp = approved_hospital(client, tag="prefs")
    _, headers = register_patient(client)
    hid, doctor_id, type_id = seed_refs(client, hosp)

    updated = client.put(
        "/patients/me/preferences",
        json={
            "preferred_doctor_id": doctor_id,
            "preferred_hospital_id": hid,
            "preferred_appointment_type_id": type_id,
            "preferred_time_of_day": "evening",
            "preferred_consultation_mode": "video",
        },
        headers=headers,
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["preferred_doctor_id"] == doctor_id
    assert body["preferred_time_of_day"] == "evening"
    assert body["preferred_consultation_mode"] == "video"

    fetched = client.get("/patients/me/preferences", headers=headers).json()
    assert fetched == body


def test_preferences_partial_update_and_clearing(client):
    _, headers = register_patient(client)

    first = client.put(
        "/patients/me/preferences",
        json={"preferred_time_of_day": "morning"},
        headers=headers,
    )
    assert first.status_code == 200
    assert first.json()["preferred_time_of_day"] == "morning"
    assert first.json()["preferred_consultation_mode"] is None

    second = client.put(
        "/patients/me/preferences",
        json={"preferred_consultation_mode": "phone"},
        headers=headers,
    )
    assert second.json()["preferred_time_of_day"] == "morning"
    assert second.json()["preferred_consultation_mode"] == "phone"

    cleared = client.put(
        "/patients/me/preferences",
        json={"preferred_time_of_day": None},
        headers=headers,
    )
    assert cleared.json()["preferred_time_of_day"] is None
    assert cleared.json()["preferred_consultation_mode"] == "phone"


def test_preferences_reject_unknown_references(client):
    _, headers = register_patient(client)
    bogus = str(uuid.uuid4())

    assert (
        client.put(
            "/patients/me/preferences",
            json={"preferred_doctor_id": bogus},
            headers=headers,
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/patients/me/preferences",
            json={"preferred_hospital_id": bogus},
            headers=headers,
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/patients/me/preferences",
            json={"preferred_appointment_type_id": bogus},
            headers=headers,
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/patients/me/preferences",
            json={"preferred_time_of_day": "midnight"},
            headers=headers,
        ).status_code
        == 422
    )


def test_preferences_do_not_scope_patient_identity(client, db):
    """Setting a preferred hospital must not attach hospital_id to the user."""
    from app.domain.auth.models import User

    hosp = approved_hospital(client, tag="noscope")
    email, headers = register_patient(client)
    hid, _, _ = seed_refs(client, hosp)

    resp = client.put(
        "/patients/me/preferences",
        json={"preferred_hospital_id": hid},
        headers=headers,
    )
    assert resp.status_code == 200

    user = db.query(User).filter(User.email == email).one()
    assert user.hospital_id is None
    assert user.role.value == "patient"
    assert client.get("/patients/me", headers=headers).json()["hospital_id"] is None


# --- own appointments (enriched view for the patient portal) ------------------


def seed_patient_appointment(db, client, tag="myappts"):
    """Approved hospital + named doctor/type + one owned appointment row."""
    import uuid as uuid_mod
    from datetime import datetime, timedelta, timezone

    from app.domain.appointment.models import (
        Appointment,
        AppointmentHistory,
        AppointmentState,
    )
    from app.domain.auth.models import User

    hosp = approved_hospital(client, tag=tag)
    hid, doctor_id, type_id = seed_refs(client, hosp)
    email, headers = register_patient(client)
    patient_id = db.query(User).filter(User.email == email).one().id

    start = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(days=2)
    appt = Appointment(
        hospital_id=uuid_mod.UUID(hid),
        patient_id=patient_id,
        doctor_id=uuid_mod.UUID(doctor_id),
        appointment_type_id=uuid_mod.UUID(type_id),
        slot_start=start,
        slot_end=start + timedelta(minutes=30),
        state=AppointmentState.confirmed,
        idempotency_key=f"myappts-{tag}-{uuid_mod.uuid4().hex[:8]}",
        correlation_id=uuid_mod.uuid4(),
    )
    db.add(appt)
    db.commit()
    db.refresh(appt)
    db.add(
        AppointmentHistory(
            appointment_id=appt.id,
            from_state=AppointmentState.pending,
            to_state=AppointmentState.confirmed,
            actor_system="test",
            correlation_id=appt.correlation_id,
        )
    )
    db.commit()
    return headers, str(appt.id)


def test_patient_my_appointments_list_is_enriched_and_scoped(client, db):
    headers, appt_id = seed_patient_appointment(db, client)

    listing = client.get("/patients/me/appointments", headers=headers)
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == appt_id
    assert row["doctor_name"] == "Dr. Pref"
    assert row["specialty"] == "Cardiology"
    assert row["department"] == "Heart"
    assert row["appointment_type_name"] == "Consult"
    assert row["duration_minutes"] == 30
    assert row["state"] == "confirmed"
    assert row["hospital_name"].startswith("Hospital myappts")

    # Another patient sees nothing and cannot open the row.
    _, other = register_patient(client)
    assert client.get("/patients/me/appointments", headers=other).json() == []
    denied = client.get(f"/patients/me/appointments/{appt_id}", headers=other)
    assert denied.status_code == 404


def test_patient_my_appointment_detail_has_history(client, db):
    headers, appt_id = seed_patient_appointment(db, client, tag="mydetail")

    detail = client.get(f"/patients/me/appointments/{appt_id}", headers=headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    assert body["doctor_name"] == "Dr. Pref"
    assert len(body["history"]) == 1
    assert body["history"][0]["to_state"] == "confirmed"

    missing = client.get(
        f"/patients/me/appointments/{uuid.uuid4()}", headers=headers
    )
    assert missing.status_code == 404
