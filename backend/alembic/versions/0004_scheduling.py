"""Create calendars, availability_rules, blocked_slots tables.

Revision ID: 0004_scheduling
Revises: 0003_config_doctors
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.domain.scheduling.models import BlockedReason, Recurrence

revision: str = "0004_scheduling"
down_revision: Union[str, None] = "0003_config_doctors"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "calendars",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("doctor_id", sa.Uuid(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("doctor_id"),
    )
    op.create_index("ix_calendars_doctor_id", "calendars", ["doctor_id"])
    op.create_table(
        "availability_rules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("doctor_id", sa.Uuid(), nullable=False),
        sa.Column("day_of_week", sa.Integer(), nullable=True),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column("recurrence", sa.Enum(Recurrence, name="recurrence"), nullable=False),
        sa.Column("valid_from", sa.Date(), nullable=True),
        sa.Column("valid_to", sa.Date(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_availability_rules_doctor_id", "availability_rules", ["doctor_id"]
    )
    op.create_table(
        "blocked_slots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("doctor_id", sa.Uuid(), nullable=False),
        sa.Column("start_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "reason",
            sa.Enum(BlockedReason, name="blocked_reason"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("doctor_id", "start_datetime", "end_datetime"),
    )
    op.create_index("ix_blocked_slots_doctor_id", "blocked_slots", ["doctor_id"])


def downgrade() -> None:
    op.drop_index("ix_blocked_slots_doctor_id", table_name="blocked_slots")
    op.drop_table("blocked_slots")
    sa.Enum(BlockedReason, name="blocked_reason").drop(
        op.get_bind(), checkfirst=True
    )
    op.drop_index("ix_availability_rules_doctor_id", table_name="availability_rules")
    op.drop_table("availability_rules")
    sa.Enum(Recurrence, name="recurrence").drop(op.get_bind(), checkfirst=True)
    op.drop_index("ix_calendars_doctor_id", table_name="calendars")
    op.drop_table("calendars")
