"""Appointment consultation mode: how the visit happens.

Revision ID: 0019_appointment_consultation_mode
Revises: 0018_doctor_durations
Create Date: 2026-09-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_appointment_consultation_mode"
down_revision: Union[str, None] = "0018_doctor_durations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Nullable: bookings made before this field existed stay NULL
    # ("not specified").
    op.add_column(
        "appointments",
        sa.Column("consultation_mode", sa.String(length=20), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("appointments", "consultation_mode")
