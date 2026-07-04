"""drop hand-created duplicate unique index on rmn_campaign_metrics

Prod had a unique index ``ix_rmn_metrics_campaign_date`` on
(campaign_id, date) that was created by hand outside migrations (discovered
when the BHIM sync's UniqueViolationError referenced it). Migration 0023
created the tracked equivalent ``uq_rmn_metrics_camp_date``, leaving two
identical unique indexes. Drop the untracked one; keep the tracked one.

Revision ID: 0024_drop_handmade_index
Revises: 0023_metrics_unique_index
Create Date: 2026-07-04

"""
from typing import Sequence, Union

from alembic import op

revision: str = "0024_drop_handmade_index"
down_revision: Union[str, None] = "0023_metrics_unique_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_rmn_metrics_campaign_date")


def downgrade() -> None:
    # No-op: the index was never created by a migration. uq_rmn_metrics_camp_date
    # (from 0023) still provides the unique constraint.
    pass
