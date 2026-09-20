"""unit/availability: weekly rules expand to bookable slots."""

from tests.test_mcp_agent import seed_setup

MONDAY = "2026-10-05"
TUESDAY = "2026-10-06"


def get_slots(client, hosp, doctor_id, type_id, day):
    return client.get(
        f"/hospitals/{hosp['id']}/doctors/{doctor_id}/slots",
        params={
            "date_from": day,
            "date_to": day,
            "appointment_type_id": type_id,
        },
        headers=hosp["owner"],
    )


def test_weekly_rule_yields_sixteen_monday_slots(client):
    setup = seed_setup(client, tag="uavail")
    resp = get_slots(
        client, setup["hosp"], setup["doctor"]["id"], setup["type"]["id"], MONDAY
    )
    assert resp.status_code == 200, resp.text
    slots = resp.json()
    assert len(slots) == 16  # 8h x 30min
    # Rules are IST wall-time: 09:00 IST = 03:30 UTC.
    assert slots[0]["start"] == "2026-10-05T03:30:00Z"
    assert slots[-1]["end"] == "2026-10-05T11:30:00Z"


def test_other_weekday_has_no_slots(client):
    setup = seed_setup(client, tag="uavailtue")
    resp = get_slots(
        client, setup["hosp"], setup["doctor"]["id"], setup["type"]["id"], TUESDAY
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == []
