"""Why a debate stopped (an investigation that ends in status 'error' now says so).

error_reason holds one plain sentence for the analyst, for example the provider has no credit left, an
investigator's answer failed validation twice, or the API restarted while the debate ran. It is null for every
investigation that did not fail. The same sentence goes into the audit trail as an investigation_failed entry.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("investigations", sa.Column("error_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("investigations", "error_reason")
