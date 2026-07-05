"""add onboarded_at to rmn_advertisers

Budget Allocation's "Total Budget Loaded" KPI must be month-scoped: the
budget entered while onboarding an advertiser counts toward the month the
advertiser was onboarded. status flips to ONBOARDED without a timestamp
today, so add onboarded_at (stamped in workflow_repo when the flip happens)
and backfill existing ONBOARDED advertisers from created_at — the wizard is
completed within minutes of the draft being created, so created_at is an
accurate proxy for the onboarding month.

Revision ID: 0026_advertiser_onboarded_at
Revises: 0025_tab_pattern
Create Date: 2026-07-05

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026_advertiser_onboarded_at"
down_revision: Union[str, None] = "0025_tab_pattern"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rmn_advertisers",
        sa.Column("onboarded_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.execute(
        "UPDATE rmn_advertisers SET onboarded_at = created_at "
        "WHERE status = 'ONBOARDED' AND onboarded_at IS NULL"
    )


def downgrade() -> None:
    op.drop_column("rmn_advertisers", "onboarded_at")
