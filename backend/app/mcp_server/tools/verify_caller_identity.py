"""verify_caller_identity — confirm a phone caller against their profile.

AGENT RULES (telephone channel only):
- Call this ONLY after the caller has SPOKEN their full name and date
  of birth. Never invent either, and never read the stored values back
  to the caller ("is your name X?" leaks identity — always ask open).
- Pass conversation_id exactly as shown in the conversation context
  JSON. Pass date_of_birth as YYYY-MM-DD.
- On verified=false, ask once more and retry. After THREE failed
  attempts, stop asking and call transfer_to_human instead.
- Until this reports verified=true, every patient-data tool refuses —
  do not work around that, and do not discuss any patient details.
"""

import uuid

from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.ai.context.ai_context import get_ai_context, save_ai_context
from app.core.deps import RequestContext
from app.domain.auth.models import Role
from app.integration.integration_service import IntegrationService
from app.mcp_server.tools._base import mcp_tool
from app.voice.telephony import identity

TOOL_NAME = "verify_caller_identity"

MAX_IDENTITY_ATTEMPTS = 3


class VerifyCallerIdentityIn(BaseModel):
    conversation_id: str
    full_name: str
    date_of_birth: str


@mcp_tool(
    TOOL_NAME,
    retry_safe=True,
    requires_idempotency=False,
    allowed_roles=[Role.patient],
)
def run(
    input: VerifyCallerIdentityIn,
    *,
    ctx: RequestContext,
    db: Session,
    integration: IntegrationService,
) -> dict:
    """Confirm the caller's spoken name + DOB; unlocks patient tools."""
    del ctx, integration
    context = get_ai_context(input.conversation_id.strip())
    if context.channel != "telephony":
        return {
            "verified": False,
            "reason": "identity verification is only for telephone calls",
        }
    if context.caller_verified:
        return {"verified": True, "reason": "already verified"}
    if context.caller_patient_id is None:
        return {
            "verified": False,
            "reason": "this number matches no patient record",
            "next": "offer to take a message or transfer_to_human",
        }
    if context.identity_attempts >= MAX_IDENTITY_ATTEMPTS:
        return {
            "verified": False,
            "reason": "too many failed attempts",
            "next": "call transfer_to_human",
        }
    outcome = identity.verify_identity(
        db,
        patient_id=uuid.UUID(context.caller_patient_id),
        full_name=input.full_name,
        date_of_birth=input.date_of_birth,
    )
    context.identity_attempts += 1
    if outcome["verified"]:
        context.caller_verified = True
    save_ai_context(context)
    result = dict(outcome)
    result["attempts_remaining"] = max(
        MAX_IDENTITY_ATTEMPTS - context.identity_attempts, 0
    )
    return result
