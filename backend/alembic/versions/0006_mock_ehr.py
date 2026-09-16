"""Create mock EHR + identifier mapping tables.

Revision ID: 0006_mock_ehr
Revises: 0005_patient_preferences
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.integration.mapping.models import MappingEntityType

revision: str = "0006_mock_ehr"
down_revision: Union[str, None] = "0005_patient_preferences"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mock_ehr_patients",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("mrn", sa.String(length=100), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("dob", sa.Date(), nullable=True),
        sa.Column("phone", sa.String(length=50), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("mrn"),
    )
    op.create_index("ix_mock_ehr_patients_mrn", "mock_ehr_patients", ["mrn"])
    op.create_table(
        "mock_ehr_providers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("provider_code", sa.String(length=100), nullable=False),
        sa.Column("full_name", sa.String(length=255), nullable=False),
        sa.Column("specialty", sa.String(length=255), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("provider_code"),
    )
    op.create_index(
        "ix_mock_ehr_providers_provider_code", "mock_ehr_providers", ["provider_code"]
    )
    op.create_table(
        "mock_ehr_facilities",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("code", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("code"),
    )
    op.create_index("ix_mock_ehr_facilities_code", "mock_ehr_facilities", ["code"])
    op.create_table(
        "mock_ehr_departments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("facility_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.ForeignKeyConstraint(
            ["facility_id"], ["mock_ehr_facilities.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "mock_ehr_appointments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_id", sa.Uuid(), nullable=False),
        sa.Column("provider_id", sa.Uuid(), nullable=False),
        sa.Column("facility_id", sa.Uuid(), nullable=True),
        sa.Column("start_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("end_datetime", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("idempotency_key", sa.String(length=100), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["patient_id"], ["mock_ehr_patients.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"], ["mock_ehr_providers.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["facility_id"], ["mock_ehr_facilities.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("idempotency_key"),
    )
    op.create_table(
        "external_identifier_mappings",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column(
            "entity_type",
            sa.Enum(MappingEntityType, name="mapping_entity"),
            nullable=False,
        ),
        sa.Column("internal_id", sa.Uuid(), nullable=False),
        sa.Column("external_id", sa.String(length=100), nullable=False),
        sa.Column("healthcare_system_connection_id", sa.String(length=100), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("hospital_id", "entity_type", "internal_id"),
        sa.UniqueConstraint("hospital_id", "entity_type", "external_id"),
    )
    op.create_index(
        "ix_external_identifier_mappings_hospital_id",
        "external_identifier_mappings",
        ["hospital_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_external_identifier_mappings_hospital_id",
        table_name="external_identifier_mappings",
    )
    op.drop_table("external_identifier_mappings")
    sa.Enum(MappingEntityType, name="mapping_entity").drop(
        op.get_bind(), checkfirst=True
    )
    op.drop_table("mock_ehr_appointments")
    op.drop_table("mock_ehr_departments")
    op.drop_index("ix_mock_ehr_facilities_code", table_name="mock_ehr_facilities")
    op.drop_table("mock_ehr_facilities")
    op.drop_index(
        "ix_mock_ehr_providers_provider_code", table_name="mock_ehr_providers"
    )
    op.drop_table("mock_ehr_providers")
    op.drop_index("ix_mock_ehr_patients_mrn", table_name="mock_ehr_patients")
    op.drop_table("mock_ehr_patients")
