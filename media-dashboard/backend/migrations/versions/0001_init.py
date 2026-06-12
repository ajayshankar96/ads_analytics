"""init RMN workflow tables

Revision ID: 0001_init
Revises:
Create Date: 2026-06-12

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0001_init"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rmn_leads",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("advertiser_name", sa.String(255), nullable=False),
        sa.Column("owner_email", sa.String(255), nullable=False),
        sa.Column("negotiation_status", sa.String(32), nullable=False, server_default="NEW"),
        sa.Column("source", sa.String(64)),
        sa.Column("est_value", sa.BigInteger()),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("advertiser_ref_id", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_rmn_leads_owner_email", "rmn_leads", ["owner_email"])
    op.create_index("ix_rmn_leads_negotiation_status", "rmn_leads", ["negotiation_status"])
    op.create_index("ix_rmn_leads_advertiser_ref_id", "rmn_leads", ["advertiser_ref_id"])
    op.create_index("ix_rmn_leads_is_deleted", "rmn_leads", ["is_deleted"])

    op.create_table(
        "rmn_agreements",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("lead_id", sa.String(32), nullable=False),
        sa.Column("buy_type", sa.String(32), nullable=False),
        sa.Column("contract_value", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="INR"),
        sa.Column("signed_doc_url", sa.String(1024)),
        sa.Column("closure_date", sa.Date()),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rmn_agreements_lead_id", "rmn_agreements", ["lead_id"])
    op.create_index("ix_rmn_agreements_status", "rmn_agreements", ["status"])

    op.create_table(
        "rmn_campaigns",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("agreement_id", sa.String(32), nullable=False),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("current_stage", sa.String(32), nullable=False, server_default="OPS_SETUP"),
        sa.Column("ads_campaign_ref_id", sa.String(64)),
        sa.Column("advertiser_ref_id", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_rmn_campaigns_agreement_id", "rmn_campaigns", ["agreement_id"])
    op.create_index("ix_rmn_campaigns_current_stage", "rmn_campaigns", ["current_stage"])
    op.create_index("ix_rmn_campaigns_ads_campaign_ref_id", "rmn_campaigns", ["ads_campaign_ref_id"])
    op.create_index("ix_rmn_campaigns_advertiser_ref_id", "rmn_campaigns", ["advertiser_ref_id"])
    op.create_index("ix_rmn_campaigns_is_deleted", "rmn_campaigns", ["is_deleted"])

    op.create_table(
        "rmn_segments",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("campaign_id", sa.String(32), nullable=False),
        sa.Column("publisher_ref_id", sa.String(64), nullable=False),
        sa.Column("ads_segment_ref_id", sa.String(64)),
        sa.Column("status", sa.String(32), nullable=False, server_default="ACTIVE"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rmn_segments_campaign_id", "rmn_segments", ["campaign_id"])
    op.create_index("ix_rmn_segments_publisher_ref_id", "rmn_segments", ["publisher_ref_id"])
    op.create_index("ix_rmn_segments_ads_segment_ref_id", "rmn_segments", ["ads_segment_ref_id"])

    op.create_table(
        "rmn_ops_tasks",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("campaign_id", sa.String(32), nullable=False),
        sa.Column("step", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), nullable=False, server_default="PENDING"),
        sa.Column("owner_email", sa.String(255)),
        sa.Column("target_date", sa.Date()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rmn_ops_tasks_campaign_id", "rmn_ops_tasks", ["campaign_id"])
    op.create_index("ix_rmn_ops_tasks_status", "rmn_ops_tasks", ["status"])
    op.create_index("ix_rmn_ops_tasks_owner_email", "rmn_ops_tasks", ["owner_email"])

    op.create_table(
        "rmn_invoices",
        sa.Column("id", sa.String(32), primary_key=True),
        sa.Column("campaign_id", sa.String(32), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("estimated_amount", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("final_amount", sa.BigInteger()),
        sa.Column("advertiser_ref_id", sa.String(64)),
        sa.Column("billing_system_ref", sa.String(128)),
        sa.Column("status", sa.String(32), nullable=False, server_default="DRAFT"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rmn_invoices_campaign_id", "rmn_invoices", ["campaign_id"])
    op.create_index("ix_rmn_invoices_status", "rmn_invoices", ["status"])
    op.create_index("ix_rmn_invoices_advertiser_ref_id", "rmn_invoices", ["advertiser_ref_id"])

    op.create_table(
        "rmn_stage_transitions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("entity_type", sa.String(32), nullable=False),
        sa.Column("entity_id", sa.String(32), nullable=False),
        sa.Column("to_stage", sa.String(32), nullable=False),
        sa.Column("from_stage", sa.String(32)),
        sa.Column("actor_email", sa.String(255)),
        sa.Column("note", sa.String(1024)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rmn_transitions_entity", "rmn_stage_transitions", ["entity_type", "entity_id"])
    op.create_index("ix_rmn_stage_transitions_created_at", "rmn_stage_transitions", ["created_at"])


def downgrade() -> None:
    op.drop_table("rmn_stage_transitions")
    op.drop_table("rmn_invoices")
    op.drop_table("rmn_ops_tasks")
    op.drop_table("rmn_segments")
    op.drop_table("rmn_campaigns")
    op.drop_table("rmn_agreements")
    op.drop_table("rmn_leads")
