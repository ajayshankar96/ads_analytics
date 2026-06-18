"""add rmn_user_roles table

Revision ID: 0010_user_roles
Revises: 0009_not_live_reason
Create Date: 2026-06-17

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_user_roles"
down_revision: Union[str, None] = "0009_not_live_reason"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_user_roles",
        sa.Column("email", sa.String(255), primary_key=True),
        sa.Column("role", sa.String(16), nullable=False, server_default="VIEWER"),
        sa.Column("name", sa.String(255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Seed admin
    roles = sa.table(
        "rmn_user_roles",
        sa.column("email", sa.String),
        sa.column("role", sa.String),
        sa.column("name", sa.String),
    )
    op.bulk_insert(roles, [
        {"email": "ajay.shankar@razorpay.com", "role": "ADMIN", "name": "Ajay Shankar"},
    ])


def downgrade() -> None:
    op.drop_table("rmn_user_roles")
