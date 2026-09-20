"""Hospital onboarding tests: registration, review flow, audit, go-live gate."""

import uuid

import pytest

from app.core.audit import AuditEvent
from app.domain.auth.models import User
from app.domain.hospital import service
from app.domain.hospital.models import Hospital, HospitalStatus

# NOTE: email-validator rejects reserved TLDs such as `.test`, so all test
# addresses use deliverable-looking `@example.com` variants.


def hospital_payload(name="City General", contact_email=None):
    uid = uuid.uuid4().hex[:8]
    return {
        "name": name,
        "address": "1 Main St",
        "contact_email": contact_email or f"contact-{uid}@example.com",
        "contact_phone": "+1-555-0100",
        "admin_email": f"admin-{uid}@example.com",
        "admin_password": "correct-horse-42",
    }


def register_platform_admin(client, email="root@example.com"):
    assert (
        client.post(
            "/auth/register",
            json={
                "email": email,
                "password": "correct-horse-42",
                "role": "platform_admin",
            },
        ).status_code
        == 201
    )
    tokens = client.post(
        "/auth/login", json={"email": email, "password": "correct-horse-42"}
    ).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def auth_headers(client, email, password="correct-horse-42"):
    tokens = client.post(
        "/auth/login", json={"email": email, "password": password}
    ).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def audit_actions(db, entity_id):
    return [
        e.action
        for e in db.query(AuditEvent)
        .filter(AuditEvent.entity_id == entity_id)
        .order_by(AuditEvent.created_at)
        .all()
    ]


# --- registration ------------------------------------------------------------


def test_register_creates_submitted_hospital_plus_admin_and_audit(client, db):
    payload = hospital_payload()
    resp = client.post("/hospitals", json=payload)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "submitted"
    assert body["contact_email"] == payload["contact_email"]
    assert body["rejection_reason"] is None
    assert body["submitted_at"] is not None

    hospital_id = uuid.UUID(body["id"])
    admin = (
        db.query(User).filter(User.email == payload["admin_email"].lower()).one()
    )
    assert admin.role.value == "hospital_admin"
    assert admin.hospital_id == hospital_id
    assert admin.is_active is True

    actions = audit_actions(db, hospital_id)
    assert actions == ["hospital.submitted"]


def test_duplicate_hospital_contact_email_rejected(client):
    payload = hospital_payload(contact_email="dup-contact@example.com")
    assert client.post("/hospitals", json=payload).status_code == 201
    second = client.post(
        "/hospitals",
        json=hospital_payload(
            name="Copycat", contact_email="DUP-CONTACT@example.com"
        ),
    )
    assert second.status_code == 409


def test_duplicate_admin_email_rejected(client):
    first = hospital_payload(contact_email="first-contact@example.com")
    assert client.post("/hospitals", json=first).status_code == 201
    clash = hospital_payload(contact_email="second-contact@example.com")
    clash["admin_email"] = first["admin_email"]
    assert client.post("/hospitals", json=clash).status_code == 409


# --- review flow ---------------------------------------------------------------


