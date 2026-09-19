"""Doctor portal logins: hospital-admin invite + unlink, location derived."""

from tests.conftest import approved_hospital
from tests.test_location import _active_doctor

PASSWORD = "correct-horse-42"


def _doctor(client, hosp, tag="inv"):
    hid, owner = hosp["id"], hosp["owner"]
    spec = client.post(
        f"/hospitals/{hid}/specialties", json={"name": f"Spec {tag}"}, headers=owner
    ).json()
    dept = client.post(
        f"/hospitals/{hid}/departments", json={"name": f"Dept {tag}"}, headers=owner
    ).json()
    return client.post(
        f"/hospitals/{hid}/doctors",
        json={"name": f"Dr. {tag}", "specialty_id": spec["id"], "department_id": dept["id"]},
        headers=owner,
    ).json()


def test_invite_creates_scoped_login_and_links(client):
    hosp = approved_hospital(client, tag="inv-link")
    doc = _doctor(client, hosp, tag="link")
    assert doc["user_id"] is None
    assert doc["login_email"] is None

    email = f"dr-link-{doc['id'][:6]}@example.com"
    inv = client.post(
        f"/hospitals/{hosp['id']}/doctors/{doc['id']}/invite",
        json={"email": email, "password": PASSWORD},
        headers=hosp["owner"],
    )
    assert inv.status_code == 201, inv.text
    body = inv.json()
    assert body["login_email"] == email
    assert body["user_id"] is not None

    # The invited doctor signs into the doctor portal and sees own profile.
    tokens = client.post("/auth/login", json={"email": email, "password": PASSWORD}).json()
    dh = {"Authorization": f"Bearer {tokens['access_token']}"}
    me = client.get("/doctors/me", headers=dh)
    assert me.status_code == 200, me.text
    assert me.json()["id"] == doc["id"]
    assert me.json()["login_email"] == email

    # Roster surfaces the login without extra calls.
    roster = client.get(f"/hospitals/{hosp['id']}/doctors", headers=hosp["owner"]).json()
    row = next(d for d in roster if d["id"] == doc["id"])
    assert row["login_email"] == email


def test_invite_rejects_duplicates_and_bad_input(client):
    hosp = approved_hospital(client, tag="inv-dup")
    doc = _doctor(client, hosp, tag="dup")
    email = f"dr-dup-{doc['id'][:6]}@example.com"
    url = f"/hospitals/{hosp['id']}/doctors/{doc['id']}/invite"
    assert client.post(url, json={"email": email, "password": PASSWORD}, headers=hosp["owner"]).status_code == 201
    # Same doctor twice.
    assert client.post(url, json={"email": "other@example.com", "password": PASSWORD}, headers=hosp["owner"]).status_code == 409
    # Email taken by another profile.
    doc2 = _doctor(client, hosp, tag="dup2")
    url2 = f"/hospitals/{hosp['id']}/doctors/{doc2['id']}/invite"
    assert client.post(url2, json={"email": email, "password": PASSWORD}, headers=hosp["owner"]).status_code == 409
    # Short password + bad email.
    assert client.post(url2, json={"email": "fine@example.com", "password": "short"}, headers=hosp["owner"]).status_code == 422
    assert client.post(url2, json={"email": "not-an-email", "password": PASSWORD}, headers=hosp["owner"]).status_code == 422


def test_invite_forbidden_for_non_admins(client):
    from tests.test_location import _patient

    hosp = approved_hospital(client, tag="inv-auth")
    doc = _doctor(client, hosp, tag="auth")
    patient = _patient(client, "inv-auth")
    url = f"/hospitals/{hosp['id']}/doctors/{doc['id']}/invite"
    assert client.post(url, json={"email": "x@example.com", "password": PASSWORD}, headers=patient).status_code == 403
    assert client.post(url, json={"email": "x@example.com", "password": PASSWORD}).status_code in (401, 403)


def test_remove_login_deactivates_and_unlinks(client):
    hosp = approved_hospital(client, tag="inv-off")
    doc = _doctor(client, hosp, tag="off")
    email = f"dr-off-{doc['id'][:6]}@example.com"
    url = f"/hospitals/{hosp['id']}/doctors/{doc['id']}/invite"
    assert client.post(url, json={"email": email, "password": PASSWORD}, headers=hosp["owner"]).status_code == 201

    login_url = f"/hospitals/{hosp['id']}/doctors/{doc['id']}/login"
    removed = client.delete(login_url, headers=hosp["owner"])
    assert removed.status_code == 200, removed.text
    assert removed.json()["user_id"] is None
    assert removed.json()["login_email"] is None

    # Old credentials no longer sign in; removing twice is 404.
    assert client.post("/auth/login", json={"email": email, "password": PASSWORD}).status_code in (401, 403)
    assert client.delete(login_url, headers=hosp["owner"]).status_code == 404


def test_doctor_location_resolves_from_hospital(client):
    """No location input on doctors: search still reports hospital geo."""
    hosp = approved_hospital(client, tag="inv-geo")
    client.put(
        f"/hospitals/{hosp['id']}",
        json={"latitude": 12.9716, "longitude": 77.5946},
        headers=hosp["owner"],
    )
    _active_doctor(client, hosp, "inv-geo-doc")
    from tests.test_location import _patient

    headers = _patient(client, "inv-geo")
    docs = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {"latitude": 12.9720, "longitude": 77.5950}},
        headers=headers,
    ).json()["result"]["doctors"]
    mine = [d for d in docs if d["name"] == "Dr. inv-geo-doc"]
    assert mine and mine[0]["distance_km"] is not None and mine[0]["distance_km"] < 1
