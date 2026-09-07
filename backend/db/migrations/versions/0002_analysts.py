"""analysts table - required for JWT auth (SKILL-security.md Section 2) but
not in the original locked schema (SKILL-data-schema.md never defines a users
table). Added here as a flagged gap-fill, not a silent schema change: Module 1
noted this gap; Module 7 (FastAPI Layer) needs it to exist.

Revision ID: 0002
Revises: 0001
Create Date: 2026-09-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "analysts",
        sa.Column(
            "analyst_id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column("username", sa.Text(), nullable=False, unique=True),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("analysts")
