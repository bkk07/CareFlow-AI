"""Hospital cover photo for cards/demo.

Revision ID: 0022_hospital_image_url
Revises: 0021_patient_geo
Create Date: 2026-09-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0022_hospital_image_url"
down_revision: Union[str, None] = "0021_patient_geo"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("hospitals", sa.Column("image_url", sa.String(1000), nullable=True))


def downgrade() -> None:
    op.drop_column("hospitals", "image_url")
