"""
Async data-access for the RMN workflow (Postgres). Returns plain dicts so the
FastAPI endpoints stay thin and JSON-serialisable. No ORM relationships — joins
are explicit, per python-foundation convention.
"""

import re
from datetime import date, datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import delete, select
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
        "advertiser_name": c.advertiser_name, "publisher_id": c.publisher_id,
        "publisher_name": c.publisher_name,
        "not_live_reason": c.not_live_reason,
        "advertiser_data_url": c.advertiser_data_url, "publisher_data_url": c.publisher_data_url,
        "segment_pub": c.segment_pub, "segment_adv": c.segment_adv,
        "goals_json": c.goals_json, "metrics_json": c.metrics_json,
        "additional_context": c.additional_context, "tracking_submitted": c.tracking_submitted,
        "landing_link": c.landing_link, "offer_title": c.offer_title,
        "details_tc": c.details_tc, "how_to_redeem": c.how_to_redeem,
        "promo_codes": c.promo_codes, "code_validity": c.code_validity,
        "creative_url": c.creative_url, "logo_url": c.logo_url,
        "targeting": c.targeting, "daily_budget": c.daily_budget, "cpc_cpd": c.cpc_cpd,
        "publisher_email_to": c.publisher_email_to,
        "publisher_email_subject": c.publisher_email_subject,
        "publisher_email_body": c.publisher_email_body,
        "publisher_email_sent_at": c.publisher_email_sent_at.isoformat() if c.publisher_email_sent_at else None,
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def ops_task_dict(t: models.OpsTask) -> Dict[str, Any]:
    return {
        "task_id": t.id, "campaign_id": t.campaign_id, "step": t.step,
        "status": t.status, "owner_email": t.owner_email,
        "target_date": t.target_date.isoformat() if t.target_date else None,
        "completed_at": t.completed_at.isoformat() if t.completed_at else None,
    }


# ── Advertisers (6-step onboarding wizard) ─────────────────────────────────────

_ADV_FIELDS = [
    "name", "category", "description", "logo_name",
    "buy_type", "roas_multiplier", "cpc_rate", "budget_hint", "gst", "pan",
    "goal_type", "target_roas", "target_cac",
    "poc_name", "poc_designation", "poc_email", "poc_phone", "cc_finance",
    "agreement_name", "po_name", "po_ref",
]
_ADV_FLOAT = {"roas_multiplier", "cpc_rate", "target_roas", "target_cac"}


