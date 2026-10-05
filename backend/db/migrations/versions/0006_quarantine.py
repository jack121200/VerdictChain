"""agent_quarantine: persistent isolation state for the three investigator agents.

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_quarantine",
        sa.Column("agent_id", sa.Text(), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("set_by", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint(
            "agent_id IN ('network_traffic', 'access_log', 'endpoint_behavior')",
            name="ck_agent_quarantine_agent_id",
        ),
    )
    op.execute(
        "INSERT INTO agent_quarantine (agent_id, active) VALUES "
        "('network_traffic', false), ('access_log', false), ('endpoint_behavior', false) "
        "ON CONFLICT DO NOTHING"
    )


def downgrade() -> None:
    op.drop_table("agent_quarantine")
