"""Link doctor profiles to logins; scope capability log by hospital.

Revision ID: 0012_dashboards
Revises: 0011_questionnaire
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_dashboards"
down_revision: Union[str, None] = "0011_questionnaire"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("doctors", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.create_unique_constraint("uq_doctors_user_id", "doctors", ["user_id"])
    op.create_foreign_key(
        "fk_doctors_user_id",
        "doctors",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "capability_executions", sa.Column("hospital_id", sa.Uuid(), nullable=True)
    )
    op.create_index(
        "ix_capability_executions_hospital_id",
        "capability_executions",
        ["hospital_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_capability_executions_hospital_id",
        table_name="capability_executions",
    )
    op.drop_column("capability_executions", "hospital_id")
    op.drop_constraint("fk_doctors_user_id", "doctors", type_="foreignkey")
    op.drop_constraint("uq_doctors_user_id", "doctors", type_="unique")
    op.drop_column("doctors", "user_id")
