"""Observability polish: notifications carry the causing correlation id.

Revision ID: 0014_observability
Revises: 0013_telephony
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_observability"
down_revision: Union[str, None] = "0013_telephony"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "notifications", sa.Column("correlation_id", sa.Uuid(), nullable=True)
    )
    op.create_index(
        "ix_notifications_correlation_id",
        "notifications",
        ["correlation_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_notifications_correlation_id", table_name="notifications")
    op.drop_column("notifications", "correlation_id")
