"""Create appointment + appointment history tables.

Revision ID: 0007_appointments
Revises: 0006_mock_ehr
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.domain.appointment.models import AppointmentState

revision: str = "0007_appointments"
down_revision: Union[str, None] = "0006_mock_ehr"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "appointments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("doctor_id", sa.Uuid(), nullable=False),
        sa.Column("appointment_type_id", sa.Uuid(), nullable=False),
        sa.Column("slot_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("slot_end", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "state",
            sa.Enum(AppointmentState, name="appointment_state"),
            nullable=False,
        ),
        sa.Column("external_id", sa.String(length=100), nullable=True),
        sa.Column("idempotency_key", sa.String(length=100), nullable=False),
        sa.Column("correlation_id", sa.Uuid(), nullable=False),
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
        sa.ForeignKeyConstraint(
            ["hospital_id"], ["hospitals.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(["patient_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["doctor_id"], ["doctors.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["appointment_type_id"], ["appointment_types.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_index("ix_appointments_hospital_id", "appointments", ["hospital_id"])
    op.create_index("ix_appointments_patient_id", "appointments", ["patient_id"])
    op.create_index("ix_appointments_doctor_id", "appointments", ["doctor_id"])
    op.create_index("ix_appointments_state", "appointments", ["state"])
    op.create_index("ix_appointments_external_id", "appointments", ["external_id"])
    op.create_index(
        "ix_appointments_idempotency_key", "appointments", ["idempotency_key"]
    )
    op.create_table(
        "appointment_history",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column(
            "from_state",
            sa.Enum(AppointmentState, name="appointment_state"),
            nullable=False,
        ),
        sa.Column(
            "to_state",
            sa.Enum(AppointmentState, name="appointment_state"),
            nullable=False,
        ),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("actor_system", sa.String(length=50), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column("correlation_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id"], ["appointments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["actor_user_id"], ["users.id"], ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_appointment_history_appointment_id",
        "appointment_history",
        ["appointment_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_appointment_history_appointment_id", table_name="appointment_history"
    )
    op.drop_table("appointment_history")
    op.drop_index("ix_appointments_idempotency_key", table_name="appointments")
    op.drop_index("ix_appointments_external_id", table_name="appointments")
    op.drop_index("ix_appointments_state", table_name="appointments")
    op.drop_index("ix_appointments_doctor_id", table_name="appointments")
    op.drop_index("ix_appointments_patient_id", table_name="appointments")
    op.drop_index("ix_appointments_hospital_id", table_name="appointments")
    op.drop_table("appointments")
    sa.Enum(AppointmentState, name="appointment_state").drop(
        op.get_bind(), checkfirst=True
    )
