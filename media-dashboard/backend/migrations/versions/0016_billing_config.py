"""create rmn_billing_config table

Revision ID: 0016_billing_config
Revises: 0015_campaign_parent_and_thread
Create Date: 2026-06-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_billing_config"
down_revision: Union[str, None] = "0015_campaign_parent_and_thread"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_billing_config",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("campaign_id", sa.String(32), nullable=False, index=True),
        sa.Column("side", sa.String(16), nullable=False),
        sa.Column("billing_model", sa.String(16), nullable=False),
        sa.Column("rate", sa.Float, nullable=False),
        sa.Column("start_date", sa.Date, nullable=False),
        sa.Column("end_date", sa.Date, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_by", sa.String(255), nullable=True),
    )
    op.create_index(
        "uq_billing_campaign_side_start",
        "rmn_billing_config",
        ["campaign_id", "side", "start_date"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_billing_campaign_side_start", table_name="rmn_billing_config")
    op.drop_table("rmn_billing_config")
