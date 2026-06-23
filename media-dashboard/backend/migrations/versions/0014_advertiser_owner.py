"""add owner_email to rmn_advertisers + backfill existing

Revision ID: 0014_advertiser_owner
Revises: 0013_column_mappings
Create Date: 2026-06-23

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_advertiser_owner"
down_revision: Union[str, None] = "0013_column_mappings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_advertisers", sa.Column("owner_email", sa.String(255), nullable=True))
    op.execute("UPDATE rmn_advertisers SET owner_email = 'ajay.shankar@razorpay.com' WHERE owner_email IS NULL")


def downgrade() -> None:
    op.drop_column("rmn_advertisers", "owner_email")
