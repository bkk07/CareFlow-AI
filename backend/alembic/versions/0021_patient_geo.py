"""Patient home coordinates for distance-based nearby care.

Revision ID: 0021_patient_geo
Revises: 0020_notifications_read
Create Date: 2026-09-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_patient_geo"
down_revision: Union[str, None] = "0020_notifications_read"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("patient_profiles", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("patient_profiles", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("patient_profiles", "longitude")
    op.drop_column("patient_profiles", "latitude")
