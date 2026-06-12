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

from sqlalchemy import BigInteger, Date, DateTime, Index, String
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
    agreement_id: Mapped[str] = mapped_column(String(32), index=True)
    name: Mapped[str] = mapped_column(String(255))
    current_stage: Mapped[str] = mapped_column(String(32), index=True, default="OPS_SETUP")
    ads_campaign_ref_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, default=None)
    advertiser_ref_id: Mapped[Optional[str]] = mapped_column(String(64), index=True, default=None)
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
