"""Correlation IDs: one request/call, one id, end to end.

The middleware reads `X-Correlation-ID` (generating a fresh UUID when it
is missing or malformed), pins it on a contextvar for the whole
request, and echoes it back on the response. Everything downstream —
`RequestContext`, the tool wrapper, the voice loops — reads the same
var, so one id ties together conversation, capability, scheduling, EHR,
verification, workflow, and notification rows.

WebSockets skip BaseHTTPMiddleware, so the voice loops set the var
explicitly at session start; the telephone channel derives it
deterministically from the call's conversation_id so the webhook and
the media stream share one id without shared state.
"""

import uuid
from contextvars import ContextVar, Token

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import Response

HEADER = "X-Correlation-ID"

_correlation_id_var: ContextVar[uuid.UUID | None] = ContextVar(
    "careflow_correlation_id", default=None
)


def parse_correlation_id(raw: str | None) -> uuid.UUID:
    """Caller-supplied id when it parses, otherwise a fresh one."""
    if raw:
        try:
            return uuid.UUID(raw.strip())
        except (ValueError, AttributeError, TypeError):
            pass
    return uuid.uuid4()


def get_correlation_id() -> uuid.UUID:
    """Ambient id for this request/call, generating one when absent."""
    current = _correlation_id_var.get()
    if current is None:
        current = uuid.uuid4()
        _correlation_id_var.set(current)
    return current


def set_correlation_id(value: uuid.UUID) -> Token:
    """Pin the ambient id (voice loops, background work); reset the token after."""
    return _correlation_id_var.set(value)


def reset_correlation_id(token: Token) -> None:
    """Release a pinned id (pairs with `set_correlation_id`)."""
    _correlation_id_var.reset(token)


def for_conversation(conversation_id: str) -> uuid.UUID:
    """Stable call id: the same conversation always maps to one correlation."""
    return uuid.uuid5(uuid.NAMESPACE_URL, f"careflow:{conversation_id}")


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    """Generate/propagate/echo the correlation id around every HTTP request."""

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        correlation_id = parse_correlation_id(request.headers.get(HEADER))
        token = _correlation_id_var.set(correlation_id)
        try:
            response = await call_next(request)
        finally:
            _correlation_id_var.reset(token)
        response.headers[HEADER] = str(correlation_id)
        return response


__all__ = [
    "HEADER",
    "CorrelationIdMiddleware",
    "for_conversation",
    "get_correlation_id",
    "parse_correlation_id",
    "reset_correlation_id",
    "set_correlation_id",
]
