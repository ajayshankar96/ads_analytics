"""add rmn_campaign_metrics table for ETL data storage

Revision ID: 0011_campaign_metrics
Revises: 0010_user_roles
Create Date: 2026-06-18

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_campaign_metrics"
down_revision: Union[str, None] = "0010_user_roles"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_campaign_metrics",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("campaign_id", sa.String(32), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("advertiser", sa.String(255), nullable=True),
        sa.Column("publisher", sa.String(255), nullable=True),
        sa.Column("segment", sa.String(255), nullable=True),
        sa.Column("impressions", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("distribution", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("clicks", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("orders_pub", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("scratches", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("coins_burned", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("redirections", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("spends", sa.Float(), nullable=False, server_default="0"),
        sa.Column("publisher_spends", sa.Float(), nullable=False, server_default="0"),
        sa.Column("advertiser_spends", sa.Float(), nullable=False, server_default="0"),
        sa.Column("advertiser_metrics", sa.Text(), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_rmn_metrics_campaign_id", "rmn_campaign_metrics", ["campaign_id"])
    op.create_index("ix_rmn_metrics_date", "rmn_campaign_metrics", ["date"])
    op.create_index("ix_rmn_metrics_camp_date", "rmn_campaign_metrics", ["campaign_id", "date"])


def downgrade() -> None:
    op.drop_table("rmn_campaign_metrics")
