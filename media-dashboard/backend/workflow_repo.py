"""
Async data-access for the RMN workflow (Postgres). Returns plain dicts so the
FastAPI endpoints stay thin and JSON-serialisable. No ORM relationships — joins
are explicit, per python-foundation convention.
"""

from datetime import date
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import workflow_logic as wf
from db import models


# ── serializers ───────────────────────────────────────────────────────────────

def lead_dict(l: models.Lead) -> Dict[str, Any]:
    return {
        "lead_id": l.id, "advertiser": l.advertiser_name, "owner_email": l.owner_email,
        "negotiation_status": l.negotiation_status, "source": l.source,
        "est_value": l.est_value, "currency": l.currency,
        "advertiser_ref_id": l.advertiser_ref_id,
        "created_at": l.created_at.isoformat() if l.created_at else None,
        "updated_at": l.updated_at.isoformat() if l.updated_at else None,
    }


def agreement_dict(a: models.Agreement) -> Dict[str, Any]:
    return {
        "agreement_id": a.id, "lead_id": a.lead_id, "buy_type": a.buy_type,
        "contract_value": a.contract_value, "currency": a.currency,
        "signed_doc_url": a.signed_doc_url,
        "closure_date": a.closure_date.isoformat() if a.closure_date else None,
        "status": a.status,
    }


