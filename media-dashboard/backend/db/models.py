"""
SQLAlchemy 2.0 models for the RMN workflow tables (Postgres).

Ported from the original Go schema. This service owns ONLY the process layer —
ads-server still owns advertisers/campaigns/ads/spend, so columns ending in
`_ref_id` are opaque references to ads-server / external systems (no FKs across
services). Enums are stored as VARCHAR and validated in `workflow_logic`.

Follows python-foundation conventions: `Mapped`/`mapped_column`, tz-aware
timestamps, soft-delete on the primary entities, no ORM relationships (use
explicit queries in the repository layer).
"""

from datetime import date, datetime
from typing import Optional

from sqlalchemy import BigInteger, Boolean, Date, DateTime, Float, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base, utcnow


class Lead(Base):
    __tablename__ = "rmn_leads"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    advertiser_name: Mapped[str] = mapped_column(String(255))
    owner_email: Mapped[str] = mapped_column(String(255), index=True)
    negotiation_status: Mapped[str] = mapped_column(String(32), index=True, default="NEW")
    source: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    est_value: Mapped[Optional[int]] = mapped_column(BigInteger, default=None)  # minor units
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    advertiser_ref_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    is_deleted: Mapped[bool] = mapped_column(default=False, index=True)


class Advertiser(Base):
    """An advertiser onboarded via the 6-step Sales wizard. Holds draft + final
    state; id is ADV-<3 letters of name>-NNNN (per-prefix increment)."""

    __tablename__ = "rmn_advertisers"

    id: Mapped[str] = mapped_column(String(20), primary_key=True)  # ADV-KIM-0001
    name: Mapped[str] = mapped_column(String(255))
    owner_email: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    status: Mapped[str] = mapped_column(String(16), index=True, default="DRAFT")  # DRAFT/ONBOARDED
    current_step: Mapped[int] = mapped_column(Integer, default=1)

    # Step 1 — Basics
    category: Mapped[Optional[str]] = mapped_column(String(120), default=None)
    description: Mapped[Optional[str]] = mapped_column(String(2000), default=None)
    logo_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # Step 2 — Commercial
    buy_type: Mapped[Optional[str]] = mapped_column(String(16), default=None)
    roas_multiplier: Mapped[Optional[float]] = mapped_column(Float, default=None)
    cpc_rate: Mapped[Optional[float]] = mapped_column(Float, default=None)
    budget_hint: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    gst: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    pan: Mapped[Optional[str]] = mapped_column(String(20), default=None)
    # Step 3 — Performance goal
    goal_type: Mapped[Optional[str]] = mapped_column(String(16), default=None)
    target_roas: Mapped[Optional[float]] = mapped_column(Float, default=None)
    target_cac: Mapped[Optional[float]] = mapped_column(Float, default=None)
    # Step 4 — POC
    poc_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    poc_designation: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    poc_email: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    poc_phone: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    cc_finance: Mapped[bool] = mapped_column(Boolean, default=False)
    # Step 5 — Agreement & PO
    agreement_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    po_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    po_ref: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    contract_start: Mapped[Optional[date]] = mapped_column(Date, default=None)
    # Step 7 — welcome email (sent client-side from the wizard; recorded here)
    welcome_email_to: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    welcome_email_subject: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    welcome_email_body: Mapped[Optional[str]] = mapped_column(Text, default=None)
    welcome_email_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Agreement(Base):
    __tablename__ = "rmn_agreements"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    lead_id: Mapped[str] = mapped_column(String(32), index=True)
    buy_type: Mapped[str] = mapped_column(String(32))               # CPM/CPC/CPA/ROAS_COMMIT
    contract_value: Mapped[int] = mapped_column(BigInteger)          # minor units
    currency: Mapped[str] = mapped_column(String(3), default="INR")
    signed_doc_url: Mapped[Optional[str]] = mapped_column(String(1024), default=None)
    closure_date: Mapped[Optional[date]] = mapped_column(Date, default=None)
    status: Mapped[str] = mapped_column(String(32), index=True, default="DRAFT")  # DRAFT/SIGNED/CANCELLED
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Campaign(Base):
    __tablename__ = "rmn_campaigns"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    parent_campaign_id: Mapped[Optional[str]] = mapped_column(String(32), index=True, default=None)
    agreement_id: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(255))
    current_stage: Mapped[str] = mapped_column(String(32), index=True, default="OPS_SETUP")
    ads_campaign_ref_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, default=None)
    advertiser_ref_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, default=None)
    advertiser_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    publisher_id: Mapped[Optional[str]] = mapped_column(String(32), index=True, default=None)
    publisher_name: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    # Campaign assets
    landing_link: Mapped[Optional[str]] = mapped_column(Text, default=None)
    offer_title: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    details_tc: Mapped[Optional[str]] = mapped_column(Text, default=None)
    how_to_redeem: Mapped[Optional[str]] = mapped_column(Text, default=None)
    promo_codes: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    code_validity: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    creative_url: Mapped[Optional[str]] = mapped_column(Text, default=None)
    logo_url: Mapped[Optional[str]] = mapped_column(Text, default=None)
    targeting: Mapped[Optional[str]] = mapped_column(Text, default=None)
    daily_budget: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    cpc_cpd: Mapped[Optional[str]] = mapped_column(String(64), default=None)
    not_live_reason: Mapped[Optional[str]] = mapped_column(Text, default=None)
    # Campaign tracking setup (written to Automation Tracker sheet on go-live)
    advertiser_data_url: Mapped[Optional[str]] = mapped_column(Text, default=None)
    publisher_data_url: Mapped[Optional[str]] = mapped_column(Text, default=None)
    segment_pub: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    segment_adv: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    goals_json: Mapped[Optional[str]] = mapped_column(Text, default=None)
    metrics_json: Mapped[Optional[str]] = mapped_column(Text, default=None)
    additional_context: Mapped[Optional[str]] = mapped_column(Text, default=None)
    tracking_submitted: Mapped[bool] = mapped_column(Boolean, default=False)
    # Publisher email (share to publisher)
    publisher_email_to: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    publisher_email_subject: Mapped[Optional[str]] = mapped_column(String(512), default=None)
    publisher_email_body: Mapped[Optional[str]] = mapped_column(Text, default=None)
    publisher_email_sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)
    # Gmail thread tracking (for reply-on-same-thread across clones)
    publisher_email_thread_id: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    publisher_email_message_id: Mapped[Optional[str]] = mapped_column(String(255), default=None)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    is_deleted: Mapped[bool] = mapped_column(default=False, index=True)


