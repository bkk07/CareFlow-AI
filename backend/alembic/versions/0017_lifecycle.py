"""Hospital lifecycle completion: operating hours + review notes.

Revision ID: 0017_lifecycle
Revises: 0016_geo
Create Date: 2026-09-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0017_lifecycle"
down_revision: Union[str, None] = "0016_geo"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "hospitals",
        sa.Column("operating_hours", JSONB(), nullable=True),
    )
    op.add_column(
        "hospitals",
        sa.Column("review_notes", sa.String(length=1000), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("hospitals", "review_notes")
    op.drop_column("hospitals", "operating_hours")
