"""track spend calculation sources

Revision ID: 0020_spend_sources
Revises: 0019_backfill_billing_spends
Create Date: 2026-07-02

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0020_spend_sources"
down_revision: Union[str, None] = "0019_backfill_billing_spends"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_campaign_metrics", sa.Column("publisher_spends_source", sa.String(16), nullable=True))
    op.add_column("rmn_campaign_metrics", sa.Column("advertiser_spends_source", sa.String(16), nullable=True))
    op.execute("""
        WITH metric_sources AS (
            SELECT id,
                   COALESCE(NULLIF(advertiser_metrics, ''), '{}')::jsonb AS adv_metrics_json
              FROM rmn_campaign_metrics
        ),
        metric_values AS (
            SELECT id,
                   adv_metrics_json,
                   COALESCE(NULLIF(COALESCE(
                       adv_metrics_json->>'Revenue',
                       adv_metrics_json->>'revenue'
                   ), '')::float, 0) AS revenue
              FROM metric_sources
        )
        UPDATE rmn_campaign_metrics AS m
           SET publisher_spends_source = CASE
                WHEN m.spends <> 0 THEN 'sheet'
                WHEN m.publisher_spends <> 0 THEN 'calculated'
                ELSE NULL
           END,
           advertiser_spends_source = CASE
                WHEN v.adv_metrics_json ? 'Spends'
                  OR v.adv_metrics_json ? 'spends'
                  THEN 'sheet'
                WHEN m.advertiser_spends <> 0
                 AND (v.revenue = 0 OR m.advertiser_spends <> v.revenue)
                  THEN 'calculated'
                ELSE NULL
           END
          FROM metric_values AS v
         WHERE v.id = m.id
    """)


def downgrade() -> None:
    op.drop_column("rmn_campaign_metrics", "advertiser_spends_source")
    op.drop_column("rmn_campaign_metrics", "publisher_spends_source")
