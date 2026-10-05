"""RBAC roles on analysts, and the single-row runtime_settings table.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "analysts",
        sa.Column("role", sa.Text(), nullable=False, server_default="forensic_analyst"),
    )
    op.create_check_constraint(
        "ck_analysts_role",
        "analysts",
        "role IN ('secops_lead', 'forensic_analyst', 'red_team_auditor', 'watchdog_supervisor')",
    )

    op.create_table(
        "runtime_settings",
        sa.Column("id", sa.SmallInteger(), primary_key=True, autoincrement=False),
        sa.Column("eta", postgresql.DOUBLE_PRECISION(), nullable=False, server_default=sa.text("0.15")),
        sa.Column(
            "isolation_threshold",
            postgresql.DOUBLE_PRECISION(),
            nullable=False,
            server_default=sa.text("0.30"),
        ),
        sa.Column(
            "verdict_confidence_threshold",
            postgresql.DOUBLE_PRECISION(),
            nullable=False,
            server_default=sa.text("0.80"),
        ),
        sa.Column("intake_paused", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_by", sa.Text()),
        sa.CheckConstraint("id = 1", name="ck_runtime_settings_singleton"),
        sa.CheckConstraint("eta BETWEEN 0.01 AND 0.5", name="ck_runtime_settings_eta"),
        sa.CheckConstraint(
            "isolation_threshold BETWEEN 0.05 AND 0.45", name="ck_runtime_settings_isolation_threshold"
        ),
        sa.CheckConstraint(
            "verdict_confidence_threshold BETWEEN 0.50 AND 0.99", name="ck_runtime_settings_verdict_threshold"
        ),
    )
    op.execute("INSERT INTO runtime_settings (id) VALUES (1) ON CONFLICT DO NOTHING")


def downgrade() -> None:
    op.drop_table("runtime_settings")
    op.drop_constraint("ck_analysts_role", "analysts", type_="check")
    op.drop_column("analysts", "role")