def campaign_dict(c: models.Campaign) -> Dict[str, Any]:
    return {
        "campaign_id": c.id, "agreement_id": c.agreement_id, "name": c.name,
        "current_stage": c.current_stage, "ads_campaign_ref_id": c.ads_campaign_ref_id,
        "advertiser_ref_id": c.advertiser_ref_id,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def ops_task_dict(t: models.OpsTask) -> Dict[str, Any]:
    return {
        "task_id": t.id, "campaign_id": t.campaign_id, "step": t.step,
        "status": t.status, "owner_email": t.owner_email,
        "target_date": t.target_date.isoformat() if t.target_date else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
    }


# ── Sales: leads + agreements ──────────────────────────────────────────────────

async def create_lead(db: AsyncSession, *, advertiser: str, owner_email: str,
                      source: str = "", est_value: Optional[int] = None,
                      currency: str = "INR") -> models.Lead:
    lead = models.Lead(
        id=wf.new_id("lead"), advertiser_name=advertiser, owner_email=owner_email,
        negotiation_status="NEW", source=source or None, est_value=est_value,
        currency=currency or "INR",
    )
    db.add(lead)
    await db.commit()
    await db.refresh(lead)
    return lead


async def list_leads(db: AsyncSession, status: Optional[str] = None) -> List[models.Lead]:
    stmt = select(models.Lead).where(models.Lead.is_deleted.is_(False))
    if status:
        stmt = stmt.where(models.Lead.negotiation_status == status.upper())
    stmt = stmt.order_by(models.Lead.created_at.desc())
    return list((await db.execute(stmt)).scalars().all())


async def get_lead(db: AsyncSession, lead_id: str) -> Optional[models.Lead]:
    return (await db.execute(select(models.Lead).where(models.Lead.id == lead_id))).scalar_one_or_none()


async def update_lead(db: AsyncSession, lead: models.Lead, *,
                     negotiation_status: Optional[str] = None,
                     est_value: Optional[int] = None,
                     owner_email: Optional[str] = None) -> models.Lead:
    if negotiation_status is not None:
        lead.negotiation_status = negotiation_status.upper()
    if est_value is not None:
        lead.est_value = est_value
    if owner_email is not None:
        lead.owner_email = owner_email
    lead.updated_at = wf.utcnow()
    await db.commit()
    await db.refresh(lead)
    return lead


async def close_lead(db: AsyncSession, lead: models.Lead, *, buy_type: str,
                    contract_value: int, currency: str = "INR",
                    signed_doc_url: str = "") -> Dict[str, Any]:
    """Mark lead WON, create a SIGNED agreement, and open a campaign at OPS_SETUP
    with its ops checklist — the full Sales -> Ops hand-off, in one transaction."""
    now = wf.utcnow()
    lead.negotiation_status = "WON"
    lead.updated_at = now

    agreement = models.Agreement(
        id=wf.new_id("agr"), lead_id=lead.id, buy_type=buy_type.upper(),
        contract_value=contract_value, currency=currency or lead.currency,
        signed_doc_url=signed_doc_url or None, closure_date=date.today(),
        status="SIGNED",
    )
    db.add(agreement)

    campaign = models.Campaign(
        id=wf.new_id("camp"), agreement_id=agreement.id,
        name=f"{lead.advertiser_name} campaign", current_stage=wf.STAGE_OPS_SETUP,
        advertiser_ref_id=lead.advertiser_ref_id,
    )
    db.add(campaign)

    for step in wf.OPS_STEPS:
        db.add(models.OpsTask(id=wf.new_id("ops"), campaign_id=campaign.id,
                              step=step, status="PENDING"))

    db.add(models.StageTransition(entity_type="CAMPAIGN", entity_id=campaign.id,
                                  from_stage="AGREEMENT", to_stage=wf.STAGE_OPS_SETUP))
    await db.commit()
    await db.refresh(lead)
    await db.refresh(agreement)
    await db.refresh(campaign)
    return {"lead": lead_dict(lead), "agreement": agreement_dict(agreement),
            "campaign": campaign_dict(campaign)}


# ── Ops: campaigns + tasks + transitions ───────────────────────────────────────

async def list_campaigns(db: AsyncSession) -> List[models.Campaign]:
    stmt = (select(models.Campaign)
            .where(models.Campaign.is_deleted.is_(False))
            .order_by(models.Campaign.created_at.desc()))
    return list((await db.execute(stmt)).scalars().all())


async def get_campaign(db: AsyncSession, campaign_id: str) -> Optional[models.Campaign]:
    return (await db.execute(select(models.Campaign).where(models.Campaign.id == campaign_id))).scalar_one_or_none()


async def list_ops_tasks(db: AsyncSession, campaign_id: str) -> List[models.OpsTask]:
    stmt = (select(models.OpsTask)
            .where(models.OpsTask.campaign_id == campaign_id)
            .order_by(models.OpsTask.created_at.asc()))
    return list((await db.execute(stmt)).scalars().all())


async def get_ops_task(db: AsyncSession, task_id: str) -> Optional[models.OpsTask]:
    return (await db.execute(select(models.OpsTask).where(models.OpsTask.id == task_id))).scalar_one_or_none()


async def update_ops_task(db: AsyncSession, task: models.OpsTask, *,
                         status: Optional[str] = None,
                         owner_email: Optional[str] = None,
                         target_date: Optional[date] = None) -> models.OpsTask:
    if status is not None:
        task.status = status.upper()
        if task.status == "DONE":
            task.completed_at = wf.utcnow()
    if owner_email is not None:
        task.owner_email = owner_email
    if target_date is not None:
        task.target_date = target_date
    task.updated_at = wf.utcnow()
    await db.commit()
    await db.refresh(task)
    return task


async def count_open_ops_tasks(db: AsyncSession, campaign_id: str) -> int:
    tasks = await list_ops_tasks(db, campaign_id)
    return sum(1 for t in tasks if t.status != "DONE")


async def transition_campaign(db: AsyncSession, campaign: models.Campaign, *,
                             to_stage: str, actor_email: str = "") -> models.Campaign:
    """Move a campaign to `to_stage`, validating the transition and auditing it.
    Raises ValueError on an illegal transition or a go-live with open tasks."""
    err = wf.validate_transition(campaign.current_stage, to_stage)
    if err:
        raise ValueError(err)
    to_norm = wf.normalize_stage(to_stage)

    if to_norm == wf.STAGE_LIVE:
        open_tasks = await count_open_ops_tasks(db, campaign.id)
        if open_tasks > 0:
            raise ValueError(f"cannot go live: {open_tasks} ops task(s) not DONE")

    from_stage = campaign.current_stage
    campaign.current_stage = to_norm
    campaign.updated_at = wf.utcnow()
    db.add(models.StageTransition(entity_type="CAMPAIGN", entity_id=campaign.id,
                                  from_stage=from_stage, to_stage=to_norm,
                                  actor_email=actor_email or None))
    await db.commit()
    await db.refresh(campaign)
    return campaign
