"""initial schema — all 8 core tables from SKILL-data-schema.md

Revision ID: 0001
Revises:
Create Date: 2026-09-07
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pgcrypto")

    op.create_table(
        "raw_logs",
        sa.Column("row_id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("timestamp", sa.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("source", sa.Text(), nullable=False),
        sa.Column("source_file", sa.Text()),
        sa.Column("event_type", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text()),
        sa.Column("host_id", sa.Text()),
        sa.Column("severity", sa.Text()),
        sa.Column("raw_fields", postgresql.JSONB(), nullable=False),
        sa.Column("ground_truth_label", sa.Text()),
    )
    op.create_index("idx_raw_logs_timestamp", "raw_logs", ["timestamp"])
    op.create_index("idx_raw_logs_source", "raw_logs", ["source"])

    op.create_table(
        "investigations",
        sa.Column("investigation_id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("trigger_type", sa.Text(), nullable=False),
        sa.Column("trigger_reason", sa.Text()),
        sa.Column("scenario_label", sa.Text()),
        sa.Column("status", sa.Text(), nullable=False, server_default="investigating"),
        sa.Column("verdict_class", sa.Text()),
        sa.Column("verdict_confidence", sa.Float()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "debate_transcripts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("investigation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("investigations.investigation_id")),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("theory", sa.Text(), nullable=False),
        sa.Column("confidence", sa.Float(), nullable=False),
        sa.Column("cited_evidence", postgresql.JSONB(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_debate_transcripts_investigation", "debate_transcripts", ["investigation_id"])

    op.create_table(
        "credibility_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("investigation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("investigations.investigation_id")),
        sa.Column("agent_id", sa.Text(), nullable=False),
        sa.Column("round", sa.Integer(), nullable=False),
        sa.Column("crs_before", sa.Float(), nullable=False),
        sa.Column("crs_after", sa.Float(), nullable=False),
        sa.Column("verification_match_rate", sa.Float(), nullable=False),
        sa.Column("isolated", sa.Boolean(), server_default=sa.false()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_credibility_log_investigation_agent", "credibility_log", ["investigation_id", "agent_id"])

    op.create_table(
        "response_actions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("investigation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("investigations.investigation_id")),
        sa.Column("action_type", sa.Text(), nullable=False),
        sa.Column("target", sa.Text(), nullable=False),
        sa.Column("reason", sa.Text()),
        sa.Column("is_simulated", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.CheckConstraint("is_simulated = TRUE", name="ck_response_actions_always_simulated"),
    )
    op.create_index("idx_response_actions_investigation", "response_actions", ["investigation_id"])

    op.create_table(
        "model_versions",
        sa.Column("version_id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("trained_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("accuracy", sa.Float()),
        sa.Column("false_positive_rate", sa.Float()),
        sa.Column("is_deployed", sa.Boolean(), server_default=sa.false()),
        sa.Column("notes", sa.Text()),
    )

    op.create_table(
        "audit_trail",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("investigation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("investigations.investigation_id")),
        sa.Column("actor", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("detail", postgresql.JSONB()),
        sa.Column("prev_hash", sa.Text()),
        sa.Column("entry_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("idx_audit_trail_investigation", "audit_trail", ["investigation_id"])
    op.create_index("idx_audit_trail_created_at", "audit_trail", ["created_at"])

    op.create_table(
        "analyst_feedback",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("investigation_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("investigations.investigation_id")),
        sa.Column("verdict_was_correct", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    op.drop_table("analyst_feedback")
    op.drop_table("audit_trail")
    op.drop_table("model_versions")
    op.drop_table("response_actions")
    op.drop_table("credibility_log")
    op.drop_table("debate_transcripts")
    op.drop_table("investigations")
    op.drop_table("raw_logs")
