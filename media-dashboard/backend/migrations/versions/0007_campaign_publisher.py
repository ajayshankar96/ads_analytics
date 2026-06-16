"""add advertiser_name, publisher_id, publisher_name to rmn_campaigns

Revision ID: 0007_campaign_publisher
Revises: 0006_campaign_assets
Create Date: 2026-06-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_campaign_publisher"
down_revision: Union[str, None] = "0006_campaign_assets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column("advertiser_name", sa.String(255), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_id", sa.String(32), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_name", sa.String(128), nullable=True))
    op.create_index("ix_rmn_campaigns_publisher_id", "rmn_campaigns", ["publisher_id"])


def downgrade() -> None:
    op.drop_index("ix_rmn_campaigns_publisher_id", table_name="rmn_campaigns")
    op.drop_column("rmn_campaigns", "publisher_name")
    op.drop_column("rmn_campaigns", "publisher_id")
    op.drop_column("rmn_campaigns", "advertiser_name")
