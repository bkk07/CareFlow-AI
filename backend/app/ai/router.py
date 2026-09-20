"""Text chat endpoint (dev-facing in Phase 9; ChatDebug page calls this)."""

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.ai.agent.orchestrator import AINotConfiguredError, run_conversation
from app.core.db import get_db
from app.core.deps import RequestContext, require_role
from app.domain.auth.models import Role
from app.observability.tracing import span

router = APIRouter(tags=["chat"])

_chatter = require_role(Role.patient, Role.hospital_admin)


class BookingSelectionIn(BaseModel):
    """Typed frontend tap (§12): {"type": "booking_selection",
    "field": hospital|doctor|appointment_type|date|start_time|
    consultation_mode, "value": ...}. Updates the same canonical state a
    spoken phrase would — never re-parsed as free text."""

    type: str = "booking_selection"
    field: str
    value: str


class ChatIn(BaseModel):
    message: str
    conversation_id: str | None = None
    # Live location for THIS message (from "Use my location"). Outranks the
    # saved home point for nearby ranking; never persisted here.
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    selection: BookingSelectionIn | None = None


class DoctorCardOut(BaseModel):
    id: str
    name: str
    photo_url: str | None = None
    hospital_name: str
    hospital_city: str | None = None
    specialty: str | None = None
    distance_km: float | None = None


class SlotOut(BaseModel):
    start: str
    end: str


class PendingBookingOut(BaseModel):
    kind: str = "create"
    doctor_id: str | None = None
    appointment_type_id: str | None = None
    slot_start: str | None = None
    slot_end: str | None = None
    appointment_id: str | None = None
    consultation_mode: str | None = None


class AppointmentTypeOut(BaseModel):
    id: str
    name: str
    duration_minutes: int


class DayScheduleOut(BaseModel):
    doctor_id: str
    date: str
    working_hours: list[SlotOut] = []
    busy: list[SlotOut] = []


class HospitalOut(BaseModel):
    id: str | None = None
    name: str | None = None


class ChatOut(BaseModel):
    conversation_id: str
    reply: str
    iterations: int
    escalated: bool
    stopped: bool = False
    # Phase 2 canonical snapshot (§19): structured values, never inferred
    # from prose. All optional so older frontends keep working.
    hospital: HospitalOut | None = None
    selected_date: str | None = None
    selected_start: str | None = None
    selected_end: str | None = None
    duration_minutes: int | None = None
    missing_fields: list[str] = []
    doctors: list[DoctorCardOut] = []
    doctors_total: int = 0
    has_more_doctors: bool = False
    slots: list[SlotOut] = []
    appointment_types: list[AppointmentTypeOut] = []
    day_schedule: DayScheduleOut | None = None
    consultation_modes: list[str] = []
    booking_stage: str = "browse"
    pending_booking: PendingBookingOut | None = None


@router.post("/chat", response_model=ChatOut)
def chat(
    body: ChatIn,
    db: Session = Depends(get_db),
    ctx: RequestContext = Depends(_chatter),
) -> ChatOut:
    # The turn span is the "AI latency" signal: one audit row per
    # request carrying the turn's correlation, duration, and outcome.
    with span(
        db, "chat.turn", conversation_id=body.conversation_id
    ) as info:
        try:
            result = run_conversation(
                db=db,
                ctx=ctx,
                conversation_id=body.conversation_id,
                user_message=body.message,
                latitude=body.latitude,
                longitude=body.longitude,
                selection=body.selection.model_dump() if body.selection else None,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(exc)
            ) from exc
        except AINotConfiguredError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)
            ) from exc
        except Exception as exc:
            # Model-backend trouble (auth, network, bad response) is a vendor
            # failure, not a crash: report 502 like the EHR path does.
            if isinstance(exc, httpx.HTTPError):
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Model backend error: {exc}",
                ) from exc
            raise
        info["iterations"] = result.get("iterations")
        info["escalated"] = result.get("escalated")
        info["stopped"] = result.get("stopped")
    return ChatOut(**result)


__all__ = ["router"]
