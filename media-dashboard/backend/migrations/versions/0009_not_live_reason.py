"""add not_live_reason column to rmn_campaigns

Revision ID: 0009_not_live_reason
Revises: 0008_campaign_tracking
Create Date: 2026-06-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_not_live_reason"
down_revision: Union[str, None] = "0008_campaign_tracking"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column("not_live_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("rmn_campaigns", "not_live_reason")
