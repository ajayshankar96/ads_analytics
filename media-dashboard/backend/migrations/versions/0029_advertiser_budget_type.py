"""Advertiser budget: date-agnostic vs monthly.

budget_type selects how the default campaign budget behaves:
- AGNOSTIC: budget_hint is a single value the owner can change anytime.
- MONTHLY: budget_months holds a JSON map of {"YYYY-MM": amount}; the
  current month's value locks once set (owner can still pre-set future
  months), so the budget is fixed for that advertiser for that month.

Revision ID: 0029_advertiser_budget_type
Revises: 0028_self_targeted_per_side
"""
import sqlalchemy as sa
from alembic import op

revision = "0029_advertiser_budget_type"
down_revision = "0028_self_targeted_per_side"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rmn_advertisers", sa.Column(
        "budget_type", sa.String(16), nullable=False, server_default="AGNOSTIC"))
    op.add_column("rmn_advertisers", sa.Column("budget_months", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("rmn_advertisers", "budget_months")
    op.drop_column("rmn_advertisers", "budget_type")
