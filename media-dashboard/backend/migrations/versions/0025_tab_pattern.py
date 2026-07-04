"""add tab_pattern / tab_match_mode to rmn_column_mappings

Supports auto-detection of new monthly tabs: instead of a fixed tab name
("RZP_Ctrl8 June"), a mapping can store a stable pattern ("RZP_Ctrl8"). At
sync time every tab containing the pattern with a parseable month/year token
qualifies, so new-month tabs are ingested without reconfiguration.

tab_match_mode: 'exact' (default, current behavior) or 'rolling' (pattern).

Revision ID: 0025_tab_pattern
Revises: 0024_drop_handmade_index
Create Date: 2026-07-04

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025_tab_pattern"
down_revision: Union[str, None] = "0024_drop_handmade_index"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_column_mappings",
                  sa.Column("tab_pattern", sa.String(255), nullable=True))
    op.add_column("rmn_column_mappings",
                  sa.Column("tab_match_mode", sa.String(16), nullable=False,
                            server_default="exact"))


def downgrade() -> None:
    op.drop_column("rmn_column_mappings", "tab_match_mode")
    op.drop_column("rmn_column_mappings", "tab_pattern")
