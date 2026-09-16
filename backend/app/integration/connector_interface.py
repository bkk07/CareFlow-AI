"""EHR connector contract, shared DTOs, and typed errors.

Every EHR vendor implementation (starting with the mock) speaks this
interface. The IntegrationService is the only production caller, and the
unknown-outcome recovery in later phases depends on
`find_appointment_by_idempotency_key` existing here.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol


@dataclass(frozen=True)
class CreateAppointmentRequest:
    patient_external_id: str
    provider_external_id: str
    start: datetime
    end: datetime
    idempotency_key: str
    facility_external_id: str | None = None


@dataclass(frozen=True)
class UpdateAppointmentRequest:
    start: datetime
    end: datetime


@dataclass(frozen=True)
class ExternalAppointment:
    external_id: str
    status: str
    start: datetime
    end: datetime


class EHRConnectorError(Exception):
    """Base for every vendor-integration failure."""


class EHRTimeoutError(EHRConnectorError):
    """No usable response in time — outcome UNKNOWN, never blindly retried."""


class EHRNetworkError(EHRConnectorError):
    """Transport-level failure reaching the vendor."""


class EHRServerError(EHRConnectorError):
    """Vendor answered 5xx — retryable only after an idempotency lookup."""


class EHRNotFoundError(EHRConnectorError):
    """Vendor has no such record."""


class EHRValidationError(EHRConnectorError):
    """Vendor rejected the request payload (4xx) — do not retry as-is."""


class EHRConnector(Protocol):
    def create_appointment(
        self, request: CreateAppointmentRequest
    ) -> ExternalAppointment: ...

    def update_appointment(
        self, external_id: str, request: UpdateAppointmentRequest
    ) -> ExternalAppointment: ...

    def cancel_appointment(self, external_id: str) -> ExternalAppointment: ...

    def get_appointment(self, external_id: str) -> ExternalAppointment: ...

    def find_appointment_by_idempotency_key(
        self, idempotency_key: str
    ) -> ExternalAppointment | None: ...
