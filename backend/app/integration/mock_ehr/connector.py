"""HTTP connector to the mock EHR vendor API.

Runs on any `VendorTransport`: real HTTP in production, in-process calls in
tests. HTTP statuses map to typed errors; transport failures arrive already
typed from the transport layer.
"""

from app.integration.connector_interface import (
    CreateAppointmentRequest,
    EHRNetworkError,
    EHRNotFoundError,
    EHRServerError,
    EHRTimeoutError,
    EHRValidationError,
    ExternalAppointment,
    UpdateAppointmentRequest,
)
from app.integration.mock_ehr.transport import HttpxVendorTransport, VendorTransport


def _parse_appointment(payload: dict) -> ExternalAppointment:
    from datetime import datetime, timezone

    def _dt(value: str) -> datetime:
        parsed = datetime.fromisoformat(value)
        # SQLite strips tzinfo on storage; vendor datetimes are UTC by
        # contract, so naive values are re-attached, never reinterpreted.
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)

    return ExternalAppointment(
        external_id=str(payload["id"]),
        status=str(payload["status"]),
        start=_dt(payload["start_datetime"]),
        end=_dt(payload["end_datetime"]),
        patient_external_id=str(payload["patient_id"])
        if payload.get("patient_id") is not None
        else None,
        provider_external_id=str(payload["provider_id"])
        if payload.get("provider_id") is not None
        else None,
    )


class MockEHRConnector:
    def __init__(
        self,
        transport: VendorTransport | None = None,
        base_url: str = "http://localhost:8000",
        timeout_s: float = 10.0,
    ) -> None:
        self._transport = transport or HttpxVendorTransport(
            base_url=base_url, timeout_s=timeout_s
        )

    def close(self) -> None:
        self._transport.close()

    # -- error mapping ---------------------------------------------------------

    @staticmethod
    def _detail(payload) -> str:
        if isinstance(payload, dict) and "detail" in payload:
            return str(payload["detail"])
        return str(payload)

    def _raise_for(self, status_code: int, payload, operation: str) -> None:
        if status_code < 400:
            return
        detail = self._detail(payload)
        if status_code == 504:
            raise EHRTimeoutError(f"{operation}: {detail}")
        if status_code == 503:
            raise EHRNetworkError(f"{operation}: {detail}")
        if status_code >= 500:
            raise EHRServerError(f"{operation}: {detail}")
        if status_code == 404:
            raise EHRNotFoundError(f"{operation}: {detail}")
        raise EHRValidationError(f"{operation}: {detail}")

    def _send(self, method: str, path: str, operation: str, json=None):
        result = self._transport.request(method, path, json=json)
        self._raise_for(result.status_code, result.payload, operation)
        return result.payload

    # -- vendor record sync (lookup-or-create, never hardcoded ids) -------------

    def ensure_patient(
        self, mrn: str, full_name: str = "", dob=None, phone: str | None = None
    ) -> dict:
        return self._send(
            "POST",
            "/mock-ehr/patients/lookup",
            "patient lookup",
            json={"mrn": mrn, "full_name": full_name, "dob": dob, "phone": phone},
        )

    def ensure_provider(
        self, provider_code: str, full_name: str = "", specialty: str | None = None
    ) -> dict:
        return self._send(
            "POST",
            "/mock-ehr/providers/lookup",
            "provider lookup",
            json={
                "provider_code": provider_code,
                "full_name": full_name,
                "specialty": specialty,
            },
        )

    def ensure_facility(self, code: str, name: str = "") -> dict:
        return self._send(
            "POST",
            "/mock-ehr/facilities/lookup",
            "facility lookup",
            json={"code": code, "name": name},
        )

    # -- EHRConnector protocol ---------------------------------------------------

    def create_appointment(
        self, request: CreateAppointmentRequest
    ) -> ExternalAppointment:
        payload = self._send(
            "POST",
            "/mock-ehr/appointments",
            "appointment create",
            json={
                "patient_id": request.patient_external_id,
                "provider_id": request.provider_external_id,
                "facility_id": request.facility_external_id,
                "start_datetime": request.start.isoformat(),
                "end_datetime": request.end.isoformat(),
                "idempotency_key": request.idempotency_key,
            },
        )
        return _parse_appointment(payload)

    def update_appointment(
        self, external_id: str, request: UpdateAppointmentRequest
    ) -> ExternalAppointment:
        payload = self._send(
            "PUT",
            f"/mock-ehr/appointments/{external_id}",
            "appointment update",
            json={
                "start_datetime": request.start.isoformat(),
                "end_datetime": request.end.isoformat(),
            },
        )
        return _parse_appointment(payload)

    def cancel_appointment(self, external_id: str) -> ExternalAppointment:
        payload = self._send(
            "DELETE", f"/mock-ehr/appointments/{external_id}", "appointment cancel"
        )
        return _parse_appointment(payload)

    def get_appointment(self, external_id: str) -> ExternalAppointment:
        payload = self._send(
            "GET", f"/mock-ehr/appointments/{external_id}", "appointment retrieve"
        )
        return _parse_appointment(payload)

    def find_appointment_by_idempotency_key(
        self, idempotency_key: str
    ) -> ExternalAppointment | None:
        try:
            payload = self._send(
                "GET",
                f"/mock-ehr/appointments/by-key/{idempotency_key}",
                "appointment key lookup",
            )
        except EHRNotFoundError:
            return None
        return _parse_appointment(payload)
