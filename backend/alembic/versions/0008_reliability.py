"""Create reliability tables: operation log, verifications, work queue.

Revision ID: 0008_reliability
Revises: 0007_appointments
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.reliability.models import OperationStatus, OperationType, ResolutionStatus

revision: str = "0008_reliability"
down_revision: Union[str, None] = "0007_appointments"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "integration_operations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column(
            "operation_type",
            sa.Enum(OperationType, name="operation_type"),
            nullable=False,
        ),
        sa.Column("request_payload", sa.JSON(), nullable=True),
        sa.Column("response_payload", sa.JSON(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(OperationStatus, name="operation_status"),
            nullable=False,
        ),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(length=500), nullable=True),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_integration_operations_appointment_id",
        "integration_operations",
        ["appointment_id"],
    )
    op.create_table(
        "integration_verifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("verified_bool", sa.Boolean(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column(
            "verified_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["operation_id"], ["integration_operations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id"], ["appointments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_integration_verifications_operation_id",
        "integration_verifications",
        ["operation_id"],
    )
    op.create_index(
        "ix_integration_verifications_appointment_id",
        "integration_verifications",
        ["appointment_id"],
    )
    op.create_table(
        "reconciliation_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column("operation_id", sa.Uuid(), nullable=True),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("external_id", sa.String(length=100), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("external_status", sa.String(length=50), nullable=True),
        sa.Column("internal_status", sa.String(length=30), nullable=False),
        sa.Column(
            "resolution_status",
            sa.Enum(ResolutionStatus, name="resolution_status"),
            nullable=False,
        ),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(
            ["operation_id"], ["integration_operations.id"], ondelete="SET NULL"
        ),
        sa.ForeignKeyConstraint(
            ["appointment_id"], ["appointments.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_reconciliation_records_hospital_id",
        "reconciliation_records",
        ["hospital_id"],
    )
    op.create_index(
        "ix_reconciliation_records_appointment_id",
        "reconciliation_records",
        ["appointment_id"],
    )
    op.create_index(
        "ix_reconciliation_records_resolution_status",
        "reconciliation_records",
        ["resolution_status"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_reconciliation_records_resolution_status",
        table_name="reconciliation_records",
    )
    op.drop_index(
        "ix_reconciliation_records_appointment_id",
        table_name="reconciliation_records",
    )
    op.drop_index(
        "ix_reconciliation_records_hospital_id", table_name="reconciliation_records"
    )
    op.drop_table("reconciliation_records")
    sa.Enum(ResolutionStatus, name="resolution_status").drop(
        op.get_bind(), checkfirst=True
    )
    op.drop_index(
        "ix_integration_verifications_appointment_id",
        table_name="integration_verifications",
    )
    op.drop_index(
        "ix_integration_verifications_operation_id",
        table_name="integration_verifications",
    )
    op.drop_table("integration_verifications")
    op.drop_index(
        "ix_integration_operations_appointment_id",
        table_name="integration_operations",
    )
    op.drop_table("integration_operations")
    sa.Enum(OperationStatus, name="operation_status").drop(
        op.get_bind(), checkfirst=True
    )
    sa.Enum(OperationType, name="operation_type").drop(
        op.get_bind(), checkfirst=True
    )
