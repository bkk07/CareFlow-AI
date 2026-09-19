"""Doctor multi-duration support: available_durations on doctors.

Revision ID: 0018_doctor_durations
Revises: 0017_lifecycle
Create Date: 2026-09-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0018_doctor_durations"
down_revision: Union[str, None] = "0017_lifecycle"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "doctors",
        sa.Column("available_durations", JSONB(), nullable=True),
    )
    # Backfill from the legacy single duration (migrations run on Postgres).
    op.execute(
        sa.text(
            "UPDATE doctors SET available_durations = "
            "jsonb_build_array(default_duration_minutes) "
            "WHERE available_durations IS NULL"
        )
    )
    op.alter_column("doctors", "available_durations", nullable=False)


def downgrade() -> None:
    op.drop_column("doctors", "available_durations")
