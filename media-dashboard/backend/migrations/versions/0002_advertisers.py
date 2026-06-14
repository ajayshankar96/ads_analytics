"""add rmn_advertisers (Sales onboarding wizard)

Revision ID: 0002_advertisers
Revises: 0001_init
Create Date: 2026-06-13

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0002_advertisers"
down_revision: Union[str, None] = "0001_init"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_advertisers",
        sa.Column("id", sa.String(20), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
        sa.Column("current_step", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("category", sa.String(120)),
        sa.Column("description", sa.String(2000)),
        sa.Column("logo_name", sa.String(255)),
        sa.Column("buy_type", sa.String(16)),
        sa.Column("roas_multiplier", sa.Float()),
        sa.Column("cpc_rate", sa.Float()),
        sa.Column("budget_hint", sa.String(64)),
        sa.Column("gst", sa.String(20)),
        sa.Column("pan", sa.String(20)),
        sa.Column("goal_type", sa.String(16)),
        sa.Column("target_roas", sa.Float()),
        sa.Column("target_cac", sa.Float()),
        sa.Column("poc_name", sa.String(255)),
        sa.Column("poc_designation", sa.String(255)),
        sa.Column("poc_email", sa.String(255)),
        sa.Column("poc_phone", sa.String(32)),
        sa.Column("cc_finance", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("agreement_name", sa.String(255)),
        sa.Column("po_name", sa.String(255)),
        sa.Column("po_ref", sa.String(64)),
        sa.Column("contract_start", sa.Date()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rmn_advertisers_status", "rmn_advertisers", ["status"])


def downgrade() -> None:
    op.drop_table("rmn_advertisers")
