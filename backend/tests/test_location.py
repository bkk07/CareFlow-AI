"""Location for nearby care: saved patient city ranks hospitals/doctors."""

from tests.conftest import approved_hospital

PASSWORD = "correct-horse-42"


def _patient(client, tag):
    email = f"loc-{tag}@example.com"
    assert (
        client.post(
            "/auth/register",
            json={"email": email, "password": PASSWORD, "role": "patient"},
        ).status_code
        == 201
    )
    tokens = client.post(
        "/auth/login", json={"email": email, "password": PASSWORD}
    ).json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def _hospital_with_city(client, tag, city):
    setup = approved_hospital(client, tag=tag)
    resp = client.put(
        f"/hospitals/{setup['id']}", json={"city": city}, headers=setup["owner"]
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["city"] == city
    return setup


def test_contact_city_roundtrip(client):
    headers = _patient(client, "roundtrip")
    put = client.put("/patients/me/contact", json={"city": "Bengaluru"}, headers=headers)
    assert put.status_code == 200, put.text
    assert put.json()["city"] == "Bengaluru"
    got = client.get("/patients/me/contact", headers=headers).json()
    assert got["city"] == "Bengaluru"


def _active_doctor(client, hosp, tag):
    """Specialty + department + universal type, then create + activate."""
    hid, owner = hosp["id"], hosp["owner"]
    spec = client.post(
        f"/hospitals/{hid}/specialties",
        json={"name": f"General {tag}"},
        headers=owner,
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments",
        json={"name": f"Care {tag}"},
        headers=owner,
    ).json()
    client.post(
        f"/hospitals/{hid}/appointment-types",
        json={"name": f"Consult {tag}", "duration_minutes": 30},
        headers=owner,
    )
    doctor = client.post(
        f"/hospitals/{hid}/doctors",
        json={
            "name": f"Dr. {tag}",
            "specialty_id": spec["id"],
            "department_id": dept["id"],
        },
        headers=owner,
    ).json()
    activated = client.post(
        f"/hospitals/{hid}/doctors/{doctor['id']}/activate", headers=owner
    )
    assert activated.status_code == 200, activated.text
    return doctor


def test_search_ranks_same_city_first(client):
    headers = _patient(client, "rank")
    hosp_b = _hospital_with_city(client, "loca", "Chennai")
    hosp_a = _hospital_with_city(client, "locb", "Bengaluru")
    _active_doctor(client, hosp_b, "loc-chennai")
    _active_doctor(client, hosp_a, "loc-bengaluru")

    resp = client.post(
        "/mcp/call",
        json={"tool": "search_hospitals", "input": {"city": "Bengaluru"}},
        headers=headers,
    )
    hospitals = resp.json()["result"]["hospitals"]
    assert hospitals[0]["city"] == "Bengaluru"
    assert all("city" in h for h in hospitals)

    docs = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"city": "Bengaluru"}},
        headers=headers,
    ).json()["result"]["doctors"]
    mine = [d for d in docs if d["name"] in ("Dr. loc-chennai", "Dr. loc-bengaluru")]
    assert [d["name"] for d in mine] == ["Dr. loc-bengaluru", "Dr. loc-chennai"]
    assert all("hospital_city" in d for d in docs)
