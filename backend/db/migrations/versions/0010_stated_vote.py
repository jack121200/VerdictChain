"""What an agent states itself: its stance and the class it votes for (checklist LG2, LG4).

Both columns are nullable text on debate_transcripts. stance holds CHALLENGE, SUPPORT or REVISE (the stated
word, else the one the theory starts with); vote_class holds the class the agent stated, one of the eight
verdict classes. They are null on every row written before this revision, and for an answer that left them
out; the server then reads the theory text as it always did.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-11
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("debate_transcripts", sa.Column("stance", sa.Text(), nullable=True))
    op.add_column("debate_transcripts", sa.Column("vote_class", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("debate_transcripts", "vote_class")
    op.drop_column("debate_transcripts", "stance")