def test_approve_flow_flips_status_and_audits(client, db):
    payload = hospital_payload(contact_email="approve-contact@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    platform = register_platform_admin(client)

    resp = client.post(
        f"/platform/hospitals/{hospital_id}/approve", headers=platform
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "approved"
    assert body["reviewed_at"] is not None
    assert body["reviewed_by"] is not None

    assert audit_actions(db, uuid.UUID(hospital_id)) == [
        "hospital.submitted",
        "hospital.approved",
    ]

    # Owner admin can now view their hospital.
    owner = auth_headers(client, payload["admin_email"])
    view = client.get(f"/hospitals/{hospital_id}", headers=owner)
    assert view.status_code == 200
    assert view.json()["status"] == "approved"


def test_reject_reason_visible_to_hospital_admin(client, db):
    payload = hospital_payload(contact_email="reject-contact@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    platform = register_platform_admin(client)

    resp = client.post(
        f"/platform/hospitals/{hospital_id}/reject",
        json={"reason": "License document missing"},
        headers=platform,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "rejected"

    owner = auth_headers(client, payload["admin_email"])
    view = client.get(f"/hospitals/{hospital_id}", headers=owner)
    assert view.status_code == 200
    assert view.json()["rejection_reason"] == "License document missing"

    assert audit_actions(db, uuid.UUID(hospital_id))[-1] == "hospital.rejected"


def test_reject_requires_reason(client):
    payload = hospital_payload(contact_email="noreason-contact@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    platform = register_platform_admin(client)
    resp = client.post(
        f"/platform/hospitals/{hospital_id}/reject",
        json={"reason": ""},
        headers=platform,
    )
    assert resp.status_code == 422


def test_invalid_transitions_conflict(client):
    payload = hospital_payload(contact_email="transitions-contact@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    platform = register_platform_admin(client)

    # Cannot suspend a merely submitted hospital.
    assert (
        client.post(
            f"/platform/hospitals/{hospital_id}/suspend", headers=platform
        ).status_code
        == 409
    )
    # Approve, then approving/rejecting again conflicts.
    assert (
        client.post(
            f"/platform/hospitals/{hospital_id}/approve", headers=platform
        ).status_code
        == 200
    )
    assert (
        client.post(
            f"/platform/hospitals/{hospital_id}/approve", headers=platform
        ).status_code
        == 409
    )
    assert (
        client.post(
            f"/platform/hospitals/{hospital_id}/reject",
            json={"reason": "too late"},
            headers=platform,
        ).status_code
        == 409
    )


def test_suspend_approved_hospital_and_audit(client, db):
    payload = hospital_payload(contact_email="suspend-contact@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    platform = register_platform_admin(client)
    client.post(f"/platform/hospitals/{hospital_id}/approve", headers=platform)

    resp = client.post(
        f"/platform/hospitals/{hospital_id}/suspend", headers=platform
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "suspended"
    assert audit_actions(db, uuid.UUID(hospital_id)) == [
        "hospital.submitted",
        "hospital.approved",
        "hospital.suspended",
    ]


# --- access control --------------------------------------------------------------


def test_platform_endpoints_require_platform_admin(client):
    payload = hospital_payload(contact_email="rbac-contact@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    owner = auth_headers(client, payload["admin_email"])

    assert client.get("/platform/hospitals").status_code == 401
    assert client.get("/platform/hospitals", headers=owner).status_code == 403
    assert (
        client.post(
            f"/platform/hospitals/{hospital_id}/approve", headers=owner
        ).status_code
        == 403
    )


def test_platform_list_supports_status_filter(client):
    client.post("/hospitals", json=hospital_payload(contact_email="a@example.com"))
    hosp_b = client.post(
        "/hospitals", json=hospital_payload(contact_email="b@example.com")
    ).json()
    platform = register_platform_admin(client)
    client.post(f"/platform/hospitals/{hosp_b['id']}/approve", headers=platform)

    all_rows = client.get("/platform/hospitals", headers=platform).json()
    assert len(all_rows) == 2
    approved = client.get(
        "/platform/hospitals", params={"status": "approved"}, headers=platform
    ).json()
    assert [h["id"] for h in approved] == [hosp_b["id"]]


def test_hospital_visibility_scoped_to_owner_and_platform(client):
    payload_a = hospital_payload(contact_email="vis-a@example.com")
    id_a = client.post("/hospitals", json=payload_a).json()["id"]
    payload_b = hospital_payload(contact_email="vis-b@example.com")
    client.post("/hospitals", json=payload_b)
    platform = register_platform_admin(client)

    owner_a = auth_headers(client, payload_a["admin_email"])
    owner_b = auth_headers(client, payload_b["admin_email"])

    assert client.get(f"/hospitals/{id_a}", headers=owner_a).status_code == 200
    # Another hospital's admin cannot view it.
    assert client.get(f"/hospitals/{id_a}", headers=owner_b).status_code == 403
    # Platform admin can.
    assert client.get(f"/hospitals/{id_a}", headers=platform).status_code == 200
    # Unknown id.
    assert (
        client.get(f"/hospitals/{uuid.uuid4()}", headers=platform).status_code
        == 404
    )


# --- go-live gate (booking-time enforcement point) ---------------------------------


@pytest.mark.parametrize(
    "target_status",
    ["submitted", "rejected", "suspended"],
)
def test_go_live_gate_blocks_unapproved_hospitals(client, target_status):
    payload = hospital_payload(contact_email=f"{target_status}-gate@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    platform = register_platform_admin(client)
    if target_status == "suspended":
        client.post(
            f"/platform/hospitals/{hospital_id}/approve", headers=platform
        )
        client.post(
            f"/platform/hospitals/{hospital_id}/suspend", headers=platform
        )
    elif target_status == "rejected":
        client.post(
            f"/platform/hospitals/{hospital_id}/reject",
            json={"reason": "incomplete"},
            headers=platform,
        )
    hospital = client.get(
        f"/hospitals/{hospital_id}", headers=platform
    ).json()
    assert hospital["status"] == target_status

    with pytest.raises(Exception) as exc_info:
        service.assert_hospital_approved(
            Hospital(status=HospitalStatus(target_status))
        )
    assert exc_info.value.status_code == 403


def test_go_live_gate_passes_approved_hospital(client):
    payload = hospital_payload(contact_email="live-gate@example.com")
    hospital_id = client.post("/hospitals", json=payload).json()["id"]
    platform = register_platform_admin(client)
    client.post(f"/platform/hospitals/{hospital_id}/approve", headers=platform)
    hospital = client.get(f"/hospitals/{hospital_id}", headers=platform).json()
    assert hospital["status"] == "approved"
    assert (
        service.assert_hospital_approved(
            Hospital(status=HospitalStatus.approved)
        ).status
        == HospitalStatus.approved
    )


def test_correlation_id_propagates_to_audit(client, db):
    payload = hospital_payload(contact_email="corr-contact@example.com")
    correlation = str(uuid.uuid4())
    hospital_id = client.post(
        "/hospitals", json=payload, headers={"X-Correlation-ID": correlation}
    ).json()["id"]
    event = (
        db.query(AuditEvent)
        .filter(AuditEvent.entity_id == uuid.UUID(hospital_id))
        .one()
    )
    assert str(event.correlation_id) == correlation


def test_platform_admin_invite_flow(client):
    platform = register_platform_admin(client)
    second = client.post(
        "/platform/admins",
        json={"email": "root-second@example.com", "password": "correct-horse-42"},
        headers=platform,
    )
    assert second.status_code == 201, second.text
    assert second.json()["role"] == "platform_admin"

    # The invited admin can log in and act as platform.
    tokens = client.post(
        "/auth/login",
        json={"email": "root-second@example.com", "password": "correct-horse-42"},
    )
    assert tokens.status_code == 200, tokens.text
    headers = {"Authorization": f"Bearer {tokens.json()['access_token']}"}
    assert client.get("/platform/audit-events", headers=headers).status_code == 200

    # Duplicate email is a conflict, not a second row.
    assert (
        client.post(
            "/platform/admins",
            json={
                "email": "root-second@example.com",
                "password": "correct-horse-42",
            },
            headers=platform,
        ).status_code
        == 409
    )

    # Non-platform callers cannot mint platform admins.
    assert client.post("/platform/admins").status_code in (401, 422)
    patient = client.post(
        "/auth/register",
        json={
            "email": "plat-invite-patient@example.com",
            "password": "correct-horse-42",
            "role": "patient",
        },
    )
    assert patient.status_code == 201
    ptokens = client.post(
        "/auth/login",
        json={
            "email": "plat-invite-patient@example.com",
            "password": "correct-horse-42",
        },
    ).json()
    pheaders = {"Authorization": f"Bearer {ptokens['access_token']}"}
    assert (
        client.post(
            "/platform/admins",
            json={"email": "root-evil@example.com", "password": "correct-horse-42"},
            headers=pheaders,
        ).status_code
        == 403
    )
