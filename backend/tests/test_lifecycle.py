"""Full lifecycle: review stages, corrections loop, reinstate, doctor suspend."""

from tests.conftest import approved_hospital

PASSWORD = "correct-horse-42"


def _register(client, tag):
    import uuid

    uid = uuid.uuid4().hex[:6]
    payload = {
        "name": f"Lifecycle {tag}",
        "address": "1 Loop St",
        "contact_email": f"life-{tag}-{uid}@example.com",
        "contact_phone": "+1-555-0100",
        "admin_email": f"life-admin-{tag}-{uid}@example.com",
        "admin_password": PASSWORD,
    }
    reg = client.post("/hospitals", json=payload)
    assert reg.status_code == 201, reg.text
    owner_tokens = client.post(
        "/auth/login",
        json={"email": payload["admin_email"], "password": PASSWORD},
    ).json()
    owner = {"Authorization": f"Bearer {owner_tokens['access_token']}"}
    return reg.json()["id"], owner


def _platform(client, tag):
    import uuid

    email = f"life-root-{tag}-{uuid.uuid4().hex[:6]}@example.com"
    assert (
        client.post(
            "/auth/register",
            json={"email": email, "password": PASSWORD, "role": "platform_admin"},
        ).status_code
        == 201
    )
    tokens = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def test_review_corrections_resubmit_approve_loop(client):
    hid, owner = _register(client, "loop")
    platform = _platform(client, "loop")

    started = client.post(f"/platform/hospitals/{hid}/start-review", headers=platform)
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "under_review"
    # Starting twice is a conflict.
    assert client.post(f"/platform/hospitals/{hid}/start-review", headers=platform).status_code == 409

    msg = "Add weekend operating hours and a contact phone."
    corr = client.post(
        f"/platform/hospitals/{hid}/request-corrections",
        json={"message": msg},
        headers=platform,
    )
    assert corr.status_code == 200, corr.text
    assert corr.json()["status"] == "draft"
    assert corr.json()["review_notes"] == msg

    # Hospital sees the notes, fixes, resubmits.
    view = client.get(f"/hospitals/{hid}", headers=owner).json()
    assert view["review_notes"] == msg
    resub = client.post(f"/hospitals/{hid}/resubmit", headers=owner)
    assert resub.status_code == 200, resub.text
    assert resub.json()["status"] == "submitted"
    # Resubmitting twice is a conflict.
    assert client.post(f"/hospitals/{hid}/resubmit", headers=owner).status_code == 409

    approved = client.post(f"/platform/hospitals/{hid}/approve", headers=platform)
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert approved.json()["review_notes"] is None


def test_suspend_reinstate_roundtrip(client):
    setup = approved_hospital(client, tag="life-sus")
    hid, platform = setup["id"], setup["platform"]

    sus = client.post(f"/platform/hospitals/{hid}/suspend", headers=platform)
    assert sus.status_code == 200, sus.text
    assert sus.json()["status"] == "suspended"
    # Suspended hospitals cannot be approved again directly.
    assert client.post(f"/platform/hospitals/{hid}/approve", headers=platform).status_code == 409

    back = client.post(f"/platform/hospitals/{hid}/reinstate", headers=platform)
    assert back.status_code == 200, back.text
    assert back.json()["status"] == "approved"
    # Reinstating a live hospital is a conflict.
    assert client.post(f"/platform/hospitals/{hid}/reinstate", headers=platform).status_code == 409


def test_operating_hours_roundtrip_and_validation(client):
    setup = approved_hospital(client, tag="life-hours")
    hid, owner = setup["id"], setup["owner"]
    hours = {"mon": ["09:00", "18:00"], "sat": ["10:00", "14:00"]}
    put = client.put(f"/hospitals/{hid}", json={"operating_hours": hours}, headers=owner)
    assert put.status_code == 200, put.text
    assert put.json()["operating_hours"] == hours

    bad_day = client.put(f"/hospitals/{hid}", json={"operating_hours": {"funday": ["09:00", "18:00"]}}, headers=owner)
    assert bad_day.status_code == 422
    bad_span = client.put(f"/hospitals/{hid}", json={"operating_hours": {"mon": ["18:00", "09:00"]}}, headers=owner)
    assert bad_span.status_code == 422


def test_doctor_suspend_and_reactivate(client):
    from tests.test_location import _active_doctor

    hosp = approved_hospital(client, tag="life-doc")
    doc = _active_doctor(client, hosp, "life-sus-doc")
    hid, owner = hosp["id"], hosp["owner"]
    url = f"/hospitals/{hid}/doctors/{doc['id']}/suspend"

    sus = client.post(url, headers=owner)
    assert sus.status_code == 200, sus.text
    assert sus.json()["status"] == "suspended"
    assert client.post(url, headers=owner).status_code == 409

    back = client.post(f"/hospitals/{hid}/doctors/{doc['id']}/activate", headers=owner)
    assert back.status_code == 200, back.text
    assert back.json()["status"] == "active"
