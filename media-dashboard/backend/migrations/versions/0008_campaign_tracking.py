"""add campaign tracking setup fields to rmn_campaigns

Revision ID: 0008_campaign_tracking
Revises: 0007_campaign_publisher
Create Date: 2026-06-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_campaign_tracking"
down_revision: Union[str, None] = "0007_campaign_publisher"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column("advertiser_data_url", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_data_url", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("segment_pub", sa.String(255), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("segment_adv", sa.String(255), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("goals_json", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("metrics_json", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("additional_context", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("tracking_submitted", sa.Boolean(), nullable=False, server_default=sa.text("false")))


def downgrade() -> None:
    op.drop_column("rmn_campaigns", "tracking_submitted")
    op.drop_column("rmn_campaigns", "additional_context")
    op.drop_column("rmn_campaigns", "metrics_json")
    op.drop_column("rmn_campaigns", "goals_json")
    op.drop_column("rmn_campaigns", "segment_adv")
    op.drop_column("rmn_campaigns", "segment_pub")
    op.drop_column("rmn_campaigns", "publisher_data_url")
    op.drop_column("rmn_campaigns", "advertiser_data_url")
