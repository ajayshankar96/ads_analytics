"""add campaign asset and publisher email columns to rmn_campaigns

Revision ID: 0006_campaign_assets
Revises: 0005_allocation_month
Create Date: 2026-06-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_campaign_assets"
down_revision: Union[str, None] = "0005_allocation_month"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column("landing_link", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("offer_title", sa.String(255), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("details_tc", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("how_to_redeem", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("promo_codes", sa.String(512), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("code_validity", sa.String(128), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("creative_url", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("logo_url", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("targeting", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("daily_budget", sa.String(64), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("cpc_cpd", sa.String(64), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_email_to", sa.String(512), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_email_subject", sa.String(512), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_email_body", sa.Text(), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_email_sent_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("rmn_campaigns", "publisher_email_sent_at")
    op.drop_column("rmn_campaigns", "publisher_email_body")
    op.drop_column("rmn_campaigns", "publisher_email_subject")
    op.drop_column("rmn_campaigns", "publisher_email_to")
    op.drop_column("rmn_campaigns", "cpc_cpd")
    op.drop_column("rmn_campaigns", "daily_budget")
    op.drop_column("rmn_campaigns", "targeting")
    op.drop_column("rmn_campaigns", "logo_url")
    op.drop_column("rmn_campaigns", "creative_url")
    op.drop_column("rmn_campaigns", "code_validity")
    op.drop_column("rmn_campaigns", "promo_codes")
    op.drop_column("rmn_campaigns", "how_to_redeem")
    op.drop_column("rmn_campaigns", "details_tc")
    op.drop_column("rmn_campaigns", "offer_title")
    op.drop_column("rmn_campaigns", "landing_link")
