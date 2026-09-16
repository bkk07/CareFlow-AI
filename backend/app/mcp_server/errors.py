"""Capability error types — all surface as HTTP errors on /mcp/call."""

from fastapi import HTTPException, status


class CapabilityAuthError(HTTPException):
    def __init__(self, detail: str = "Role is not allowed to use this capability"):
        super().__init__(
            status_code=status.HTTP_403_FORBIDDEN, detail=detail
        )


class CapabilityValidationError(HTTPException):
    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=detail
        )


class ToolUnavailableError(HTTPException):
    """A planned capability whose backend phase has not landed yet."""

    def __init__(self, detail: str):
        super().__init__(
            status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=detail
        )


__all__ = [
    "CapabilityAuthError",
    "CapabilityValidationError",
    "ToolUnavailableError",
]
