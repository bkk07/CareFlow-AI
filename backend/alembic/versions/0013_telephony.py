"""Patient contact identity for the telephone channel.

Revision ID: 0013_telephony
Revises: 0012_dashboards
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_telephony"
down_revision: Union[str, None] = "0012_dashboards"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "patient_profiles",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("patient_user_id", sa.Uuid(), nullable=False),
        sa.Column("phone", sa.String(length=32), nullable=True),
        sa.Column("full_name", sa.String(length=255), nullable=True),
        sa.Column("date_of_birth", sa.Date(), nullable=True),
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
        "ix_patient_profiles_patient_user_id",
        "patient_profiles",
        ["patient_user_id"],
        unique=True,
    )
    op.create_index("ix_patient_profiles_phone", "patient_profiles", ["phone"])


def downgrade() -> None:
    op.drop_index("ix_patient_profiles_phone", table_name="patient_profiles")
    op.drop_index(
        "ix_patient_profiles_patient_user_id", table_name="patient_profiles"
    )
    op.drop_table("patient_profiles")
