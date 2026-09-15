"""Create departments, specialties, appointment_types, doctors tables.

Revision ID: 0003_config_doctors
Revises: 0002_hospitals_audit
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

from app.domain.doctor.models import DoctorStatus

revision: str = "0003_config_doctors"
down_revision: Union[str, None] = "0002_hospitals_audit"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _timestamps():
    return [
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
    ]


def upgrade() -> None:
    op.create_table(
        "departments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hospital_id", "name"),
    )
    op.create_index("ix_departments_hospital_id", "departments", ["hospital_id"])
    op.create_table(
        "specialties",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hospital_id", "name"),
    )
    op.create_index("ix_specialties_hospital_id", "specialties", ["hospital_id"])
    op.create_table(
        "appointment_types",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("compatible_specialty_ids", JSONB(), nullable=False),
        *_timestamps(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hospital_id", "name"),
    )
    op.create_index(
        "ix_appointment_types_hospital_id", "appointment_types", ["hospital_id"]
    )
    op.create_table(
        "doctors",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("photo_url", sa.String(length=1000), nullable=True),
        sa.Column("specialty_id", sa.Uuid(), nullable=True),
        sa.Column("department_id", sa.Uuid(), nullable=True),
        sa.Column("qualifications", JSONB(), nullable=False),
        sa.Column("experience_years", sa.Integer(), nullable=False),
        sa.Column("languages", JSONB(), nullable=False),
        sa.Column("consultation_types", JSONB(), nullable=False),
        sa.Column("default_duration_minutes", sa.Integer(), nullable=False),
        sa.Column("external_provider_id", sa.String(length=255), nullable=True),
        sa.Column(
            "status", sa.Enum(DoctorStatus, name="doctor_status"), nullable=False
        ),
        *_timestamps(),
        sa.ForeignKeyConstraint(
            ["specialty_id"], ["specialties.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["department_id"], ["departments.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hospital_id", "external_provider_id"),
    )
    op.create_index("ix_doctors_hospital_id", "doctors", ["hospital_id"])


def downgrade() -> None:
    op.drop_index("ix_doctors_hospital_id", table_name="doctors")
    op.drop_table("doctors")
    sa.Enum(DoctorStatus, name="doctor_status").drop(op.get_bind(), checkfirst=True)
    op.drop_index(
        "ix_appointment_types_hospital_id", table_name="appointment_types"
    )
    op.drop_table("appointment_types")
    op.drop_index("ix_specialties_hospital_id", table_name="specialties")
    op.drop_table("specialties")
    op.drop_index("ix_departments_hospital_id", table_name="departments")
    op.drop_table("departments")
