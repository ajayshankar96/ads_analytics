"""add rmn_publishers and rmn_budget_allocations tables

Revision ID: 0004_budget_allocation
Revises: 0003_welcome_email
Create Date: 2026-06-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_budget_allocation"
down_revision: Union[str, None] = "0003_welcome_email"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_publishers",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("code", sa.String(16), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "rmn_budget_allocations",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("advertiser_id", sa.String(20), nullable=False),
        sa.Column("publisher_id", sa.String(32), nullable=False),
        sa.Column("amount", sa.BigInteger(), nullable=True),
        sa.Column("status", sa.String(24), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_rmn_alloc_advertiser_id", "rmn_budget_allocations", ["advertiser_id"])
    op.create_index("ix_rmn_alloc_publisher_id", "rmn_budget_allocations", ["publisher_id"])
    op.create_index("ix_rmn_alloc_adv_pub", "rmn_budget_allocations", ["advertiser_id", "publisher_id"], unique=True)

    # Seed publishers
    publishers = sa.table(
        "rmn_publishers",
        sa.column("id", sa.String),
        sa.column("name", sa.String),
        sa.column("code", sa.String),
        sa.column("is_active", sa.Boolean),
    )
    op.bulk_insert(publishers, [
        {"id": "PUB-001", "name": "Flipkart", "code": "P1", "is_active": True},
        {"id": "PUB-002", "name": "Navi", "code": "P2", "is_active": True},
        {"id": "PUB-003", "name": "Fampay", "code": "P3", "is_active": True},
        {"id": "PUB-005", "name": "Amazon", "code": "P5", "is_active": True},
        {"id": "PUB-006", "name": "My11Circle", "code": "P6", "is_active": True},
        {"id": "PUB-007", "name": "BHIM", "code": "P7", "is_active": True},
        {"id": "PUB-009", "name": "Zepto", "code": "P9", "is_active": True},
        {"id": "PUB-010", "name": "Maximise Money", "code": "P10", "is_active": True},
        {"id": "PUB-011", "name": "Zomato", "code": "P11", "is_active": True},
    ])


def downgrade() -> None:
    op.drop_table("rmn_budget_allocations")
    op.drop_table("rmn_publishers")
