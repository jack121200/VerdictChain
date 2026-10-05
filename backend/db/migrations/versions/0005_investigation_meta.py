"""Per-investigation metadata (noise, primary agent, provider) and the query indexes.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "investigations",
        sa.Column("noise_pct", sa.SmallInteger(), nullable=False, server_default=sa.text("0")),
    )
    op.create_check_constraint("ck_investigations_noise_pct", "investigations", "noise_pct IN (0, 15, 30)")
    op.add_column("investigations", sa.Column("effective_noise_pct", sa.REAL(), nullable=True))
    op.add_column("investigations", sa.Column("primary_agent", sa.Text(), nullable=True))
    op.add_column("debate_transcripts", sa.Column("provider", sa.Text(), nullable=True))

    op.create_index("idx_credibility_log_agent_created", "credibility_log", ["agent_id", "created_at"])
    op.create_index("idx_investigations_created_at", "investigations", ["created_at"])
    op.create_index("idx_investigations_status", "investigations", ["status"])


def downgrade() -> None:
    op.drop_index("idx_investigations_status", table_name="investigations")
    op.drop_index("idx_investigations_created_at", table_name="investigations")
    op.drop_index("idx_credibility_log_agent_created", table_name="credibility_log")

    op.drop_column("debate_transcripts", "provider")
    op.drop_column("investigations", "primary_agent")
    op.drop_column("investigations", "effective_noise_pct")
    op.drop_constraint("ck_investigations_noise_pct", "investigations", type_="check")
    op.drop_column("investigations", "noise_pct")