def advertiser_dict(a: models.Advertiser) -> Dict[str, Any]:
    return {
        "id": a.id, "name": a.name, "status": a.status, "current_step": a.current_step,
        "category": a.category, "description": a.description, "logo_name": a.logo_name,
        "buy_type": a.buy_type, "roas_multiplier": a.roas_multiplier, "cpc_rate": a.cpc_rate,
        "budget_hint": a.budget_hint, "gst": a.gst, "pan": a.pan,
        "goal_type": a.goal_type, "target_roas": a.target_roas, "target_cac": a.target_cac,
        "poc_name": a.poc_name, "poc_designation": a.poc_designation,
        "poc_email": a.poc_email, "poc_phone": a.poc_phone, "cc_finance": a.cc_finance,
        "agreement_name": a.agreement_name, "po_name": a.po_name, "po_ref": a.po_ref,
        "contract_start": a.contract_start.isoformat() if a.contract_start else None,
        "welcome_email_to": a.welcome_email_to,
        "welcome_email_subject": a.welcome_email_subject,
        "welcome_email_body": a.welcome_email_body,
        "welcome_email_sent_at": a.welcome_email_sent_at.isoformat() if a.welcome_email_sent_at else None,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


async def record_welcome_email(db: AsyncSession, adv: models.Advertiser, *,
                               to: str, subject: str, body: str) -> models.Advertiser:
    """Persist that the welcome email was sent for this advertiser."""
    adv.welcome_email_to = to
    adv.welcome_email_subject = subject
    adv.welcome_email_body = body
    adv.welcome_email_sent_at = wf.utcnow()
    adv.updated_at = wf.utcnow()
    await db.commit()
    await db.refresh(adv)
    return adv


def _coerce_adv(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Pick known advertiser fields from a payload, coercing numeric/date types
    and ignoring blanks so partial drafts save cleanly."""
    out: Dict[str, Any] = {}
    for f in _ADV_FIELDS:
        if f not in payload:
            continue
        val = payload[f]
        if val == "" or val is None:
            out[f] = None
            continue
        if f in _ADV_FLOAT:
            try:
                out[f] = float(val)
            except (TypeError, ValueError):
                out[f] = None
        elif f == "cc_finance":
            out[f] = bool(val)
        else:
            out[f] = val
    if "contract_start" in payload and payload["contract_start"]:
        try:
            out["contract_start"] = date.fromisoformat(str(payload["contract_start"]))
        except ValueError:
            pass
    return out


async def next_advertiser_id(db: AsyncSession, name: str) -> str:
    """ADV-<first 3 letters of name>-NNNN, incrementing per prefix."""
    letters = re.sub(r"[^A-Za-z]", "", name or "")[:3].upper() or "ADV"
    prefix = f"ADV-{letters}-"
    rows = (await db.execute(
        select(models.Advertiser.id).where(models.Advertiser.id.like(prefix + "%"))
    )).scalars().all()
    maxn = 0
    for rid in rows:
        try:
            maxn = max(maxn, int(rid.rsplit("-", 1)[1]))
        except (ValueError, IndexError):
            pass
    return f"{prefix}{maxn + 1:04d}"


async def list_advertisers(db: AsyncSession) -> List[models.Advertiser]:
    stmt = select(models.Advertiser).order_by(models.Advertiser.created_at.desc())
    return list((await db.execute(stmt)).scalars().all())


async def get_advertiser(db: AsyncSession, adv_id: str) -> Optional[models.Advertiser]:
    return (await db.execute(select(models.Advertiser).where(models.Advertiser.id == adv_id))).scalar_one_or_none()


async def create_advertiser(db: AsyncSession, payload: Dict[str, Any]) -> models.Advertiser:
    fields = _coerce_adv(payload)
    name = fields.get("name") or payload.get("name") or ""
    adv = models.Advertiser(
        id=await next_advertiser_id(db, name),
        status=payload.get("status", "DRAFT"),
        current_step=int(payload.get("current_step", 1) or 1),
        **fields,
    )
    db.add(adv)
    await db.commit()
    await db.refresh(adv)
    return adv


async def update_advertiser(db: AsyncSession, adv: models.Advertiser, payload: Dict[str, Any]) -> models.Advertiser:
    for k, v in _coerce_adv(payload).items():
        setattr(adv, k, v)
    if "status" in payload and payload["status"]:
        adv.status = payload["status"]
    if "current_step" in payload and payload["current_step"]:
        adv.current_step = int(payload["current_step"])
    adv.updated_at = wf.utcnow()
    await db.commit()
    await db.refresh(adv)
    return adv


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
    # Only show campaigns linked to a Sales-pipeline advertiser (rmn_advertisers),
    # so legacy lead-era campaigns without an advertiser don't appear in Ops.
    adv_ids = select(models.Advertiser.id)
    stmt = (select(models.Campaign)
            .where(models.Campaign.is_deleted.is_(False),
                   models.Campaign.advertiser_ref_id.in_(adv_ids))
            .order_by(models.Campaign.created_at.desc()))
    return list((await db.execute(stmt)).scalars().all())


async def get_campaign(db: AsyncSession, campaign_id: str) -> Optional[models.Campaign]:
    return (await db.execute(select(models.Campaign).where(models.Campaign.id == campaign_id))).scalar_one_or_none()


_ASSET_FIELDS = [
    "landing_link", "offer_title", "details_tc", "how_to_redeem",
    "promo_codes", "code_validity", "creative_url", "logo_url",
    "targeting", "daily_budget", "cpc_cpd",
]


async def update_campaign_assets(db: AsyncSession, campaign: models.Campaign, payload: Dict[str, Any]) -> models.Campaign:
    for f in _ASSET_FIELDS:
        if f in payload:
            setattr(campaign, f, payload[f] or None)
    campaign.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(campaign)
    return campaign


async def record_publisher_email(db: AsyncSession, campaign: models.Campaign, *, to: str, subject: str, body: str) -> models.Campaign:
    campaign.publisher_email_to = to
    campaign.publisher_email_subject = subject
    campaign.publisher_email_body = body
    campaign.publisher_email_sent_at = datetime.now(timezone.utc)
    campaign.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(campaign)
    return campaign


async def next_campaign_id(db: AsyncSession, adv_name: str, pub_name: str) -> str:
    """CMP-<first 3 letters of advertiser>-<first 3 letters of publisher>-NNNN."""
    adv_code = re.sub(r"[^A-Za-z]", "", adv_name or "")[:3].upper() or "ADV"
    pub_code = re.sub(r"[^A-Za-z]", "", pub_name or "")[:3].upper() or "PUB"
    prefix = f"CMP-{adv_code}-{pub_code}-"
    rows = (await db.execute(
        select(models.Campaign.id).where(models.Campaign.id.like(prefix + "%"))
    )).scalars().all()
    maxn = 0
    for rid in rows:
        try:
            maxn = max(maxn, int(rid.rsplit("-", 1)[1]))
        except (ValueError, IndexError):
            pass
    return f"{prefix}{maxn + 1:04d}"


async def open_campaign_for_advertiser(db: AsyncSession, advertiser: models.Advertiser,
                                       publisher_id: Optional[str] = None,
                                       publisher_name: Optional[str] = None) -> models.Campaign:
    """Idempotently open an Ops campaign for an onboarded advertiser (optionally
    linked to a specific publisher). Returns the existing campaign if one already
    exists for this advertiser+publisher combo."""
    q = select(models.Campaign).where(
        models.Campaign.advertiser_ref_id == advertiser.id,
        models.Campaign.is_deleted.is_(False),
    )
    if publisher_id:
        q = q.where(models.Campaign.publisher_id == publisher_id)
    existing = (await db.execute(q)).scalar_one_or_none()
    if existing:
        return existing

    camp_id = await next_campaign_id(db, advertiser.name, publisher_name or "")
    campaign = models.Campaign(
        id=camp_id,
        agreement_id="",
        name=f"{advertiser.name} campaign",
        current_stage=wf.STAGE_OPS_SETUP,
        advertiser_ref_id=advertiser.id,
        advertiser_name=advertiser.name,
        publisher_id=publisher_id,
        publisher_name=publisher_name,
    )
    db.add(campaign)
    for step in wf.OPS_STEPS:
        db.add(models.OpsTask(id=wf.new_id("ops"), campaign_id=campaign.id, step=step, status="PENDING"))
    db.add(models.StageTransition(
        entity_type="CAMPAIGN", entity_id=campaign.id,
        from_stage="ONBOARDED", to_stage=wf.STAGE_OPS_SETUP,
        note=f"opened from advertiser {advertiser.id}" + (f" for publisher {publisher_name}" if publisher_name else ""),
    ))
    await db.commit()
    await db.refresh(campaign)
    return campaign


async def backfill_campaigns_for_onboarded(db: AsyncSession) -> List[models.Campaign]:
    """One-time: open campaigns for every ONBOARDED advertiser that doesn't have
    one yet (covers advertisers onboarded before this linkage existed)."""
    advs = (await db.execute(
        select(models.Advertiser).where(models.Advertiser.status == "ONBOARDED")
    )).scalars().all()
    opened = []
    for adv in advs:
        before = (await db.execute(
            select(models.Campaign).where(
                models.Campaign.advertiser_ref_id == adv.id,
                models.Campaign.is_deleted.is_(False),
            )
        )).scalar_one_or_none()
        if not before:
            opened.append(await open_campaign_for_advertiser(db, adv))
    return opened


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

    if to_norm in (wf.STAGE_ASSETS_RECEIVED, wf.STAGE_CREATIVE_REVIEW):
        missing = [f for f in _ASSET_FIELDS if not getattr(campaign, f, None)]
        if missing:
            raise ValueError(f"cannot proceed: {len(missing)} asset(s) still missing ({', '.join(missing[:3])}...)")

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


# ── publishers & budget allocation ────────────────────────────────────────────

async def list_publishers(db: AsyncSession) -> List[Dict[str, Any]]:
    result = await db.execute(
        select(models.Publisher).where(models.Publisher.is_active == True).order_by(models.Publisher.code)
    )
    return [{"id": p.id, "name": p.name, "code": p.code} for p in result.scalars().all()]


async def create_publisher(db: AsyncSession, name: str, code: str) -> Dict[str, Any]:
    result = await db.execute(select(models.Publisher))
    count = len(result.scalars().all())
    pub_id = f"PUB-{count + 1:03d}"
    pub = models.Publisher(id=pub_id, name=name, code=code, is_active=True)
    db.add(pub)
    await db.commit()
    await db.refresh(pub)
    return {"id": pub.id, "name": pub.name, "code": pub.code}


async def get_allocations(db: AsyncSession, advertiser_id: str, month: str = None) -> List[Dict[str, Any]]:
    q = select(models.BudgetAllocation).where(models.BudgetAllocation.advertiser_id == advertiser_id)
    if month:
        q = q.where(models.BudgetAllocation.month == month)
    result = await db.execute(q)
    return [
        {"id": a.id, "publisher_id": a.publisher_id, "amount": a.amount,
         "status": a.status, "notes": a.notes, "month": a.month}
        for a in result.scalars().all()
    ]


async def get_all_allocations_for_month(db: AsyncSession, month: str) -> List[Dict[str, Any]]:
    result = await db.execute(
        select(models.BudgetAllocation).where(models.BudgetAllocation.month == month)
    )
    return [
        {"id": a.id, "advertiser_id": a.advertiser_id, "publisher_id": a.publisher_id,
         "amount": a.amount, "status": a.status, "notes": a.notes}
        for a in result.scalars().all()
    ]


async def upsert_allocations(db: AsyncSession, advertiser_id: str, month: str, allocations: List[Dict[str, Any]]) -> None:
    await db.execute(
        delete(models.BudgetAllocation).where(
            models.BudgetAllocation.advertiser_id == advertiser_id,
            models.BudgetAllocation.month == month,
        )
    )
    now = datetime.now(timezone.utc)
    for alloc in allocations:
        db.add(models.BudgetAllocation(
            advertiser_id=advertiser_id,
            publisher_id=alloc["publisher_id"],
            month=month,
            amount=alloc.get("amount"),
            status=alloc.get("status"),
            notes=alloc.get("notes"),
            updated_at=now,
        ))
    await db.commit()

    # Auto-create campaigns for allocations with amount > 0
    advertiser = await get_advertiser(db, advertiser_id)
    if not advertiser:
        return
    pub_rows = (await db.execute(select(models.Publisher))).scalars().all()
    pub_map = {p.id: p.name for p in pub_rows}

    for alloc in allocations:
        amount = alloc.get("amount")
        if not amount or amount <= 0:
            continue
        pub_id = alloc["publisher_id"]
        pub_name = pub_map.get(pub_id, "")
        await open_campaign_for_advertiser(db, advertiser, publisher_id=pub_id, publisher_name=pub_name)
