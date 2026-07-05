"""sheet health: mapping fingerprint + self-targeted campaigns

Sheet Health tab needs a stored snapshot of what the sheet looked like when
the column mapping was saved (headers of mapped columns, resolved tabs,
distinct segment values) so drift can be detected later. Stored as JSON in
rmn_column_mappings.sheet_fingerprint.

Self-targeted campaigns don't have a segment column in the sheet — the
segment IS the advertiser/publisher itself — so the Setup form offers a
dropdown instead of sheet-driven segment selection. Persist that choice on
rmn_campaigns.self_targeted.

Revision ID: 0027_sheet_health
Revises: 0026_advertiser_onboarded_at
Create Date: 2026-07-05

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027_sheet_health"
down_revision: Union[str, None] = "0026_advertiser_onboarded_at"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "rmn_column_mappings",
        sa.Column("sheet_fingerprint", sa.Text(), nullable=True),
    )
    op.add_column(
        "rmn_campaigns",
        sa.Column("self_targeted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("rmn_campaigns", "self_targeted")
    op.drop_column("rmn_column_mappings", "sheet_fingerprint")
