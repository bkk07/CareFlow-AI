"""Create users table.

Revision ID: 0001_create_users
Revises:
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.domain.auth.models import Role

revision: str = "0001_create_users"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NOTE: the user_role ENUM type is created implicitly by create_table
    # on PostgreSQL — do not create it explicitly (would emit CREATE TYPE
    # twice and fail online with DuplicateObject).
    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("role", sa.Enum(Role, name="user_role"), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
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
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_hospital_id", "users", ["hospital_id"])


def downgrade() -> None:
    op.drop_index("ix_users_hospital_id", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
    sa.Enum(Role, name="user_role", validate_strings=True).drop(
        op.get_bind(), checkfirst=True
    )
