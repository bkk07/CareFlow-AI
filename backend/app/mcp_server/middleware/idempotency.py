"""Idempotency middleware: write capabilities must carry a key."""

from pydantic import BaseModel

from app.mcp_server.errors import CapabilityValidationError


def extract_key(input: BaseModel) -> str | None:
    value = getattr(input, "idempotency_key", None)
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def require_key(key: str | None, *, tool: str) -> str:
    if key is None:
        raise CapabilityValidationError(
            f"Capability '{tool}' requires an idempotency_key"
        )
    return key


__all__ = ["extract_key", "require_key"]
