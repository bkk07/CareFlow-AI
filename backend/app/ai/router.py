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
    """Typed frontend tap (§12, P4): {"type": "booking_selection",
    "field": hospital|doctor|appointment_type|date|start_time|
    consultation_mode, "value": ...}. Updates the same canonical state a
    spoken phrase would — never re-parsed as free text.

    Widget identity (all optional so older frontends keep working):
    message_id + state_revision pin the tap to the exact reply whose
    widget produced it. A tap citing an older revision is stale and is
    rejected WITHOUT mutating booking state."""

    type: str = "booking_selection"
    field: str
    value: str
    message_id: str | None = None
    state_revision: int | None = None
    widget_id: str | None = None


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
    # Concierge enrichment (all optional; only real backend data).
    experience_years: int | None = None
    consultation_types: list[str] = []
    available_durations: list[int] = []
    why_match: list[str] = []


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


class BookingSummaryOut(BaseModel):
    """Structured pending-booking snapshot (P6): facts only, never prose."""

    doctor: dict | None = None
    hospital: dict | None = None
    date: str | None = None
    visit_type: dict | None = None
    consultation_mode: str | None = None
    slot: dict | None = None
    status: str = "Not ready to book"
    missing: list[str] = []
    can_confirm: bool = False
    changes: list[dict] = []


class ChatOut(BaseModel):
    conversation_id: str
    reply: str
    iterations: int
    escalated: bool
    stopped: bool = False
    # Widget versioning (P4/P9): every interactive widget in this reply
    # belongs to message_id @ state_revision. Taps citing anything older
    # are stale and rejected without mutating state.
    message_id: str | None = None
    state_revision: int = 0
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
    booking_summary: BookingSummaryOut | None = None
    # --- Concierge experience contract (all optional, backward compatible).
    # message/experience/state/data/actions mirror the spec §11; the flat
    # fields above stay as the legacy rendering path. New frontends prefer
    # `surface` + typed payloads below.
    surface: str = "TEXT"
    title: str | None = None
    allow_explore_more: bool = False
    allow_compare: bool = False
    intent: str | None = None
    stage: str | None = None
    care_context: dict | None = None
    quick_replies: list[str] = []
    compare: dict | None = None
    filter_choices: list[dict] = []
    actions: list[dict] = []
    upcoming_appointment: dict | None = None
    questionnaire: dict | None = None


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
