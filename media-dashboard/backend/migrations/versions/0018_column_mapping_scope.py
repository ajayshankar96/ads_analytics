"""scope column mappings by campaign and sheet

Revision ID: 0018_column_mapping_scope
Revises: 0017_campaign_changelog
Create Date: 2026-07-01

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0018_column_mapping_scope"
down_revision: Union[str, None] = "0017_campaign_changelog"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_column_mappings", sa.Column("campaign_id", sa.String(32), nullable=True))
    op.create_index("ix_rmn_col_mappings_campaign_type", "rmn_column_mappings", ["campaign_id", "type"])
    op.create_index("ix_rmn_col_mappings_name_type_sheet", "rmn_column_mappings", ["name", "type", "sheet_url"])


def downgrade() -> None:
    op.drop_index("ix_rmn_col_mappings_name_type_sheet", table_name="rmn_column_mappings")
    op.drop_index("ix_rmn_col_mappings_campaign_type", table_name="rmn_column_mappings")
    op.drop_column("rmn_column_mappings", "campaign_id")
