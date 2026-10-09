"""runtime_settings.eta default 0.15 -> 0.20, so isolation is reachable inside one 3-round debate.

CrS starts at 0.5 and the isolation threshold is 0.30. A round in which no citation verifies multiplies
CrS by (1 - eta). At eta 0.15 three such rounds leave 0.307, still above the threshold, so an agent could
only be isolated by a fourth round in a later debate. At eta 0.20 they leave 0.256 and the agent is
isolated when round 3 is scored. The CrS formula itself is unchanged.

Only a row nobody has edited (updated_by IS NULL) that still holds the old default is moved. A value an
analyst set through PUT /settings is kept.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-09
"""

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("runtime_settings", "eta", server_default=sa.text("0.20"))
    op.execute("UPDATE runtime_settings SET eta = 0.20 WHERE id = 1 AND eta = 0.15 AND updated_by IS NULL")


def downgrade() -> None:
    op.alter_column("runtime_settings", "eta", server_default=sa.text("0.15"))
    op.execute("UPDATE runtime_settings SET eta = 0.15 WHERE id = 1 AND eta = 0.20 AND updated_by IS NULL")
