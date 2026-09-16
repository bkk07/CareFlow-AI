"""Twilio inbound webhook: caller lookup -> TwiML Media Stream.

Twilio calls `POST /voice/telephony/inbound` with form fields
(`From`, `To`, `CallSid`, ...). We look the caller number up against
patient profiles and hand Twilio a `<Stream>` pointing at our media
websocket, carrying the lookup result as custom parameters — so the
stream handler needs no shared memory, even across workers.

Request authenticity uses Twilio's HMAC-SHA1 signature scheme. When
no auth token is configured (local dev) validation is skipped openly;
production must set TWILIO_AUTH_TOKEN. When no public stream URL is
configured the webhook answers 503 so calls fail closed, not silent.
"""

import base64
import hashlib
import hmac
import logging
import uuid
from xml.sax.saxutils import quoteattr

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.audit import write_audit_event
from app.observability.correlation import for_conversation
from app.voice.telephony import identity

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/voice/telephony", tags=["telephony"])


def validate_twilio_signature(
    url: str, params: dict[str, str], signature: str | None, auth_token: str
) -> bool:
    """Twilio's documented scheme: URL + sorted key/value pairs, HMAC-SHA1."""
    if not signature:
        return False
    payload = url + "".join(key + params[key] for key in sorted(params))
    digest = hmac.new(
        auth_token.encode("utf-8"), payload.encode("utf-8"), hashlib.sha1
    ).digest()
    expected = base64.b64encode(digest).decode("ascii")
    return hmac.compare_digest(expected, signature)


def build_stream_twiml(
    *,
    stream_url: str,
    caller_phone: str,
    patient_id: str,
    conversation_id: str,
) -> str:
    params = (
        f"<Parameter name='caller_phone' value={quoteattr(caller_phone)} />"
        f"<Parameter name='patient_id' value={quoteattr(patient_id)} />"
        f"<Parameter name='conversation_id' value={quoteattr(conversation_id)} />"
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f"<Response><Connect><Stream url={quoteattr(stream_url)}>"
        f"{params}</Stream></Connect></Response>"
    )


def _form_dict(form) -> dict[str, str]:
    return {key: str(value) for key, value in form.items()}


@router.post("/inbound", response_class=Response)
async def inbound(request: Request, db: Session = Depends(get_db)) -> Response:
    stream_url = settings.telephony_stream_url.strip()
    if not stream_url:
        raise HTTPException(
            status_code=503,
            detail="Telephone channel is not configured (TELEPHONY_STREAM_URL)",
        )
    form = _form_dict(await request.form())
    if settings.twilio_auth_token:
        signature = request.headers.get("X-Twilio-Signature")
        if not validate_twilio_signature(
            str(request.url), form, signature, settings.twilio_auth_token
        ):
            raise HTTPException(status_code=403, detail="Bad Twilio signature")
    caller = form.get("From", "")
    call_sid = form.get("CallSid", "")
    patient = identity.find_patient_by_phone(db, caller)
    patient_id = str(patient.id) if patient is not None else ""
    conversation_id = uuid.uuid4().hex
    # The call's trace starts here: the media stream derives the same
    # id from the conversation, so webhook + turns + booking line up.
    correlation_id = for_conversation(conversation_id)
    write_audit_event(
        db,
        action="telephony.inbound",
        entity_type="telephony.call",
        entity_id=uuid.uuid5(uuid.NAMESPACE_URL, f"careflow:call:{call_sid or conversation_id}"),
        correlation_id=correlation_id,
        metadata={
            "caller": caller,
            "patient_id": patient_id or None,
            "conversation_id": conversation_id,
        },
    )
    db.commit()
    logger.info(
        "inbound call sid=%s caller=%s patient=%s",
        call_sid,
        caller,
        patient_id or "unknown",
    )
    twiml = build_stream_twiml(
        stream_url=stream_url,
        caller_phone=caller,
        patient_id=patient_id,
        conversation_id=conversation_id,
    )
    return Response(content=twiml, media_type="text/xml")


@router.post("/status", status_code=204)
async def status_callback(request: Request) -> None:
    """Twilio status pings (completed/busy/failed/no-answer): logged only.

    A dropped call mid-booking needs no special handling — the booking
    went through the normal capability path, so Phase 8 verification /
    reconciliation already covers the unknown outcome.
    """
    form = _form_dict(await request.form())
    logger.info(
        "call status sid=%s status=%s",
        form.get("CallSid", ""),
        form.get("CallStatus", ""),
    )


__all__ = ["build_stream_twiml", "router", "validate_twilio_signature"]
