"""Doctor multi-duration tests: offered visit lengths end to end."""

from tests.conftest import approved_hospital
from tests.test_doctor import create_doctor


def test_create_defaults_durations_from_legacy_default(client):
    hosp = approved_hospital(client, tag="dur")
    body = create_doctor(client, hosp).json()
    assert body["available_durations"] == [30]
    assert body["default_duration_minutes"] == 30


def test_create_with_multiple_durations(client):
    hosp = approved_hospital(client, tag="durm")
    body = create_doctor(
        client, hosp, available_durations=[60, 15, 30, 15]
    ).json()
    assert body["available_durations"] == [15, 30, 60]
    assert body["default_duration_minutes"] == 15


def test_update_durations_rejected_when_empty(client):
    hosp = approved_hospital(client, tag="dure")
    doctor_id = create_doctor(client, hosp).json()["id"]
    resp = client.put(
        f"/hospitals/{hosp['id']}/doctors/{doctor_id}",
        json={"available_durations": []},
        headers=hosp["owner"],
    )
    assert resp.status_code == 422


def test_doctor_self_update_durations(client):
    hosp = approved_hospital(client, tag="durs")
    doctor_id = create_doctor(client, hosp).json()["id"]

    invite = client.post(
        f"/hospitals/{hosp['id']}/doctors/{doctor_id}/invite",
        json={"email": "dur-doc@example.com", "password": "correct-horse-42"},
        headers=hosp["owner"],
    )
    assert invite.status_code == 201, invite.text

    tokens = client.post(
        "/auth/login",
        json={"email": "dur-doc@example.com", "password": "correct-horse-42"},
    ).json()
    doc = {"Authorization": f"Bearer {tokens['access_token']}"}

    updated = client.put(
        "/doctors/me", json={"available_durations": [45, 15]}, headers=doc
    )
    assert updated.status_code == 200, updated.text
    body = updated.json()
    assert body["available_durations"] == [15, 45]
    assert body["default_duration_minutes"] == 15

    profile = client.get("/doctors/me", headers=doc).json()
    assert profile["available_durations"] == [15, 45]
