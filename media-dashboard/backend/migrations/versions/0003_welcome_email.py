"""add welcome-email fields to rmn_advertisers

Revision ID: 0003_welcome_email
Revises: 0002_advertisers
Create Date: 2026-06-16

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003_welcome_email"
down_revision: Union[str, None] = "0002_advertisers"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rmn_advertisers", sa.Column("welcome_email_to", sa.String(512)))
    op.add_column("rmn_advertisers", sa.Column("welcome_email_subject", sa.String(512)))
    op.add_column("rmn_advertisers", sa.Column("welcome_email_body", sa.Text()))
    op.add_column("rmn_advertisers", sa.Column("welcome_email_sent_at", sa.DateTime(timezone=True)))


def downgrade() -> None:
    op.drop_column("rmn_advertisers", "welcome_email_sent_at")
    op.drop_column("rmn_advertisers", "welcome_email_body")
    op.drop_column("rmn_advertisers", "welcome_email_subject")
    op.drop_column("rmn_advertisers", "welcome_email_to")
