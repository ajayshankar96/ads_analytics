"""Advertiser changelog: field-level audit trail for budget edits.

Mirrors rmn_campaign_changelog. Grain = advertiser x field x change event;
monthly budgets log each month as its own field ("budget_months.YYYY-MM").
source = owner / admin / admin_override (lock bypass).

Revision ID: 0030_advertiser_changelog
Revises: 0029_advertiser_budget_type
"""
import sqlalchemy as sa
from alembic import op

revision = "0030_advertiser_changelog"
down_revision = "0029_advertiser_budget_type"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rmn_advertiser_changelog",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("advertiser_id", sa.String(32), nullable=False),
        sa.Column("field_name", sa.String(64), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("changed_by", sa.String(255), nullable=True),
        sa.Column("source", sa.String(32), nullable=True),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_rmn_advertiser_changelog_advertiser_id",
                    "rmn_advertiser_changelog", ["advertiser_id"])


def downgrade() -> None:
    op.drop_index("ix_rmn_advertiser_changelog_advertiser_id",
                  table_name="rmn_advertiser_changelog")
    op.drop_table("rmn_advertiser_changelog")
