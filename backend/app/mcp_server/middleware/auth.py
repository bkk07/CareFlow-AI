"""Auth middleware: role allow-list per capability."""

from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.mcp_server.errors import CapabilityAuthError


def check_roles(
    ctx: RequestContext, allowed_roles: list[Role], *, tool: str
) -> None:
    if ctx.role not in allowed_roles:
        raise CapabilityAuthError(
            f"Role '{ctx.role.value}' may not use capability '{tool}'"
        )


__all__ = ["check_roles"]
