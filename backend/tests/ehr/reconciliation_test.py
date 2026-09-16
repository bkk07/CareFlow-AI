"""ehr/reconciliation: the parked booking confirms once the vendor heals."""

from app.integration.connector_interface import EHRTimeoutError
from tests.test_mcp_agent import seed_setup, slot_iso
from tests.test_reliability import open_record_for


def rest_book(client, setup, key, hour=9):
    start, end = slot_iso(hour=hour)
    return client.post(
        "/appointments",
        json={
            "patient_id": setup["patient"]["id"],
            "doctor_id": setup["doctor"]["id"],
            "appointment_type_id": setup["type"]["id"],
            "slot_start": start,
            "slot_end": end,
            "idempotency_key": key,
        },
        headers=setup["patient"]["headers"],
    )


def test_retry_after_recovery_confirms_and_resolves(client, db, ehr_stub):
    setup = seed_setup(client, tag="ehrrecon")
    owner = setup["hosp"]["owner"]

    ehr_stub.fail_create = True
    ehr_stub.create_error = EHRTimeoutError
    try:
        parked = rest_book(client, setup, "ehr-recon-1")
    finally:
        ehr_stub.fail_create = False
    assert parked.status_code == 202, parked.text
    assert parked.json()["state"] == "reconciliation_required"
    record = open_record_for(client, owner, parked.json()["id"])
    assert record["resolution_status"] == "open"

    retried = client.post(
        f"/reconciliation/records/{record['id']}/retry", headers=owner
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["resolution_status"] == "resolved"
    assert retried.json()["appointment"]["state"] == "confirmed"
    detail = client.get(
        f"/appointments/{parked.json()['id']}", headers=owner
    ).json()
    assert detail["state"] == "confirmed"
    pairs = {(h["from_state"], h["to_state"]) for h in detail["history"]}
    assert ("reconciliation_required", "confirmed") in pairs
