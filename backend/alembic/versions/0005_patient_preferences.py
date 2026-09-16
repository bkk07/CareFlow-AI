"""Create user_preferences table.

Revision ID: 0005_patient_preferences
Revises: 0004_scheduling
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.domain.patient.models import ConsultationMode, TimeOfDay

revision: str = "0005_patient_preferences"
down_revision: Union[str, None] = "0004_scheduling"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "user_preferences",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_user_id", sa.Uuid(), nullable=False),
        sa.Column("preferred_doctor_id", sa.Uuid(), nullable=True),
        sa.Column("preferred_hospital_id", sa.Uuid(), nullable=True),
        sa.Column("preferred_appointment_type_id", sa.Uuid(), nullable=True),
        sa.Column(
            "preferred_time_of_day",
            sa.Enum(TimeOfDay, name="time_of_day"),
            nullable=True,
        ),
        sa.Column(
            "preferred_consultation_mode",
            sa.Enum(ConsultationMode, name="consultation_mode"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("patient_user_id"),
    )
    op.create_index(
        "ix_user_preferences_patient_user_id",
        "user_preferences",
        ["patient_user_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_user_preferences_patient_user_id", table_name="user_preferences"
    )
    op.drop_table("user_preferences")
    sa.Enum(TimeOfDay, name="time_of_day").drop(op.get_bind(), checkfirst=True)
    sa.Enum(ConsultationMode, name="consultation_mode").drop(
        op.get_bind(), checkfirst=True
    )
