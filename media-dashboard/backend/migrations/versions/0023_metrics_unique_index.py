"""add unique index on rmn_campaign_metrics (campaign_id, date)

The ETL upsert in etl_worker.sync_campaign uses
``INSERT ... ON CONFLICT (campaign_id, date) DO UPDATE``. Migration 0011 only
created a *non-unique* index (``ix_rmn_metrics_camp_date``), so Postgres has no
constraint to infer the conflict target from and the upsert raises
"no unique or exclusion constraint matching the ON CONFLICT specification".

This migration:
  1. De-duplicates any existing rows, keeping the most-recently written row
     (max ``id``) per (campaign_id, date). Required, otherwise creating the
     unique index would fail and block pod startup.
  2. Drops the old non-unique index.
  3. Creates a UNIQUE index on (campaign_id, date).

All steps are idempotent (IF EXISTS / IF NOT EXISTS) so the migration is safe
even if a unique index was previously created by hand in an environment.

Revision ID: 0023_metrics_unique_index
Revises: 0022_backfill_billing_config
Create Date: 2026-07-04

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0023_metrics_unique_index"
down_revision: Union[str, None] = "0022_backfill_billing_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. De-duplicate: keep the highest id (latest write) per (campaign_id, date).
    op.execute(
        """
        DELETE FROM rmn_campaign_metrics a
        USING rmn_campaign_metrics b
        WHERE a.campaign_id = b.campaign_id
          AND a.date = b.date
          AND a.id < b.id
        """
    )

    # 2. Drop the old non-unique index (created in 0011).
    op.execute("DROP INDEX IF EXISTS ix_rmn_metrics_camp_date")

    # 3. Create the unique index the upsert needs.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_rmn_metrics_camp_date "
        "ON rmn_campaign_metrics (campaign_id, date)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_rmn_metrics_camp_date")
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_rmn_metrics_camp_date "
        "ON rmn_campaign_metrics (campaign_id, date)"
    )
