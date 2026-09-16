"""Scheduling schemas."""

import uuid
from datetime import date, datetime, time

from pydantic import BaseModel, Field

from app.domain.scheduling.models import BlockedReason, Recurrence


class CalendarOut(BaseModel):
    id: uuid.UUID
    doctor_id: uuid.UUID
    is_active: bool


class CalendarUpdateIn(BaseModel):
    is_active: bool


class AvailabilityRuleCreateIn(BaseModel):
    day_of_week: int | None = Field(default=None, ge=0, le=6)
    start_time: time
    end_time: time
    recurrence: Recurrence = Recurrence.weekly
    valid_from: date | None = None
    valid_to: date | None = None


class AvailabilityRuleOut(AvailabilityRuleCreateIn):
    id: uuid.UUID
    doctor_id: uuid.UUID
    created_at: datetime


class BlockedSlotCreateIn(BaseModel):
    start_datetime: datetime
    end_datetime: datetime
    reason: BlockedReason = BlockedReason.ad_hoc


class BlockedSlotOut(BlockedSlotCreateIn):
    id: uuid.UUID
    doctor_id: uuid.UUID


class SlotOut(BaseModel):
    start: datetime
    end: datetime
