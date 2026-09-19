"""Geo coordinates: registration validation + distance-based recommendation."""

import uuid

from tests.conftest import approved_hospital
from tests.test_location import _active_doctor, _patient

PASSWORD = "correct-horse-42"

# Bengaluru / Chennai — ~290 km apart.
BLR = {"latitude": 12.9716, "longitude": 77.5946}
MAA = {"latitude": 13.0827, "longitude": 80.2707}


def _payload(tag, **extra):
    uid = uuid.uuid4().hex[:6]
    base = {
        "name": f"Geo Hospital {tag}",
        "address": "1 Geo St",
        "contact_email": f"geo-{tag}-{uid}@example.com",
        "contact_phone": "+1-555-0100",
        "city": "Bengaluru",
        "admin_email": f"geo-admin-{tag}-{uid}@example.com",
        "admin_password": PASSWORD,
    }
    base.update(extra)
    return base


def test_register_with_coords_persists(client):
    resp = client.post("/hospitals", json=_payload("coords", **BLR))
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["latitude"] == BLR["latitude"]
    assert body["longitude"] == BLR["longitude"]
    assert body["city"] == "Bengaluru"


def test_register_coords_must_come_in_pairs(client):
    assert client.post("/hospitals", json=_payload("lonely-lat", latitude=12.9)).status_code == 422
    assert client.post("/hospitals", json=_payload("lonely-lng", longitude=77.5)).status_code == 422


def test_register_coords_range_validated(client):
    assert client.post("/hospitals", json=_payload("bad-lat", latitude=91.0, longitude=77.5)).status_code == 422
    assert client.post("/hospitals", json=_payload("bad-lng", latitude=12.9, longitude=181.0)).status_code == 422


def test_update_coords_roundtrip(client):
    setup = approved_hospital(client, tag="geo-upd")
    put = client.put(f"/hospitals/{setup['id']}", json=BLR, headers=setup["owner"])
    assert put.status_code == 200, put.text
    assert put.json()["latitude"] == BLR["latitude"]
    assert put.json()["longitude"] == BLR["longitude"]
    bad = client.put(f"/hospitals/{setup['id']}", json={"latitude": 12.9}, headers=setup["owner"])
    assert bad.status_code == 422


def _geo_hospital(client, tag, coords):
    setup = approved_hospital(client, tag=tag)
    resp = client.put(f"/hospitals/{setup['id']}", json=coords, headers=setup["owner"])
    assert resp.status_code == 200, resp.text
    return setup


def test_search_orders_by_distance(client):
    headers = _patient(client, "geo-rank")
    far = _geo_hospital(client, "geo-maa", MAA)
    near = _geo_hospital(client, "geo-blr", BLR)

    resp = client.post(
        "/mcp/call",
        json={"tool": "search_hospitals", "input": {**BLR}},
        headers=headers,
    )
    hospitals = resp.json()["result"]["hospitals"]
    mine = [h for h in hospitals if h["id"] in (near["id"], far["id"])]
    assert [h["id"] for h in mine] == [near["id"], far["id"]]
    assert mine[0]["distance_km"] is not None and mine[0]["distance_km"] < 1
    assert mine[1]["distance_km"] is not None and mine[1]["distance_km"] > 200
    assert all("distance_km" in h for h in hospitals)


def test_search_radius_filters(client):
    headers = _patient(client, "geo-radius")
    far = _geo_hospital(client, "geo-maa2", MAA)
    near = _geo_hospital(client, "geo-blr2", BLR)

    resp = client.post(
        "/mcp/call",
        json={"tool": "search_hospitals", "input": {**BLR, "radius_km": 100}},
        headers=headers,
    )
    ids = [h["id"] for h in resp.json()["result"]["hospitals"]]
    assert near["id"] in ids
    assert far["id"] not in ids


def test_search_doctors_orders_by_hospital_distance(client):
    headers = _patient(client, "geo-docs")
    far = _geo_hospital(client, "geo-maa3", MAA)
    near = _geo_hospital(client, "geo-blr3", BLR)
    _active_doctor(client, far, "geo-far")
    _active_doctor(client, near, "geo-near")

    docs = client.post(
        "/mcp/call",
        json={"tool": "search_doctors", "input": {**BLR}},
        headers=headers,
    ).json()["result"]["doctors"]
    mine = [d for d in docs if d["name"] in ("Dr. geo-far", "Dr. geo-near")]
    assert [d["name"] for d in mine] == ["Dr. geo-near", "Dr. geo-far"]
    assert mine[0]["distance_km"] is not None and mine[0]["distance_km"] < 1
