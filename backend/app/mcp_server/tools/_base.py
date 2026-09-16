"""Shared tool wrapper: auth + idempotency + audit + bounded retry.

Every capability module decorates its `run` function with `mcp_tool`
and registers it with the server. Tool functions stay thin — they
validate scope, call an existing domain service, and return a plain
JSON-serializable dict.
"""

import time
from functools import wraps
from typing import Any, Callable

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.middleware import audit as audit_mw
from app.mcp_server.middleware import auth as auth_mw
from app.mcp_server.middleware import idempotency as idem_mw
from app.mcp_server.middleware import retry_policy
from app.mcp_server.models import ExecutionStatus
from app.observability.correlation import get_correlation_id

_integration_factory: Callable[[Session], IntegrationService] | None = None


def set_integration_factory(
    factory: Callable[[Session], IntegrationService] | None,
) -> None:
    """Test hook: stub the vendor connector for tool calls."""
    global _integration_factory
    _integration_factory = factory


def build_integration(session: Session) -> IntegrationService:
    if _integration_factory is not None:
        return _integration_factory(session)
    return IntegrationService(session=session)


def mcp_tool(
    name: str,
    *,
    retry_safe: bool,
    requires_idempotency: bool,
    allowed_roles: list[Role],
):
    """Wrap a capability with the cross-cutting middleware."""

    def decorator(fn: Callable[..., dict[str, Any]]):
        @wraps(fn)
        def wrapper(
            input: BaseModel, ctx: RequestContext, db: Session
        ) -> dict[str, Any]:
            integration = build_integration(db)
            # One turn, one id: the request/voice-call correlation flows
            # through ctx into the execution row AND (stamped back on ctx)
            # into every domain row the tool creates. A bare ctx with no
            # id falls back to the ambient one instead of minting a fresh
            # id per tool — that was the Phase 15 audit's main finding.
            correlation_id = ctx.correlation_id or get_correlation_id()
            ctx.correlation_id = correlation_id
            start = time.perf_counter()
            error: str | None = None
            try:
                # Denied calls are audited too — they are the most
                # security-relevant rows in the log.
                auth_mw.check_roles(ctx, allowed_roles, tool=name)
                if requires_idempotency:
                    idem_mw.require_key(idem_mw.extract_key(input), tool=name)
                if retry_safe:
                    result = retry_policy.run_retry_safe(
                        lambda: fn(input, ctx=ctx, db=db, integration=integration)
                    )
                else:
                    result = fn(input, ctx=ctx, db=db, integration=integration)
                status = ExecutionStatus.success
            except Exception as exc:
                status = ExecutionStatus.error
                error = f"{type(exc).__name__}: {exc}"
                raise
            finally:
                audit_mw.record_execution(
                    db,
                    tool=name,
                    input=input,
                    status=status,
                    latency_ms=(time.perf_counter() - start) * 1000,
                    correlation_id=correlation_id,
                    actor=ctx,
                    error=error,
                )
            return result

        wrapper._mcp_tool_meta = {  # type: ignore[attr-defined]
            "name": name,
            "retry_safe": retry_safe,
            "requires_idempotency": requires_idempotency,
            "allowed_roles": allowed_roles,
            "input_model": fn.__annotations__.get("input"),
            # Full docstring: the model reads the whole instruction,
            # not just the first line (this is where per-tool AGENT
            # RULEs live, e.g. the questionnaire guard).
            "description": (fn.__doc__ or "").strip() or name,
        }
        return wrapper

    return decorator


__all__ = ["build_integration", "mcp_tool", "set_integration_factory"]
