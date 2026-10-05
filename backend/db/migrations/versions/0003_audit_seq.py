"""audit_trail.seq - a total order for the hash chain.

created_at is the transaction start time, so entries written in one transaction tie, and
concurrent writers could read the same chain tail (a latent fork). seq is an identity
assigned at INSERT, so it orders the chain without relying on timestamps.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-05
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "audit_trail",
        sa.Column("seq", sa.BigInteger(), sa.Identity(always=True), nullable=False),
    )
    op.create_index("uq_audit_trail_seq", "audit_trail", ["seq"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_audit_trail_seq", table_name="audit_trail")
    op.drop_column("audit_trail", "seq")
