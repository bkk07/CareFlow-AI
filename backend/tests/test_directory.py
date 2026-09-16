"""Directory tests: public catalog for approved hospitals only."""

from tests.test_mcp_agent import seed_setup


def test_directory_lists_catalog_for_approved(client):
    setup = seed_setup(client, tag="dir")
    h = setup["patient"]["headers"]
    hid = setup["hid"]

    specs = client.get(
        "/directory/specialties", params={"hospital_id": hid}, headers=h
    )
    assert specs.status_code == 200
    assert any("Cardiology dir" in s["name"] for s in specs.json()["specialties"])

    types = client.get(
        "/directory/appointment-types", params={"hospital_id": hid}, headers=h
    )
    assert types.status_code == 200
    assert any("Consult dir" in t["name"] for t in types.json()["appointment_types"])


def test_directory_hides_unapproved(client):
    setup = seed_setup(client, tag="dir2")
    h = setup["patient"]["headers"]

    pending = client.post(
        "/hospitals",
        json={
            "name": "Hidden Clinic",
            "address": "9 Nowhere Rd",
            "contact_email": "c-hidden@example.com",
            "contact_phone": "+1-555-0102",
            "admin_email": "a-hidden@example.com",
            "admin_password": "correct-horse-42",
        },
    )
    assert pending.status_code == 201
    hidden_id = pending.json()["id"]

    assert (
        client.get(
            "/directory/specialties", params={"hospital_id": hidden_id}, headers=h
        ).status_code
        == 404
    )
    assert (
        client.get(
            "/directory/appointment-types",
            params={"hospital_id": hidden_id},
            headers=h,
        ).status_code
        == 404
    )
    assert (
        client.get(
            "/directory/specialties",
            params={"hospital_id": "00000000-0000-0000-0000-000000000000"},
            headers=h,
        ).status_code
        == 404
    )
    assert client.get("/directory/specialties", headers=h).status_code == 422
