"""Create workflow tables: notifications + execution log.

Revision ID: 0010_workflow
Revises: 0009_mcp_agent
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.notification.models import NotificationChannel, NotificationStatus
from app.workflow.models import ExecutionStatus

revision: str = "0010_workflow"
down_revision: Union[str, None] = "0009_mcp_agent"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("recipient_user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "channel",
            sa.Enum(NotificationChannel, name="notification_channel"),
            nullable=False,
        ),
        sa.Column("type", sa.String(length=100), nullable=False),
        sa.Column(
            "status",
            sa.Enum(NotificationStatus, name="notification_status"),
            nullable=False,
        ),
        sa.Column("dedupe_key", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=True),
        sa.Column("body", sa.String(length=4000), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
    )
    op.create_index(
        "ix_notifications_recipient_user_id",
        "notifications",
        ["recipient_user_id"],
    )
    op.create_table(
        "workflow_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(length=100), nullable=False),
        sa.Column(
            "status",
            sa.Enum(ExecutionStatus, name="workflow_execution_status"),
            nullable=False,
        ),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("attempt", sa.Integer(), nullable=False),
        sa.Column("execution_history", sa.JSON(), nullable=False),
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
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_workflow_executions_event_type",
        "workflow_executions",
        ["event_type"],
    )
    op.create_index(
        "ix_workflow_executions_correlation_id",
        "workflow_executions",
        ["correlation_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_workflow_executions_correlation_id",
        table_name="workflow_executions",
    )
    op.drop_index(
        "ix_workflow_executions_event_type", table_name="workflow_executions"
    )
    op.drop_table("workflow_executions")
    sa.Enum(ExecutionStatus, name="workflow_execution_status").drop(
        op.get_bind(), checkfirst=True
    )
    op.drop_index(
        "ix_notifications_recipient_user_id", table_name="notifications"
    )
    op.drop_table("notifications")
    sa.Enum(NotificationStatus, name="notification_status").drop(
        op.get_bind(), checkfirst=True
    )
    sa.Enum(NotificationChannel, name="notification_channel").drop(
        op.get_bind(), checkfirst=True
    )
