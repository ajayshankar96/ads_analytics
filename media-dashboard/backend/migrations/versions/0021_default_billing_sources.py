"""add campaign publisher billing defaults and changelog source

Revision ID: 0021_default_billing_sources
Revises: 0020_spend_sources
Create Date: 2026-07-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0021_default_billing_sources"
down_revision: Union[str, None] = "0020_spend_sources"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_campaigns", sa.Column("publisher_billing_model", sa.String(16), nullable=True))
    op.add_column("rmn_campaigns", sa.Column("publisher_billing_rate", sa.Float(), nullable=True))
    op.add_column("rmn_campaign_changelog", sa.Column("source", sa.String(32), nullable=True))
    op.execute("""
        UPDATE rmn_campaigns
           SET publisher_billing_model = 'cpc',
               publisher_billing_rate = REPLACE(cpc_cpd, ',', '')::float
         WHERE NULLIF(TRIM(cpc_cpd), '') IS NOT NULL
           AND REPLACE(cpc_cpd, ',', '') ~ '^[0-9]+(\\.[0-9]+)?$'
           AND publisher_billing_model IS NULL
    """)


def downgrade() -> None:
    op.drop_column("rmn_campaign_changelog", "source")
    op.drop_column("rmn_campaigns", "publisher_billing_rate")
    op.drop_column("rmn_campaigns", "publisher_billing_model")
