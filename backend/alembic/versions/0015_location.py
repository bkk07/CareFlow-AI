"""Location for nearby care: hospital city + patient saved city.

Revision ID: 0015_location
Revises: 0014_observability
Create Date: 2026-09-17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015_location"
down_revision: Union[str, None] = "0014_observability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("hospitals", sa.Column("city", sa.String(length=120), nullable=True))
    op.create_index("ix_hospitals_city", "hospitals", ["city"])
    op.add_column(
        "patient_profiles", sa.Column("city", sa.String(length=120), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("patient_profiles", "city")
    op.drop_index("ix_hospitals_city", table_name="hospitals")
    op.drop_column("hospitals", "city")