class Segment(Base):
    __tablename__ = "rmn_segments"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    campaign_id: Mapped[str] = mapped_column(String(32), index=True)
    publisher_ref_id: Mapped[str] = mapped_column(String(64), index=True)
    ads_segment_ref_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, default=None)
    status: Mapped[str] = mapped_column(String(32), default="ACTIVE")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class OpsTask(Base):
    __tablename__ = "rmn_ops_tasks"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    campaign_id: Mapped[str] = mapped_column(String(32), index=True)
    step: Mapped[str] = mapped_column(String(32))   # RECEIVE_ASSETS/SHARED_TO_PUBLISHER/CREATIVE_REVIEW/GO_LIVE
    status: Mapped[str] = mapped_column(String(32), index=True, default="PENDING")
    owner_email: Mapped[Optional[str]] = mapped_column(String(255), index=True, default=None)
    target_date: Mapped[Optional[date]] = mapped_column(Date, default=None)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Invoice(Base):
    __tablename__ = "rmn_invoices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    campaign_id: Mapped[str] = mapped_column(String(32), index=True)
    period_start: Mapped[date] = mapped_column(Date)
    period_end: Mapped[date] = mapped_column(Date)
    estimated_amount: Mapped[int] = mapped_column(BigInteger, default=0)
    final_amount: Mapped[Optional[int]] = mapped_column(BigInteger, default=None)
    advertiser_ref_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, default=None)
    billing_system_ref: Mapped[Optional[str]] = mapped_column(String(128), default=None)
    status: Mapped[str] = mapped_column(String(32), index=True, default="DRAFT")  # DRAFT/RAISED/PAID
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Publisher(Base):
    __tablename__ = "rmn_publishers"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)  # PUB-001
    name: Mapped[str] = mapped_column(String(128))
    code: Mapped[str] = mapped_column(String(16))  # P1, P2, ...
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BudgetAllocation(Base):
    __tablename__ = "rmn_budget_allocations"
    __table_args__ = (Index("ix_rmn_alloc_adv_pub_month", "advertiser_id", "publisher_id", "month", unique=True),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    advertiser_id: Mapped[str] = mapped_column(String(20), index=True)
    publisher_id: Mapped[str] = mapped_column(String(32), index=True)
    month: Mapped[str] = mapped_column(String(7), index=True, default="2026-06")  # YYYY-MM
    amount: Mapped[Optional[int]] = mapped_column(BigInteger, default=None)
    status: Mapped[Optional[str]] = mapped_column(String(24), default=None)  # ALLOCATED / CANT_GO_LIVE
    notes: Mapped[Optional[str]] = mapped_column(Text, default=None)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class CampaignMetric(Base):
    __tablename__ = "rmn_campaign_metrics"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    campaign_id: Mapped[str] = mapped_column(String(32), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    advertiser: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    publisher: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    segment: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    # Standard publisher metrics
    impressions: Mapped[int] = mapped_column(BigInteger, default=0)
    distribution: Mapped[int] = mapped_column(BigInteger, default=0)
    clicks: Mapped[int] = mapped_column(BigInteger, default=0)
    orders_pub: Mapped[int] = mapped_column(BigInteger, default=0)
    scratches: Mapped[int] = mapped_column(BigInteger, default=0)
    coins_burned: Mapped[int] = mapped_column(BigInteger, default=0)
    redirections: Mapped[int] = mapped_column(BigInteger, default=0)
    spends: Mapped[float] = mapped_column(Float, default=0)
    # Computed
    publisher_spends: Mapped[float] = mapped_column(Float, default=0)
    advertiser_spends: Mapped[float] = mapped_column(Float, default=0)
    # Dynamic advertiser metrics
    advertiser_metrics: Mapped[Optional[str]] = mapped_column(Text, default=None)  # JSON
    # Sync tracking
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class BillingConfig(Base):
    __tablename__ = "rmn_billing_config"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    campaign_id: Mapped[str] = mapped_column(String(32), index=True)
    side: Mapped[str] = mapped_column(String(16))
    billing_model: Mapped[str] = mapped_column(String(16))
    rate: Mapped[float] = mapped_column(Float)
    start_date: Mapped[date] = mapped_column(Date)
    end_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    created_by: Mapped[Optional[str]] = mapped_column(String(255), default=None)


class ColumnMapping(Base):
    __tablename__ = "rmn_column_mappings"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255))
    type: Mapped[str] = mapped_column(String(16))  # publisher or advertiser
    sheet_url: Mapped[Optional[str]] = mapped_column(Text, default=None)
    tab_name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    header_row: Mapped[int] = mapped_column(Integer, default=1)
    data_start_row: Mapped[int] = mapped_column(Integer, default=2)
    mapping: Mapped[str] = mapped_column(Text)  # JSON
    format_type: Mapped[str] = mapped_column(String(32), default="vertical")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class SheetUrl(Base):
    __tablename__ = "rmn_sheet_urls"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    type: Mapped[str] = mapped_column(String(16))  # 'advertiser' or 'publisher'
    name: Mapped[str] = mapped_column(String(255))
    url: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class UserRole(Base):
    __tablename__ = "rmn_user_roles"

    email: Mapped[str] = mapped_column(String(255), primary_key=True)
    role: Mapped[str] = mapped_column(String(16), default="VIEWER")  # ADMIN/SALES/OPS/VIEWER
    name: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class StageTransition(Base):
    """Audit log; each insert is also what triggers a hand-off notification."""

    __tablename__ = "rmn_stage_transitions"
    __table_args__ = (Index("ix_rmn_transitions_entity", "entity_type", "entity_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    entity_type: Mapped[str] = mapped_column(String(32))  # CAMPAIGN, LEAD, ...
    entity_id: Mapped[str] = mapped_column(String(32))
    to_stage: Mapped[str] = mapped_column(String(32))
    from_stage: Mapped[Optional[str]] = mapped_column(String(32), default=None)
    actor_email: Mapped[Optional[str]] = mapped_column(String(255), default=None)
    note: Mapped[Optional[str]] = mapped_column(String(1024), default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True, default=utcnow)
