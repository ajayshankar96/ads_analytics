"""add rmn_column_mappings table for configurable sheet parsers

Revision ID: 0013_column_mappings
Revises: 0012_sheet_urls
Create Date: 2026-06-22

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_column_mappings"
down_revision: Union[str, None] = "0012_sheet_urls"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_column_mappings",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("name", sa.String(255), nullable=False),  # publisher or advertiser name
        sa.Column("type", sa.String(16), nullable=False),   # 'publisher' or 'advertiser'
        sa.Column("sheet_url", sa.Text(), nullable=True),
        sa.Column("tab_name", sa.String(255), nullable=True),
        sa.Column("header_row", sa.Integer(), nullable=False, server_default="1"),  # which row has headers
        sa.Column("data_start_row", sa.Integer(), nullable=False, server_default="2"),  # where data starts
        sa.Column("mapping", sa.Text(), nullable=False),  # JSON: {"date": "B", "impressions": "F", ...}
        sa.Column("format_type", sa.String(32), nullable=False, server_default="vertical"),  # vertical or horizontal
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_rmn_col_mappings_name_type", "rmn_column_mappings", ["name", "type"])


def downgrade() -> None:
    op.drop_table("rmn_column_mappings")
