"""Tenant-isolation query helper — apply to every hospital-scoped model."""

from sqlalchemy.orm import Query, Session

from app.core.deps import RequestContext
from app.domain.auth.models import Role


def hospital_scoped_query(model, ctx: RequestContext, session: Session) -> Query:
    """Return a query for `model` filtered to the caller's hospital.

    `platform_admin` bypasses the filter; everyone else is restricted to
    rows whose `hospital_id` matches their own. Never trust a client-supplied
    hospital id — the filter always comes from the authenticated context.
    """
    q = session.query(model)
    if ctx.role != Role.platform_admin:
        q = q.filter(model.hospital_id == ctx.hospital_id)
    return q
