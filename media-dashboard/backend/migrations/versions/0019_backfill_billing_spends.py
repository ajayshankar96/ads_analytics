"""backfill metrics from billing configs

Revision ID: 0019_backfill_billing_spends
Revises: 0018_column_mapping_scope
Create Date: 2026-07-01

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0019_backfill_billing_spends"
down_revision: Union[str, None] = "0018_column_mapping_scope"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        WITH active_publisher_config AS (
            SELECT DISTINCT ON (m.id)
                m.id AS metric_id,
                LOWER(cfg.billing_model) AS billing_model,
                cfg.rate
            FROM rmn_campaign_metrics m
            JOIN rmn_billing_config cfg
              ON cfg.campaign_id = m.campaign_id
             AND cfg.side = 'publisher'
             AND cfg.start_date <= m.date
             AND (cfg.end_date IS NULL OR cfg.end_date >= m.date)
            ORDER BY m.id, cfg.start_date DESC
        )
        UPDATE rmn_campaign_metrics m
           SET publisher_spends = CASE active_publisher_config.billing_model
                WHEN 'cpc' THEN COALESCE(m.clicks, 0) * active_publisher_config.rate
                WHEN 'cpd' THEN active_publisher_config.rate
                WHEN 'cpm' THEN COALESCE(m.impressions, 0) * active_publisher_config.rate / 1000.0
                WHEN 'cpa' THEN COALESCE(m.orders_pub, 0) * active_publisher_config.rate
                WHEN 'roas' THEN
                    CASE
                        WHEN active_publisher_config.rate <> 0 THEN
                            COALESCE(
                                NULLIF(COALESCE(m.advertiser_metrics, '{}'), '')::jsonb->>'Revenue',
                                NULLIF(COALESCE(m.advertiser_metrics, '{}'), '')::jsonb->>'revenue',
                                '0'
                            )::double precision / active_publisher_config.rate
                        ELSE 0
                    END
                ELSE COALESCE(NULLIF(m.publisher_spends, 0), m.spends, 0)
            END
          FROM active_publisher_config
         WHERE m.id = active_publisher_config.metric_id
    """)


def downgrade() -> None:
    pass
