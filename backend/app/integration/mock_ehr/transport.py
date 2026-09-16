"""Transports for reaching the mock EHR vendor API.

Production uses real HTTP (`HttpxVendorTransport`); tests inject
`TestClientVendorTransport`, which drives the same FastAPI app in-process.
Both surface transport failures as the typed connector errors so the
connector itself never knows which one it runs on.
"""

from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from app.integration.connector_interface import EHRNetworkError, EHRTimeoutError


@dataclass(frozen=True)
class VendorResponse:
    status_code: int
    payload: Any


class VendorTransport(Protocol):
    def request(
        self, method: str, path: str, json: dict | None = None
    ) -> VendorResponse: ...

    def close(self) -> None: ...


class HttpxVendorTransport:
    def __init__(
        self,
        base_url: str = "http://localhost:8000",
        timeout_s: float = 10.0,
        client: httpx.Client | None = None,
    ) -> None:
        self._client = client or httpx.Client(
            base_url=base_url, timeout=httpx.Timeout(timeout_s)
        )
        self._owns_client = client is None

    def request(
        self, method: str, path: str, json: dict | None = None
    ) -> VendorResponse:
        try:
            response = self._client.request(method, path, json=json)
        except httpx.TimeoutException as exc:
            raise EHRTimeoutError(f"{method} {path}: timed out") from exc
        except httpx.HTTPError as exc:
            raise EHRNetworkError(f"{method} {path}: transport failure") from exc
        try:
            payload = response.json()
        except ValueError:
            payload = response.text
        return VendorResponse(status_code=response.status_code, payload=payload)

    def close(self) -> None:
        if self._owns_client:
            self._client.close()


class TestClientVendorTransport:
    """In-process transport for tests — same app, no sockets."""

    def __init__(self, test_client) -> None:
        self._client = test_client

    def request(
        self, method: str, path: str, json: dict | None = None
    ) -> VendorResponse:
        response = self._client.request(method, path, json=json)
        try:
            payload = response.json()
        except ValueError:
            payload = response.text
        return VendorResponse(status_code=response.status_code, payload=payload)

    def close(self) -> None:
        pass
