"""Metric config: user-managed metrics on the performance tabs.

One row per scope ('advertiser' | 'publisher'); config JSON holds hidden
built-in keys plus custom metric definitions (base = extra data column,
derived = formula over metric keys).

Revision ID: 0031_metric_config
Revises: 0030_advertiser_changelog
"""
import sqlalchemy as sa
from alembic import op

revision = "0031_metric_config"
down_revision = "0030_advertiser_changelog"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "rmn_metric_config",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("scope", sa.String(32), nullable=False),
        sa.Column("config", sa.Text(), nullable=True),
        sa.Column("updated_by", sa.String(255), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False,
                  server_default=sa.text("now()")),
    )
    op.create_index("ix_rmn_metric_config_scope", "rmn_metric_config",
                    ["scope"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_rmn_metric_config_scope", table_name="rmn_metric_config")
    op.drop_table("rmn_metric_config")
