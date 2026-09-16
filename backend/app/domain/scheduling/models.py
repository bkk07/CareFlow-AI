"""Scheduling models: calendars, availability rules, blocked slots.

Timezone contract: every timestamp is stored as UTC. Rule `start_time` /
`end_time` are UTC wall-clock times; API inputs with offsets are converted
at the edges, and naive datetimes are rejected outright.
"""

import enum
import uuid
from datetime import date, datetime, time

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Integer, Time, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class Recurrence(str, enum.Enum):
    weekly = "weekly"
    one_off = "one_off"


class BlockedReason(str, enum.Enum):
    leave = "leave"
    ad_hoc = "ad_hoc"
    appointment = "appointment"


class Calendar(Base):
    __tablename__ = "calendars"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid,
        ForeignKey("doctors.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )
    is_active: Mapped[bool] = mapped_column(nullable=False, default=True)


class AvailabilityRule(Base):
    __tablename__ = "availability_rules"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 0=Monday..6=Sunday. Required for weekly rules, ignored for one_off.
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    recurrence: Mapped[Recurrence] = mapped_column(
        Enum(Recurrence, name="recurrence", validate_strings=True), nullable=False
    )
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class BlockedSlot(Base):
    __tablename__ = "blocked_slots"
    __table_args__ = (
        # Belt-and-suspenders with the reserve-time overlap re-check: two
        # identical blocks for one doctor cannot both exist, so concurrent
        # reservations of the same discrete slot collapse to exactly one
        # winner at the database level.
        UniqueConstraint("doctor_id", "start_datetime", "end_datetime"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doctor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True
    )
    start_datetime: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    end_datetime: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    reason: Mapped[BlockedReason] = mapped_column(
        Enum(BlockedReason, name="blocked_reason", validate_strings=True),
        nullable=False,
        default=BlockedReason.ad_hoc,
    )


__all__ = [
    "AvailabilityRule",
    "Base",
    "BlockedReason",
    "BlockedSlot",
    "Calendar",
    "Recurrence",
]
