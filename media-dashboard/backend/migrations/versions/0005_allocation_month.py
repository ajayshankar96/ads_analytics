"""add month column to rmn_budget_allocations

Revision ID: 0005_allocation_month
Revises: 0004_budget_allocation
Create Date: 2026-06-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005_allocation_month"
down_revision: Union[str, None] = "0004_budget_allocation"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_budget_allocations", sa.Column("month", sa.String(7), nullable=False, server_default="2026-06"))
    op.create_index("ix_rmn_alloc_month", "rmn_budget_allocations", ["month"])
    op.drop_index("ix_rmn_alloc_adv_pub", table_name="rmn_budget_allocations")
    op.create_index("ix_rmn_alloc_adv_pub_month", "rmn_budget_allocations", ["advertiser_id", "publisher_id", "month"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_rmn_alloc_adv_pub_month", table_name="rmn_budget_allocations")
    op.create_index("ix_rmn_alloc_adv_pub", "rmn_budget_allocations", ["advertiser_id", "publisher_id"], unique=True)
    op.drop_index("ix_rmn_alloc_month", table_name="rmn_budget_allocations")
    op.drop_column("rmn_budget_allocations", "month")
