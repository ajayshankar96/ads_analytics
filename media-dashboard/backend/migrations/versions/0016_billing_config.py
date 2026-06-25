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
    op.execute("""
        CREATE TABLE IF NOT EXISTS rmn_billing_config (
            id BIGSERIAL PRIMARY KEY,
            campaign_id VARCHAR(32) NOT NULL,
            side VARCHAR(16) NOT NULL,
            billing_model VARCHAR(16) NOT NULL,
            rate FLOAT NOT NULL,
            start_date DATE NOT NULL,
            end_date DATE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            created_by VARCHAR(255)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_billing_campaign_id ON rmn_billing_config (campaign_id)")
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_billing_campaign_side_start ON rmn_billing_config (campaign_id, side, start_date)")


def downgrade() -> None:
    op.drop_index("uq_billing_campaign_side_start", table_name="rmn_billing_config")
    op.drop_table("rmn_billing_config")
