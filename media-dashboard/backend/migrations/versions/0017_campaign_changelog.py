"""create rmn_campaign_changelog table

Revision ID: 0017_campaign_changelog
Revises: 0016_billing_config
Create Date: 2026-06-25

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017_campaign_changelog"
down_revision: Union[str, None] = "0016_billing_config"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS rmn_campaign_changelog (
            id BIGSERIAL PRIMARY KEY,
            campaign_id VARCHAR(32) NOT NULL,
            field_name VARCHAR(64) NOT NULL,
            old_value TEXT,
            new_value TEXT,
            changed_by VARCHAR(255),
            changed_at TIMESTAMPTZ DEFAULT NOW()
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_changelog_campaign_id ON rmn_campaign_changelog (campaign_id)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_changelog_campaign_id")
    op.execute("DROP TABLE IF EXISTS rmn_campaign_changelog")
