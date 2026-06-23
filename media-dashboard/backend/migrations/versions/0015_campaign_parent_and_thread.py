"""add parent_campaign_id + email thread tracking to rmn_campaigns

Revision ID: 0015_campaign_parent_and_thread
Revises: 0014_advertiser_owner
Create Date: 2026-06-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0015_campaign_parent_and_thread"
down_revision: Union[str, None] = "0014_advertiser_owner"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column("parent_campaign_id", sa.String(32), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_email_thread_id", sa.String(128), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_email_message_id", sa.String(255), nullable=True))
    op.create_index("ix_rmn_campaigns_parent", "rmn_campaigns", ["parent_campaign_id"])


def downgrade() -> None:
    op.drop_index("ix_rmn_campaigns_parent", table_name="rmn_campaigns")
    op.drop_column("rmn_campaigns", "publisher_email_message_id")
    op.drop_column("rmn_campaigns", "publisher_email_thread_id")
    op.drop_column("rmn_campaigns", "parent_campaign_id")
