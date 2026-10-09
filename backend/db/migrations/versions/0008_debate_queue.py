"""Debate queue (checklist SD2/SD4): an accepted investigation can wait with status 'queued'.

queued_at is when it was accepted (the queue is first in, first out on it). run_spec is what the worker needs
to run it later: the primary agent, the ids of the rows it reads, the ids of the scenario rows when they are
not simply every row of its scenario, the rows per agent and who asked. It holds ids and numbers only, never a
label. Both columns stay set after the debate ran, as a record of what was asked.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-09
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("investigations", sa.Column("queued_at", sa.TIMESTAMP(timezone=True), nullable=True))
    op.add_column("investigations", sa.Column("run_spec", postgresql.JSONB(), nullable=True))
    op.create_index(
        "idx_investigations_queue",
        "investigations",
        ["queued_at"],
        postgresql_where=sa.text("status = 'queued'"),
    )


def downgrade() -> None:
    op.drop_index("idx_investigations_queue", table_name="investigations")
    op.drop_column("investigations", "run_spec")
    op.drop_column("investigations", "queued_at")
