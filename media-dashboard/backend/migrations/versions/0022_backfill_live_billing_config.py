"""backfill billing config for live campaigns

Revision ID: 0022_backfill_live_billing_config
Revises: 0021_default_billing_sources
Create Date: 2026-07-02

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0022_backfill_live_billing_config"
down_revision: Union[str, None] = "0021_default_billing_sources"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        WITH live_dates AS (
            SELECT
                entity_id AS campaign_id,
                MIN((created_at AT TIME ZONE 'Asia/Kolkata')::date) AS live_date
            FROM rmn_stage_transitions
            WHERE entity_type = 'CAMPAIGN'
              AND to_stage = 'LIVE'
            GROUP BY entity_id
        ),
        advertiser_candidates AS (
            SELECT
                c.id AS campaign_id,
                CASE
                    WHEN REPLACE(LOWER(TRIM(COALESCE(a.buy_type, ''))), '_commit', '') = 'roas'
                        THEN 'roas'
                    WHEN REPLACE(LOWER(TRIM(COALESCE(a.buy_type, ''))), '_commit', '') = 'cpc'
                        THEN 'cpc'
                END AS billing_model,
                CASE
                    WHEN REPLACE(LOWER(TRIM(COALESCE(a.buy_type, ''))), '_commit', '') = 'roas'
                        THEN a.roas_multiplier
                    WHEN REPLACE(LOWER(TRIM(COALESCE(a.buy_type, ''))), '_commit', '') = 'cpc'
                        THEN a.cpc_rate
                END AS rate,
                COALESCE(ld.live_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS start_date
            FROM rmn_campaigns c
            JOIN rmn_advertisers a ON a.id = c.advertiser_ref_id
            LEFT JOIN live_dates ld ON ld.campaign_id = c.id
            WHERE c.current_stage = 'LIVE'
              AND COALESCE(c.is_deleted, FALSE) = FALSE
              AND NOT EXISTS (
                  SELECT 1
                  FROM rmn_billing_config bc
                  WHERE bc.campaign_id = c.id
                    AND bc.side = 'advertiser'
              )
        ),
        inserted_advertiser AS (
            INSERT INTO rmn_billing_config (
                campaign_id, side, billing_model, rate, start_date, created_by
            )
            SELECT
                campaign_id,
                'advertiser',
                billing_model,
                rate,
                start_date,
                'system:live_backfill'
            FROM advertiser_candidates
            WHERE billing_model IS NOT NULL
              AND rate IS NOT NULL
              AND rate > 0
            ON CONFLICT (campaign_id, side, start_date) DO NOTHING
            RETURNING campaign_id, side, billing_model, rate, start_date
        ),
        publisher_candidates AS (
            SELECT
                c.id AS campaign_id,
                CASE
                    WHEN LOWER(TRIM(COALESCE(c.publisher_billing_model, ''))) IN ('cpc', 'cpm')
                        THEN LOWER(TRIM(c.publisher_billing_model))
                    WHEN NULLIF(TRIM(COALESCE(c.cpc_cpd, '')), '') IS NOT NULL
                        THEN 'cpc'
                END AS billing_model,
                COALESCE(
                    c.publisher_billing_rate,
                    CASE
                        WHEN REPLACE(COALESCE(c.cpc_cpd, ''), ',', '') ~ '^[0-9]+(\\.[0-9]+)?$'
                            THEN REPLACE(c.cpc_cpd, ',', '')::float
                    END
                ) AS rate,
                COALESCE(ld.live_date, (NOW() AT TIME ZONE 'Asia/Kolkata')::date) AS start_date
            FROM rmn_campaigns c
            LEFT JOIN live_dates ld ON ld.campaign_id = c.id
            WHERE c.current_stage = 'LIVE'
              AND COALESCE(c.is_deleted, FALSE) = FALSE
              AND NOT EXISTS (
                  SELECT 1
                  FROM rmn_billing_config bc
                  WHERE bc.campaign_id = c.id
                    AND bc.side = 'publisher'
              )
        ),
        inserted_publisher AS (
            INSERT INTO rmn_billing_config (
                campaign_id, side, billing_model, rate, start_date, created_by
            )
            SELECT
                campaign_id,
                'publisher',
                billing_model,
                rate,
                start_date,
                'system:live_backfill'
            FROM publisher_candidates
            WHERE billing_model IS NOT NULL
              AND rate IS NOT NULL
              AND rate > 0
            ON CONFLICT (campaign_id, side, start_date) DO NOTHING
            RETURNING campaign_id, side, billing_model, rate, start_date
        ),
        inserted AS (
            SELECT * FROM inserted_advertiser
            UNION ALL
            SELECT * FROM inserted_publisher
        )
        INSERT INTO rmn_campaign_changelog (
            campaign_id, field_name, old_value, new_value, changed_by, source
        )
        SELECT
            campaign_id,
            'billing.' || side,
            NULL,
            CONCAT(
                side,
                ':',
                UPPER(billing_model),
                ' | rate=',
                rate,
                ' | start=',
                start_date,
                ' | source=live_backfill'
            ),
            'system:live_backfill',
            'live_backfill'
        FROM inserted
    """)


def downgrade() -> None:
    op.execute("DELETE FROM rmn_campaign_changelog WHERE source = 'live_backfill'")
    op.execute("DELETE FROM rmn_billing_config WHERE created_by = 'system:live_backfill'")
