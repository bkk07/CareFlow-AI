"""Geo coordinates for distance-based hospital recommendation.

Revision ID: 0016_geo
Revises: 0015_location
Create Date: 2026-09-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_geo"
down_revision: Union[str, None] = "0015_location"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("hospitals", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("hospitals", sa.Column("longitude", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("hospitals", "longitude")
    op.drop_column("hospitals", "latitude")
