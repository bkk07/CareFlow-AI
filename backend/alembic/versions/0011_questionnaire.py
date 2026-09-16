"""Create questionnaire tables: sets, ordered questions, responses.

Revision ID: 0011_questionnaire
Revises: 0010_workflow
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.domain.questionnaire.models import QuestionnaireScope, QuestionType

revision: str = "0011_questionnaire"
down_revision: Union[str, None] = "0010_workflow"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "questionnaires",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("hospital_id", sa.Uuid(), nullable=False),
        sa.Column(
            "scope",
            sa.Enum(QuestionnaireScope, name="questionnaire_scope"),
            nullable=False,
        ),
        sa.Column("scope_ref_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
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
    op.create_index(
        "ix_questionnaires_hospital_id", "questionnaires", ["hospital_id"]
    )
    op.create_table(
        "questionnaire_questions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        sa.Column(
            "type",
            sa.Enum(QuestionType, name="question_type"),
            nullable=False,
        ),
        sa.Column("prompt", sa.String(length=1000), nullable=False),
        sa.Column("options", sa.JSON(), nullable=True),
        sa.Column("required", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["questionnaire_id"], ["questionnaires.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_questionnaire_questions_questionnaire_id",
        "questionnaire_questions",
        ["questionnaire_id"],
    )
    op.create_table(
        "questionnaire_responses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("appointment_id", sa.Uuid(), nullable=False),
        sa.Column("questionnaire_id", sa.Uuid(), nullable=False),
        sa.Column("answers", sa.JSON(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(
            ["appointment_id"], ["appointments.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["questionnaire_id"], ["questionnaires.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("appointment_id", "questionnaire_id"),
    )
    op.create_index(
        "ix_questionnaire_responses_appointment_id",
        "questionnaire_responses",
        ["appointment_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_questionnaire_responses_appointment_id",
        table_name="questionnaire_responses",
    )
    op.drop_table("questionnaire_responses")
    op.drop_index(
        "ix_questionnaire_questions_questionnaire_id",
        table_name="questionnaire_questions",
    )
    op.drop_table("questionnaire_questions")
    op.drop_index(
        "ix_questionnaires_hospital_id", table_name="questionnaires"
    )
    op.drop_table("questionnaires")
    sa.Enum(QuestionType, name="question_type").drop(
        op.get_bind(), checkfirst=True
    )
    sa.Enum(QuestionnaireScope, name="questionnaire_scope").drop(
        op.get_bind(), checkfirst=True
    )
