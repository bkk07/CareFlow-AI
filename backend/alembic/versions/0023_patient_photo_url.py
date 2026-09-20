"""Patient profile photo for portal avatar.

Revision ID: 0023_patient_photo_url
Revises: 0022_hospital_image_url
Create Date: 2026-09-20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0023_patient_photo_url"
down_revision: Union[str, None] = "0022_hospital_image_url"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("patient_profiles", sa.Column("photo_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("patient_profiles", "photo_url")
