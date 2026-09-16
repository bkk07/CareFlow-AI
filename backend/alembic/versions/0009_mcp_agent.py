"""Create MCP tables: capability audit log + escalation queue.

Revision ID: 0009_mcp_agent
Revises: 0008_reliability
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.mcp_server.models import EscalationStatus, ExecutionStatus

revision: str = "0009_mcp_agent"
down_revision: Union[str, None] = "0008_reliability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "capability_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tool_name", sa.String(length=100), nullable=False),
        sa.Column("input", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            sa.Enum(ExecutionStatus, name="execution_status"),
            nullable=False,
        ),
        sa.Column("latency_ms", sa.Float(), nullable=False),
        sa.Column("correlation_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_capability_executions_tool_name",
        "capability_executions",
        ["tool_name"],
    )
    op.create_index(
        "ix_capability_executions_correlation_id",
        "capability_executions",
        ["correlation_id"],
    )
    op.create_table(
        "escalations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.String(length=100), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), nullable=True),
        sa.Column("reason", sa.String(length=1000), nullable=False),
        sa.Column(
            "status",
            sa.Enum(EscalationStatus, name="escalation_status"),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_escalations_conversation_id",
        "escalations",
        ["conversation_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_escalations_conversation_id", table_name="escalations"
    )
    op.drop_table("escalations")
    op.drop_index(
        "ix_capability_executions_correlation_id",
        table_name="capability_executions",
    )
    op.drop_index(
        "ix_capability_executions_tool_name",
        table_name="capability_executions",
    )
    op.drop_table("capability_executions")
    sa.Enum(ExecutionStatus, name="execution_status").drop(
        op.get_bind(), checkfirst=True
    )
    sa.Enum(EscalationStatus, name="escalation_status").drop(
        op.get_bind(), checkfirst=True
    )
