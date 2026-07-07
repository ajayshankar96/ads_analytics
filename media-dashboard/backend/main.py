"""
Razorpay Media Dashboard — FastAPI backend.

Run locally:
    cd backend
    uvicorn main:app --reload --port 8000
"""

import json
import logging
import os
from datetime import datetime, timedelta, timezone as dt_timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cache import cache, load_master_report_cache, start_background_refresh, MASTER_CACHE_KEY
from data_logic import (
    ADV_METRICS,
    apply_filters,
    calculate_aggregates,
    compute_data_freshness,
    get_advertiser_performance,
    get_breakdowns,
    get_budget_data,
    get_filter_options,
    get_filter_relationships,
    get_monthly_spend_analysis,
    get_publisher_performance,
    get_time_series,
    prepare_table_data,
    validate_formula,
)
from sheets_client import (
    KPI_SPREADSHEET_ID,
    append_rows,
    read_kpi_sheet,
    read_range,
    update_range,
    create_spreadsheet,
    write_sheet_tab,
    share_spreadsheet,
    ensure_sheet_tab,
    ensure_reports_folder,
    move_to_folder,
    set_app_properties,
    get_app_properties,
    list_folder_files,
    trash_file,
)
from reporting_logic import (
    FORCED_COLS,
    REPORT_SHARE_EMAILS,
    ADVERTISER_REGISTRY_SHEET,
    PUBLISHER_REGISTRY_SHEET,
    ADV_REG_HEADERS,
    PUB_REG_HEADERS,
    get_available_columns,
    get_publisher_extra_metrics,
    get_publisher_advertisers,
    filter_by_advertiser,
    filter_by_publisher,
    filter_by_date,
    build_consolidated,
    build_monthly,
    build_weekly,
    build_segment_weekly,
    build_pub_daily,
    build_pub_weekly,
    build_pub_mtd,
    parse_adv_registry,
    parse_pub_registry,
)
import workflow_logic as wf
import workflow_repo as repo
from db.database import get_db, engine
from db import models
from auth import AuthMiddleware, auth_enabled, is_admin, router as auth_router
from sqlalchemy import func, select, text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Dual data source: Sheet cache OR Postgres ─────────────────────────────────
_pg_cache = {"data": None, "ts": 0}

def load_from_postgres(strict: bool = False):
    """Load campaign metrics from Postgres in the same format as load_master_report_cache().

    Offer / Advertiser_Segment / Advertiser_Industry and Week/Month start dates
    are filled via joins to rmn_campaigns and rmn_advertisers (verified: every
    metric row joins to a campaign, every campaign to an advertiser).

    strict=True raises on failure instead of silently falling back to the
    Google-Sheet cache — used by /api/reporting/* so generated reports are
    guaranteed Postgres-sourced (the legacy sheet has 19k unrelated rows).
    """
    import time
    now = time.time()
    if _pg_cache["data"] and (now - _pg_cache["ts"]) < 60:
        return _pg_cache["data"]

    from sqlalchemy import create_engine
    db_url = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql+pg8000://").replace("postgresql://", "postgresql+pg8000://")
    if not db_url:
        if strict:
            raise RuntimeError("DATABASE_URL not configured")
        return load_master_report_cache()
    try:
        metrics_json_expr = "COALESCE(NULLIF(m.advertiser_metrics, ''), '{}')::jsonb"
        direct_adv_spends_expr = f"NULLIF(COALESCE({metrics_json_expr}->>'Spends', {metrics_json_expr}->>'spends'), '')::float"
        publisher_spends_expr = (
            "CASE "
            "WHEN m.publisher_spends_source IN ('sheet', 'calculated') THEN COALESCE(m.publisher_spends, 0) "
            "WHEN m.publisher_spends != 0 THEN m.publisher_spends "
            "ELSE COALESCE(m.spends, 0) END"
        )
        advertiser_spends_expr = (
            "CASE "
            "WHEN m.advertiser_spends_source IN ('sheet', 'calculated') THEN COALESCE(m.advertiser_spends, 0) "
            f"ELSE COALESCE({direct_adv_spends_expr}, 0) END"
        )
        eng = create_engine(db_url, pool_pre_ping=True)
        with eng.connect() as conn:
            rows_raw = conn.execute(text(f"""
                SELECT m.advertiser, m.publisher,
                       COALESCE(a.category, '') as industry, m.date::text,
                       to_char(date_trunc('week', m.date), 'YYYY-MM-DD') as week,
                       to_char(date_trunc('month', m.date), 'YYYY-MM-DD') as month_start,
                       m.segment, COALESCE(c.segment_adv, '') as adv_segment,
                       '' as cohort, m.advertiser as brand,
                       COALESCE(NULLIF(c.offer_title, ''), c.name, '') as offer,
                       m.impressions, m.distribution, m.clicks,
                       CASE WHEN m.impressions > 0 THEN m.clicks::float/m.impressions*100 ELSE 0 END as ctr,
                       m.orders_pub, m.scratches, m.coins_burned, m.redirections, m.spends,
                       CASE WHEN m.impressions > 0 THEN ({publisher_spends_expr})/m.impressions*1000 ELSE 0 END as cpm,
                       CASE WHEN m.clicks > 0 THEN ({publisher_spends_expr})/m.clicks ELSE 0 END as cpc,
                       {publisher_spends_expr} as publisher_spends,
                       {advertiser_spends_expr} as advertiser_spends,
                       m.advertiser_metrics
                FROM rmn_campaign_metrics m
                LEFT JOIN rmn_campaigns c ON c.id = m.campaign_id
                LEFT JOIN rmn_advertisers a ON a.id = c.advertiser_ref_id
                ORDER BY m.date
            """)).fetchall()

        headers = ["Advertiser", "Publisher", "Advertiser_Industry", "Date", "Week_Start_Date", "Month_Start_Date", "Segment", "Advertiser_Segment", "Cohort_Name", "Brand", "Offer", "Impressions", "Distribution", "Clicks", "CTR", "Orders_pub", "Scratches", "Coins_Burned", "Redirections", "Spends", "CPM", "CPC", "Publisher_Spends", "Advertiser_Spends"]

        # Parse advertiser_metrics JSON and add dynamic columns
        import json as _json
        all_adv_metrics = set()
        parsed_rows = []
        for r in rows_raw:
            row = list(r[:24])
            metrics = {}
            if r[24]:
                try: metrics = _json.loads(r[24])
                except: pass
            all_adv_metrics.update(metrics.keys())
            parsed_rows.append((row, metrics))

        # Dedupe dynamic JSON metrics against base headers: keys like "Clicks"
        # or "Spends" would otherwise appear twice in the report column picker,
        # and _get_col() always resolves to the base column so the JSON variant
        # was unreachable anyway (JSON Spends is already folded into
        # Advertiser_Spends above).
        base_lower = {h.lower() for h in headers}
        adv_metric_cols = sorted(k for k in all_adv_metrics if k.lower() not in base_lower)
        full_headers = headers + adv_metric_cols

        full_rows = []
        for row, metrics in parsed_rows:
            for col in adv_metric_cols:
                row.append(str(metrics.get(col, "-")))
            full_rows.append([str(v) for v in row])

        result = {"headers": full_headers, "rows": full_rows, "cache_age": 0}
        _pg_cache["data"] = result
        _pg_cache["ts"] = now
        return result
    except Exception as e:
        if strict:
            raise
        logger.warning(f"Postgres load failed, falling back to sheet: {e}")
        return load_master_report_cache()


# ── Advertiser goals (for RAG status on the performance tabs) ──────────────────
_goals_cache = {"data": None, "ts": 0}

def load_advertiser_goals():
    """{advertiser_name: {goal_type, target_roas, target_cac}} from rmn_advertisers.

    Sync loader (mirrors load_from_postgres' engine) so the synchronous
    performance endpoints can attach a Red/Amber/Green status keyed by the
    advertiser name that appears in the metric rows. Empty dict on any failure —
    RAG simply doesn't render. Cached 60s.
    """
    import time
    now = time.time()
    if _goals_cache["data"] is not None and (now - _goals_cache["ts"]) < 60:
        return _goals_cache["data"]

    from sqlalchemy import create_engine, text as _text
    db_url = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql+pg8000://").replace("postgresql://", "postgresql+pg8000://")
    goals = {}
    if not db_url:
        return goals
    try:
        eng = create_engine(db_url, pool_pre_ping=True)
        with eng.connect() as conn:
            for name, goal_type, t_roas, t_cac in conn.execute(_text(
                "SELECT name, goal_type, target_roas, target_cac FROM rmn_advertisers"
            )).fetchall():
                if not name:
                    continue
                goals[name] = {
                    "goal_type": goal_type or "ROAS",
                    "target_roas": float(t_roas) if t_roas is not None else None,
                    "target_cac": float(t_cac) if t_cac is not None else None,
                }
        _goals_cache["data"] = goals
        _goals_cache["ts"] = now
    except Exception as e:
        logger.warning(f"Advertiser goals load failed: {e}")
    return goals


# ── Performance metric config (user-managed metrics on the performance tabs) ──
VALID_METRIC_SCOPES = ("advertiser", "publisher")
# Keys already rendered by the performance tabs — customs may not reuse them.
BUILTIN_METRIC_KEYS = set(ADV_METRICS) | {"ctr", "cpql", "roas", "cac", "goal", "name", "rag", "deltas"}
# Derived formulas may reference any aggregated metric or built-in ratio.
FORMULA_BASE_NAMES = set(ADV_METRICS) | {"ctr", "cpql", "roas", "cac"}
METRIC_FMTS = {"number", "currency", "percent", "decimal", "multiple"}
# Dimension columns from load_from_postgres — not offered as base-metric sources.
_METRIC_DIMENSION_HEADERS = {
    "advertiser", "publisher", "advertiser_industry", "date", "week_start_date",
    "month_start_date", "segment", "advertiser_segment", "cohort_name", "brand", "offer",
}
_metric_cfg_cache = {}


def load_metric_config(scope: str) -> dict:
    """Saved metric config for a performance tab: {"hidden": [...], "custom": [...]}.

    Sync loader (the performance endpoints are sync) mirroring
    load_advertiser_goals. Empty config on any failure — the tabs simply show
    their built-in columns. Cached 30s; invalidated on save.
    """
    import time
    now = time.time()
    hit = _metric_cfg_cache.get(scope)
    if hit and (now - hit["ts"]) < 30:
        return hit["data"]

    from sqlalchemy import create_engine, text as _text
    out = {"hidden": [], "custom": []}
    db_url = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql+pg8000://").replace("postgresql://", "postgresql+pg8000://")
    if db_url:
        try:
            eng = create_engine(db_url, pool_pre_ping=True)
            with eng.connect() as conn:
                row = conn.execute(_text(
                    "SELECT config FROM rmn_metric_config WHERE scope = :s"
                ), {"s": scope}).fetchone()
            if row and row[0]:
                cfg = json.loads(row[0])
                out["hidden"] = [str(k) for k in cfg.get("hidden", []) if k]
                out["custom"] = [m for m in cfg.get("custom", []) if isinstance(m, dict) and m.get("key")]
        except Exception as e:
            logger.warning(f"Metric config load failed for {scope}: {e}")
    _metric_cfg_cache[scope] = {"data": out, "ts": now}
    return out


_active_source = {"value": "postgres"}  # default to postgres

def load_data(source: str = None):
    """Load data from either Sheet cache or Postgres."""
    src = source or _active_source["value"]
    if src == "postgres":
        return load_from_postgres()
    return load_master_report_cache()


def load_report_data():
    """Data for /api/reporting/* — always Postgres, never the sheet fallback.

    Reports are scoped to workflow-managed campaigns; silently swapping in the
    legacy sheet would produce a wrong report, so failures surface as 503s.
    """
    try:
        return load_from_postgres(strict=True)
    except Exception as e:
        logger.error(f"Report data load from Postgres failed: {e}")
        raise HTTPException(status_code=503, detail=f"Report data source (Postgres) unavailable: {e}")


app = FastAPI(title="Razorpay Media Dashboard API", version="1.0.0")

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Auth gate (Google OAuth + email allowlist) ────────────────────────────────
# Registered before the SPA catch-all so /auth/* and /signin resolve. The
# middleware is a no-op until GOOGLE_CLIENT_ID is set (see auth.py), so this is
# safe to deploy before the OAuth client exists.
app.include_router(auth_router)
app.add_middleware(AuthMiddleware)
logger.info("Auth gate %s", "ENABLED" if auth_enabled() else "disabled (no GOOGLE_CLIENT_ID)")


# ── Startup ───────────────────────────────────────────────────────────────────
@app.on_event("startup")
async def startup_event():
    """Pre-warm the cache and start background refresh."""
    logger.info("Starting up — pre-warming master report cache...")
    try:
        load_master_report_cache()
    except Exception as e:
        logger.warning(f"Pre-warm failed (will retry on first request): {e}")

    refresh_interval = int(os.environ.get("CACHE_REFRESH_INTERVAL", "300"))
    start_background_refresh(interval_seconds=refresh_interval)

    # Ensure the dedicated views spreadsheet + tab exist
    try:
        _ensure_views_sheet()
    except Exception as e:
        logger.warning(f"Views sheet setup deferred: {e}")


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    age = cache.age(MASTER_CACHE_KEY)
    return {
        "status": "ok",
        "cache": "warm" if age is not None else "cold",
        "cacheAgeSecs": age,
    }


# ── Sheet URLs ────────────────────────────────────────────────────────────────

@app.get("/api/sheet-urls")
async def get_sheet_urls(type: Optional[str] = None, name: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Get stored sheet URLs, optionally filtered by type and/or name."""
    result = await db.execute(text(
        "SELECT id, type, name, url, created_at FROM rmn_sheet_urls ORDER BY type, name, created_at DESC"
    ))
    rows = result.fetchall()
    urls = [{"id": r[0], "type": r[1], "name": r[2], "url": r[3], "created_at": r[4].isoformat() if r[4] else None} for r in rows]
    if type:
        urls = [u for u in urls if u["type"] == type]
    if name:
        urls = [u for u in urls if u["name"] == name]
    return {"urls": urls}


@app.post("/api/sheet-urls")
async def add_sheet_url(request: Request, db: AsyncSession = Depends(get_db)):
    """Add or update a sheet URL."""
    body = await request.json()
    url_type = body.get("type", "")
    name = body.get("name", "")
    url = body.get("url", "")
    if not url_type or not name or not url:
        raise HTTPException(status_code=400, detail="type, name, and url are required")
    await db.execute(text(
        "INSERT INTO rmn_sheet_urls (type, name, url) VALUES (:type, :name, :url)"
    ), {"type": url_type, "name": name, "url": url})
    await db.commit()
    return {"success": True}


# ── Column Mappings ───────────────────────────────────────────────────────────

@app.get("/api/sheet-preview")
async def sheet_preview(url: str = Query(...), tab: Optional[str] = None):
    """Read first 5 rows from a sheet to show column structure for mapping.
    Supports both native Google Sheets and .xlsx files in Drive (auto-converts)."""
    from sheets_client import _get_service, _get_credentials
    from googleapiclient.discovery import build as _build
    import re as _re
    match = _re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url)
    if not match:
        match = _re.search(r'/file/d/([a-zA-Z0-9-_]+)', url)
    if not match:
        raise HTTPException(status_code=400, detail="Invalid sheet URL")
    file_id = match.group(1)
    service = _get_service()
    converted_id = None
    try:
        meta = service.spreadsheets().get(spreadsheetId=file_id).execute()
    except Exception as e:
        if "not supported" in str(e).lower() or "office file" in str(e).lower():
            creds = _get_credentials()
            drive = _build("drive", "v3", credentials=creds)
            copy = drive.files().copy(
                fileId=file_id,
                body={"name": "_tmp_preview_conversion", "mimeType": "application/vnd.google-apps.spreadsheet"}
            ).execute()
            converted_id = copy["id"]
            file_id = converted_id
            meta = service.spreadsheets().get(spreadsheetId=file_id).execute()
        else:
            raise HTTPException(status_code=400, detail=str(e))
    try:
        tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]
        target_tab = tab if tab and tab in tabs else tabs[0]
        # A1:ZZ (702 cols) matches what etl_worker syncs; the old A1:Z cap cut
        # the visual picker off at column Z even when data sat further right
        # (e.g. multiple offers in one tab reaching column CE).
        result = service.spreadsheets().values().get(
            spreadsheetId=file_id, range=f"'{target_tab}'!A1:ZZ20"
        ).execute()
        rows = result.get("values", [])
        return {"tabs": tabs, "selected_tab": target_tab, "rows": rows[:20]}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        if converted_id:
            try:
                creds = _get_credentials()
                drive = _build("drive", "v3", credentials=creds)
                drive.files().delete(fileId=converted_id).execute()
            except Exception:
                pass


@app.get("/api/column-mappings")
async def get_column_mappings(
    name: Optional[str] = None,
    type: Optional[str] = None,
    sheet_url: Optional[str] = None,
    campaign_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """Get saved column mappings."""
    sql = "SELECT id, campaign_id, name, type, sheet_url, tab_name, header_row, data_start_row, mapping, format_type, created_at, tab_pattern, tab_match_mode, sheet_fingerprint FROM rmn_column_mappings"
    params = {}
    clauses = []
    if type:
        clauses.append("type = :type"); params["type"] = type
    if campaign_id and type:
        params["campaign_id"] = campaign_id
        scope_clauses = ["campaign_id = :campaign_id"]
        if sheet_url:
            scope_clauses.append("(campaign_id IS NULL AND sheet_url = :sheet_url)")
            params["sheet_url"] = sheet_url
        if name:
            scope_clauses.append("(campaign_id IS NULL AND name = :name)")
            params["name"] = name
        clauses.append("(" + " OR ".join(scope_clauses) + ")")
    else:
        if name:
            clauses.append("name = :name"); params["name"] = name
        if sheet_url:
            clauses.append("sheet_url = :sheet_url"); params["sheet_url"] = sheet_url
        if campaign_id:
            clauses.append("campaign_id = :campaign_id"); params["campaign_id"] = campaign_id
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    if campaign_id and type:
        order_parts = ["WHEN campaign_id = :campaign_id THEN 0"]
        if sheet_url:
            order_parts.append("WHEN campaign_id IS NULL AND sheet_url = :sheet_url THEN 1")
        order_parts.append("ELSE 2")
        sql += " ORDER BY CASE " + " ".join(order_parts) + " END, updated_at DESC"
    else:
        sql += " ORDER BY updated_at DESC"
    result = await db.execute(text(sql), params)
    rows = result.fetchall()
    def _fp(raw):
        try:
            return json.loads(raw) if raw else None
        except (TypeError, ValueError):
            return None
    return {"mappings": [
        {"id": r[0], "campaign_id": r[1], "name": r[2], "type": r[3], "sheet_url": r[4], "tab_name": r[5],
         "header_row": r[6], "data_start_row": r[7], "mapping": json.loads(r[8]) if r[8] else {},
         "format_type": r[9], "created_at": r[10].isoformat() if r[10] else None,
         "tab_pattern": r[11], "tab_match_mode": r[12] or "exact",
         "sheet_fingerprint": _fp(r[13])}
        for r in rows
    ]}


@app.post("/api/column-mappings")
async def save_column_mapping(request: Request, db: AsyncSession = Depends(get_db)):
    """Save or update a column mapping."""
    body = await request.json()
    name = body.get("name", "")
    map_type = body.get("type", "")
    campaign_id = body.get("campaign_id") or None
    sheet_url = body.get("sheet_url", "")
    if not name or not map_type:
        raise HTTPException(status_code=400, detail="name and type are required")

    mapping_json = json.dumps(body.get("mapping", {}))

    # Snapshot the sheet's current shape (mapped-column headers, resolved tabs,
    # segment values) so Sheet Health can detect drift later. Best-effort: a
    # Sheets hiccup must never block saving the mapping itself.
    fingerprint = None
    if sheet_url:
        try:
            import asyncio as _asyncio
            import etl_worker
            from sheets_client import _get_service
            fp_cfg = {
                "tab_name": body.get("tab_name", ""),
                "tab_pattern": body.get("tab_pattern") or "",
                "tab_match_mode": body.get("tab_match_mode") or "exact",
                "mapping": body.get("mapping", {}) or {},
                "format_type": body.get("format_type", "visual"),
            }
            fingerprint = await _asyncio.to_thread(
                etl_worker.capture_sheet_fingerprint, _get_service(), sheet_url, fp_cfg)
        except Exception as e:
            logger.warning(f"fingerprint capture failed on save ({sheet_url}): {e}")

    # Upsert by the narrowest available scope. New Campaign Tracking mappings
    # are campaign-scoped; legacy callers can still save sheet- or name-scoped rows.
    if campaign_id:
        await db.execute(text("DELETE FROM rmn_column_mappings WHERE campaign_id = :campaign_id AND type = :type"),
                         {"campaign_id": campaign_id, "type": map_type})
    elif sheet_url:
        await db.execute(text("DELETE FROM rmn_column_mappings WHERE campaign_id IS NULL AND name = :name AND type = :type AND sheet_url = :sheet_url"),
                         {"name": name, "type": map_type, "sheet_url": sheet_url})
    else:
        await db.execute(text("DELETE FROM rmn_column_mappings WHERE campaign_id IS NULL AND name = :name AND type = :type"),
                         {"name": name, "type": map_type})
    await db.execute(text("""
        INSERT INTO rmn_column_mappings (campaign_id, name, type, sheet_url, tab_name, header_row, data_start_row, mapping, format_type, tab_pattern, tab_match_mode, sheet_fingerprint, updated_at)
        VALUES (:campaign_id, :name, :type, :sheet_url, :tab_name, :header_row, :data_start_row, :mapping, :format_type, :tab_pattern, :tab_match_mode, :sheet_fingerprint, NOW())
    """), {
        "campaign_id": campaign_id,
        "name": name, "type": map_type,
        "sheet_url": sheet_url,
        "tab_name": body.get("tab_name", ""),
        "header_row": body.get("header_row", 1),
        "data_start_row": body.get("data_start_row", 2),
        "mapping": mapping_json,
        "format_type": body.get("format_type", "vertical"),
        "tab_pattern": body.get("tab_pattern") or None,
        "tab_match_mode": body.get("tab_match_mode") or "exact",
        "sheet_fingerprint": json.dumps(fingerprint) if fingerprint else None,
    })
    await db.commit()
    # segment_values lets the Setup form immediately offer sheet-driven
    # segment selection after the picker is saved.
    return {"success": True,
            "fingerprint_captured": fingerprint is not None,
            "segment_values": (fingerprint or {}).get("segment_values", [])}


@app.post("/api/column-mappings/preview")
async def preview_column_mapping(request: Request, db: AsyncSession = Depends(get_db)):
    """Read-only dry run of a mapping before it touches data.

    Resolves the tabs this config would ingest (rolling pattern or exact tab),
    detects each tab's month, and reports how much data is actually filled —
    classifying every tab as ready / awaiting_data / check_config. Writes
    nothing. Accepts the in-progress picker config directly, or falls back to
    the saved mapping when the body omits `mapping`.
    """
    import asyncio
    import etl_worker
    from sheets_client import _get_service

    body = await request.json()
    sheet_url = body.get("sheet_url", "")
    if not sheet_url:
        raise HTTPException(status_code=400, detail="sheet_url is required")
    map_type = body.get("type", "advertiser")
    is_publisher = map_type == "publisher"

    # Prefer the live picker config; fall back to whatever is saved for scope.
    if body.get("mapping") is not None or body.get("tab_pattern") or body.get("tab_name"):
        match_mode = body.get("tab_match_mode") or ("rolling" if body.get("tab_pattern") else "exact")
        col_mapping = {
            "tab_name": body.get("tab_name", ""),
            # tab_pattern only drives rolling/template; force-clear it in exact
            # mode so resolution matches ingest semantics exactly.
            "tab_pattern": (body.get("tab_pattern") or "") if match_mode != "exact" else "",
            "tab_match_mode": match_mode,
            "mapping": body.get("mapping", {}) or {},
            "format_type": body.get("format_type", "visual"),
        }
    else:
        saved = await etl_worker._load_column_mapping(
            db, body.get("name", "") or "", map_type,
            sheet_url=sheet_url, campaign_id=body.get("campaign_id") or None,
        )
        if not saved:
            raise HTTPException(status_code=404, detail="No saved mapping to preview")
        col_mapping = saved

    service = _get_service()
    report = await asyncio.to_thread(
        etl_worker.preview_mapping, service, sheet_url, col_mapping, is_publisher)
    return report


# ── Sheet Health ───────────────────────────────────────────────────────────────
# Scanning every configured sheet tab-by-tab costs ~1-2s per sheet against the
# Sheets API, so serve a cached report for 10 minutes unless ?refresh=1.
_SHEET_HEALTH_TTL_S = 600
_sheet_health_cache: Dict[str, Any] = {"at": None, "data": None}


@app.get("/api/sheet-health")
async def sheet_health(refresh: int = 0, db: AsyncSession = Depends(get_db)):
    """Freshness + drift report for every campaign sheet with a data URL.

    Per sheet side: how recent the last row with an actual metric VALUE is
    (prefilled date columns don't count), which tabs the saved mapping
    resolves today, and alerts when the sheet no longer matches the
    fingerprint captured at mapping-save time (renamed headers, missing tabs,
    changed segment values, configured segment absent).
    """
    import asyncio
    import etl_worker
    from sheets_client import _get_service

    now = datetime.now(dt_timezone.utc)
    cached = _sheet_health_cache["data"]
    if (not refresh and cached and _sheet_health_cache["at"]
            and (now - _sheet_health_cache["at"]).total_seconds() < _SHEET_HEALTH_TTL_S):
        return {**cached, "cached": True}

    rows = (await db.execute(text(
        "SELECT id, name, advertiser_name, publisher_name, advertiser_data_url, "
        "publisher_data_url, segment_adv, segment_pub, self_targeted_adv, "
        "self_targeted_pub, current_stage "
        "FROM rmn_campaigns WHERE is_deleted = FALSE AND "
        "(COALESCE(advertiser_data_url, '') <> '' OR COALESCE(publisher_data_url, '') <> '') "
        "ORDER BY id"
    ))).fetchall()

    service = _get_service()
    sheets: List[Dict[str, Any]] = []
    # The same sheet+mapping can back several campaigns (parent/child clones);
    # scan each (url, mapping-scope) once and reuse the result.
    scan_cache: Dict[tuple, Dict[str, Any]] = {}

    for r in rows:
        (cid, cname, adv_name, pub_name, adv_url, pub_url,
         seg_adv, seg_pub, st_adv, st_pub, stage) = r
        for side, url, seg, party, self_targeted in (
            ("advertiser", adv_url, seg_adv, adv_name, st_adv),
            ("publisher", pub_url, seg_pub, pub_name, st_pub),
        ):
            if not (url or "").strip():
                continue
            entry: Dict[str, Any] = {
                "campaign_id": cid, "campaign_name": cname, "side": side,
                "party": party, "sheet_url": url, "segment": seg or "",
                "self_targeted": bool(self_targeted), "stage": stage,
            }
            cm = await etl_worker._load_column_mapping(
                db, party or "", side, sheet_url=url, campaign_id=cid)
            if not cm:
                entry.update({
                    "freshness": "not_configured", "tabs_matched": [],
                    "latest_data_date": None, "days_behind": None,
                    "fingerprint_captured_at": None, "error": None,
                    "alerts": [{"type": "not_configured", "severity": "warning",
                                "message": "No column mapping saved for this sheet — "
                                           "it is not being ingested."}],
                })
                sheets.append(entry)
                continue
            cache_key = (url, cm.get("campaign_id"), side, seg or "", bool(self_targeted))
            health = scan_cache.get(cache_key)
            if health is None:
                health = await asyncio.to_thread(
                    etl_worker.check_sheet_health, service, url, cm,
                    cm.get("sheet_fingerprint"), seg or "", bool(self_targeted))
                # Mappings saved before fingerprints existed have no baseline.
                # If the sheet looks clean (no error-severity alerts), capture
                # one now so drift detection works from the next scan onward.
                if (cm.get("sheet_fingerprint") is None and cm.get("id") is not None
                        and not any(a.get("severity") == "error"
                                    for a in health.get("alerts", []))):
                    try:
                        fp = await asyncio.to_thread(
                            etl_worker.capture_sheet_fingerprint, service, url, cm)
                        if fp:
                            await db.execute(text(
                                "UPDATE rmn_column_mappings SET sheet_fingerprint = :fp "
                                "WHERE id = :id"
                            ), {"fp": json.dumps(fp), "id": cm["id"]})
                            await db.commit()
                            cm["sheet_fingerprint"] = fp
                            health["alerts"] = [a for a in health["alerts"]
                                                if a.get("type") != "no_baseline"]
                            health["fingerprint_captured_at"] = fp.get("captured_at")
                            health["baseline_auto_captured"] = True
                    except Exception as fp_err:
                        logger.warning(f"Baseline auto-capture failed for "
                                       f"{cid}/{side}: {fp_err}")
                scan_cache[cache_key] = health
            entry.update(health)
            sheets.append(entry)

    summary = {
        "total": len(sheets),
        "fresh": sum(1 for s in sheets if s.get("freshness") == "fresh"),
        "lagging": sum(1 for s in sheets if s.get("freshness") == "lagging"),
        "stale": sum(1 for s in sheets if s.get("freshness") == "stale"),
        "no_data": sum(1 for s in sheets if s.get("freshness") == "no_data"),
        "not_configured": sum(1 for s in sheets if s.get("freshness") == "not_configured"),
        "with_alerts": sum(1 for s in sheets
                           if any(a.get("severity") == "error" for a in s.get("alerts", []))),
    }
    data = {"generated_at": now.isoformat(), "summary": summary,
            "sheets": sheets, "cached": False}
    _sheet_health_cache["at"] = now
    _sheet_health_cache["data"] = data
    return data


# ── Data Source Toggle ─────────────────────────────────────────────────────────
@app.get("/api/data-source")
def get_data_source():
    return {"source": _active_source["value"]}


@app.post("/api/data-source")
async def set_data_source_endpoint(request: Request):
    body = await request.json()
    src = body.get("source", "sheet")
    if src in ("sheet", "postgres"):
        _active_source["value"] = src
    return {"source": _active_source["value"]}


# ── Filters ───────────────────────────────────────────────────────────────────
@app.get("/api/filters")
def get_filters(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
):
    data = load_data()
    filters = {}
    if advertiser:
        filters["advertiser"] = advertiser
    if publisher:
        filters["publisher"] = publisher
    return get_filter_options(data, filters)


@app.get("/api/filter-relationships")
def filter_relationships():
    data = load_data()
    return get_filter_relationships(data)


# ── Dashboard chunks ──────────────────────────────────────────────────────────
@app.get("/api/dashboard/aggregates")
def dashboard_aggregates(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    industry: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    brand: Optional[List[str]] = Query(None),
    offer: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
):
    filters = _build_filters(advertiser, publisher, industry, segment, brand, offer, dateFrom, dateTo)
    data = load_data()
    rows = apply_filters(data["rows"], filters)
    aggs = calculate_aggregates(rows, data["headers"])
    return {**aggs, "totalRows": len(rows), "cacheAge": data.get("cache_age", 0)}


@app.get("/api/dashboard/timeseries")
def dashboard_timeseries(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    industry: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    brand: Optional[List[str]] = Query(None),
    offer: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    groupBy: str = "day",
):
    filters = _build_filters(advertiser, publisher, industry, segment, brand, offer, dateFrom, dateTo)
    data = load_data()
    rows = apply_filters(data["rows"], filters)
    series = get_time_series(rows, data["headers"], group_by=groupBy)
    return {"timeSeries": series, "groupBy": groupBy}


@app.get("/api/dashboard/breakdowns")
def dashboard_breakdowns(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    industry: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    brand: Optional[List[str]] = Query(None),
    offer: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
):
    filters = _build_filters(advertiser, publisher, industry, segment, brand, offer, dateFrom, dateTo)
    data = load_data()
    rows = apply_filters(data["rows"], filters)
    return {"breakdowns": get_breakdowns(rows, data["headers"])}


@app.get("/api/dashboard/table")
def dashboard_table(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    industry: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    brand: Optional[List[str]] = Query(None),
    offer: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    offset: int = 0,
    limit: int = 100,
):
    filters = _build_filters(advertiser, publisher, industry, segment, brand, offer, dateFrom, dateTo)
    data = load_data()
    rows = apply_filters(data["rows"], filters)
    total = len(rows)
    table = prepare_table_data(rows, data["headers"], offset=offset, limit=limit)
    return {
        "tableData": table,
        "totalRows": total,
        "offset": offset,
        "limit": limit,
        "hasMore": (offset + limit) < total,
        "headers": data["headers"],
    }


# ── Performance ───────────────────────────────────────────────────────────────
@app.get("/api/advertiser-performance")
def advertiser_performance(
    advertisers: Optional[List[str]] = Query(None),
    publishers: Optional[List[str]] = Query(None),
    segments: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    viewMode: str = "weekly",
    compare: bool = False,
    comparePeriods: int = 1,
):
    data = load_data()
    filters = {
        "advertisers": advertisers or [],
        "publishers": publishers or [],
        "segments": segments or [],
        "dateFrom": dateFrom,
        "dateTo": dateTo,
        "compare": compare,
        "comparePeriods": comparePeriods,
    }
    metric_cfg = load_metric_config("advertiser")
    result = get_advertiser_performance(data["rows"], data["headers"], filters, view_mode=viewMode, goals=load_advertiser_goals(), custom_metrics=metric_cfg["custom"])
    result["cacheAge"] = data.get("cache_age", 0)
    # Column config rides along so the tab renders custom/hidden metrics in
    # the same round trip that produced the numbers.
    result["metric_config"] = metric_cfg
    return result


@app.get("/api/publisher-performance")
def publisher_performance(
    publishers: Optional[List[str]] = Query(None),
    segments: Optional[List[str]] = Query(None),
    advertisers: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    viewMode: str = "weekly",
    compare: bool = False,
    comparePeriods: int = 1,
):
    data = load_data()
    filters = {
        "publishers": publishers or [],
        "segments": segments or [],
        "advertisers": advertisers or [],
        "dateFrom": dateFrom,
        "dateTo": dateTo,
        "compare": compare,
        "comparePeriods": comparePeriods,
    }
    metric_cfg = load_metric_config("publisher")
    result = get_publisher_performance(data["rows"], data["headers"], filters, view_mode=viewMode, goals=load_advertiser_goals(), custom_metrics=metric_cfg["custom"])
    result["cacheAge"] = data.get("cache_age", 0)
    result["metric_config"] = metric_cfg
    return result


# ── Performance metric config endpoints ───────────────────────────────────────
@app.get("/api/performance/metric-config")
def get_metric_config(scope: str = "advertiser"):
    """Config for the manage-metrics UI: saved hidden/custom lists plus the
    data columns available as base-metric sources and the metric keys a
    derived formula may reference."""
    if scope not in VALID_METRIC_SCOPES:
        raise HTTPException(status_code=400, detail="scope must be 'advertiser' or 'publisher'")
    cfg = load_metric_config(scope)
    try:
        headers = load_data().get("headers", [])
    except Exception:
        headers = []
    available = [h for h in headers if h and h.lower() not in _METRIC_DIMENSION_HEADERS]
    formula_keys = sorted(FORMULA_BASE_NAMES | {
        m["key"] for m in cfg["custom"] if m.get("kind") != "derived"
    })
    return {"scope": scope, **cfg, "available_columns": available, "formula_keys": formula_keys}


class MetricConfigRequest(BaseModel):
    scope: str
    hidden: List[str] = []
    custom: List[Dict[str, Any]] = []


@app.post("/api/performance/metric-config")
async def save_metric_config(req: MetricConfigRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Save the metric config for a performance tab (ADMIN/OPS only).

    Custom metrics are validated here so a bad definition is rejected with a
    clear message: keys must not clash with built-ins, base metrics need a
    source column, derived metrics need a formula that parses against the
    known metric keys (see data_logic.validate_formula)."""
    import re as _re
    if req.scope not in VALID_METRIC_SCOPES:
        raise HTTPException(status_code=400, detail="scope must be 'advertiser' or 'publisher'")
    email = getattr(request.state, "user_email", None)
    if auth_enabled():
        user = await repo.get_user_role(db, (email or "").strip().lower())
        role = (user.role or "").upper() if user else ""
        if role not in ("CREATOR", "ADMIN", "OPS") and not is_admin(email):
            raise HTTPException(status_code=403, detail="Only CREATOR/ADMIN/OPS can change metric config")

    # "name" (the hierarchy column) can never be hidden; ratios/goal can.
    hidden = [str(k).strip().lower() for k in req.hidden if str(k).strip().lower() not in ("", "name")]

    # First pass: base metric keys (a derived formula may reference them).
    base_keys = set()
    for m in req.custom:
        if isinstance(m, dict) and m.get("kind") != "derived":
            k = str(m.get("key") or m.get("label") or "").strip().lower()
            if k:
                base_keys.add(_re.sub(r"[^a-z0-9_]+", "_", k).strip("_"))
    allowed_formula_names = FORMULA_BASE_NAMES | base_keys

    cleaned, seen = [], set()
    for m in req.custom:
        if not isinstance(m, dict):
            continue
        label = str(m.get("label") or "").strip()
        if not label:
            raise HTTPException(status_code=400, detail="Each custom metric needs a name")
        key = str(m.get("key") or "").strip().lower() or label.lower()
        key = _re.sub(r"[^a-z0-9_]+", "_", key).strip("_")
        if not key:
            raise HTTPException(status_code=400, detail=f"Could not derive a key for metric '{label}'")
        if key in BUILTIN_METRIC_KEYS:
            raise HTTPException(status_code=400, detail=f"'{label}' clashes with the built-in metric '{key}'")
        if key in seen:
            raise HTTPException(status_code=400, detail=f"Duplicate metric '{label}'")
        kind = "derived" if m.get("kind") == "derived" else "base"
        fmt = m.get("fmt") if m.get("fmt") in METRIC_FMTS else "number"
        entry = {"key": key, "label": label, "kind": kind, "fmt": fmt}
        if kind == "base":
            source = str(m.get("source") or "").strip()
            if not source:
                raise HTTPException(status_code=400, detail=f"Metric '{label}' needs a source data column")
            entry["source"] = source
        else:
            formula = str(m.get("formula") or "").strip()
            if not formula:
                raise HTTPException(status_code=400, detail=f"Derived metric '{label}' needs a calculation formula")
            err = validate_formula(formula, allowed_formula_names)
            if err:
                raise HTTPException(status_code=400, detail=f"Formula for '{label}': {err}")
            entry["formula"] = formula
        seen.add(key)
        cleaned.append(entry)

    cfg_json = json.dumps({"hidden": hidden, "custom": cleaned})
    row = (await db.execute(
        select(models.MetricConfig).where(models.MetricConfig.scope == req.scope)
    )).scalar_one_or_none()
    if row:
        row.config = cfg_json
        row.updated_by = email
        row.updated_at = datetime.now(dt_timezone.utc)
    else:
        db.add(models.MetricConfig(scope=req.scope, config=cfg_json, updated_by=email))
    await db.commit()
    _metric_cfg_cache.pop(req.scope, None)
    return {"success": True, "scope": req.scope, "hidden": hidden, "custom": cleaned}


# ── Data Freshness ────────────────────────────────────────────────────────────
@app.get("/api/data-freshness")
def data_freshness():
    cache_key = "data_freshness"
    cached = cache.get(cache_key)
    if cached:
        return cached

    data = load_data()
    result = compute_data_freshness(data["rows"], data["headers"])
    cache.set(cache_key, result, ttl=600)
    return result


# ── Monthly Spend ─────────────────────────────────────────────────────────────
@app.get("/api/monthly-spend")
def monthly_spend():
    cache_key = "monthly_spend"
    cached = cache.get(cache_key)
    if cached:
        return cached

    data = load_data()
    result = get_monthly_spend_analysis(data["rows"], data["headers"])
    cache.set(cache_key, result, ttl=600)
    return result


# ── Budget ────────────────────────────────────────────────────────────────────
@app.get("/api/budget")
def budget(
    month: Optional[str] = None,
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
):
    data = load_data()
    filters = {"month": month, "advertiser": advertiser or [], "publisher": publisher or []}
    return get_budget_data(data["rows"], data["headers"], filters=filters)


# ── Goals ─────────────────────────────────────────────────────────────────────
@app.get("/api/goals")
def get_goals():
    try:
        raw = read_kpi_sheet("Sheet1")  # Goals spreadsheet first sheet
    except Exception as e:
        logger.error(f"Error reading goals: {e}")
        return []
    if not raw or len(raw) < 2:
        return []
    headers = raw[0]
    rows = raw[1:]

    def fi(name):
        for i, h in enumerate(headers):
            if str(h).lower().strip() == name.lower():
                return i
        return -1

    adv_i = fi("advertiser")
    pub_i = fi("publisher")
    goals_i = next((i for i, h in enumerate(headers)
                    if "goals" in str(h).lower() and "campaign" in str(h).lower()), -1)

    parsed = []
    for row in rows:
        if goals_i < 0 or len(row) <= goals_i:
            continue
        goals_json = row[goals_i]
        if not goals_json:
            continue
        try:
            import json
            gdata = json.loads(str(goals_json))
            adv = row[adv_i] if adv_i >= 0 and len(row) > adv_i else ""
            pub = row[pub_i] if pub_i >= 0 and len(row) > pub_i else ""

            for goal_type, goal_metrics in (gdata.get("goals") or {}).items():
                if not isinstance(goal_metrics, dict):
                    continue
                for metric, val in goal_metrics.items():
                    parsed.append({
                        "advertiser": adv,
                        "publisher": pub,
                        "metric": metric,
                        "goalValue": val,
                        "type": goal_type,
                        "direction": _goal_direction(metric),
                    })
        except Exception:
            continue
    return parsed


def _goal_direction(metric_name: str) -> str:
    lower = metric_name.lower()
    if any(x in lower for x in ["cp", "cost", "cpa", "cpc", "cpm", "cpql", "cpqqg"]):
        return "lower"
    return "higher"


# ── Global KPIs ───────────────────────────────────────────────────────────────
GLOBAL_KPIS_SHEET = "Global_KPIs"
KPI_HEADERS = ["ID", "KPI_Name", "KPI_Data", "Created_By", "Created_Date",
               "Modified_By", "Modified_Date", "Is_Active"]


def _read_global_kpis_raw():
    try:
        return read_kpi_sheet(GLOBAL_KPIS_SHEET)
    except Exception:
        return []


@app.get("/api/kpis")
def get_kpis():
    import json as _json
    raw = _read_global_kpis_raw()
    if len(raw) <= 1:
        return []

    headers = raw[0]
    rows = raw[1:]
    id_i = headers.index("ID") if "ID" in headers else 0
    name_i = headers.index("KPI_Name") if "KPI_Name" in headers else 1
    data_i = headers.index("KPI_Data") if "KPI_Data" in headers else 2
    active_i = headers.index("Is_Active") if "Is_Active" in headers else 7

    result = []
    for row in rows:
        if len(row) <= active_i:
            continue
        if str(row[active_i]).upper() not in ("TRUE", "1", "YES"):
            continue
        try:
            kpi = _json.loads(str(row[data_i]))
            kpi["id"] = row[id_i]
            kpi["name"] = row[name_i]
            result.append(kpi)
        except Exception:
            continue
    return result


class KPIPayload(BaseModel):
    name: str
    advertiser: Optional[str] = None
    publisher: Optional[str] = None
    segment: Optional[str] = None
    formula: Optional[str] = None
    goalValue: Optional[float] = None
    goalDirection: Optional[str] = "higher"
    timePeriod: Optional[str] = "1week"


@app.post("/api/kpis")
def create_kpi(payload: KPIPayload):
    import json as _json, uuid as _uuid
    kpi_id = str(_uuid.uuid4())
    from datetime import datetime
    now = datetime.utcnow().isoformat()
    kpi_data = payload.dict()
    kpi_data["id"] = kpi_id

    row = [
        kpi_id,
        payload.name,
        _json.dumps(kpi_data),
        "dashboard-user",
        now,
        "dashboard-user",
        now,
        "TRUE",
    ]
    try:
        append_rows(KPI_SPREADSHEET_ID, GLOBAL_KPIS_SHEET, [row])
        return {"id": kpi_id, "message": "KPI created"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/kpis/{kpi_id}")
def delete_kpi(kpi_id: str):
    """Soft delete by setting Is_Active = FALSE."""
    raw = _read_global_kpis_raw()
    if len(raw) <= 1:
        raise HTTPException(status_code=404, detail="KPI not found")

    headers = raw[0]
    id_i = headers.index("ID") if "ID" in headers else 0
    active_i = headers.index("Is_Active") if "Is_Active" in headers else 7

    for row_num, row in enumerate(raw[1:], start=2):
        if len(row) > id_i and row[id_i] == kpi_id:
            try:
                cell = f"{GLOBAL_KPIS_SHEET}!{chr(65 + active_i)}{row_num}"
                update_range(KPI_SPREADSHEET_ID, cell, [["FALSE"]])
                return {"message": "KPI deleted"}
            except Exception as e:
                raise HTTPException(status_code=500, detail=str(e))

    raise HTTPException(status_code=404, detail="KPI not found")


# ── Chatbot ───────────────────────────────────────────────────────────────────
class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = []


@app.post("/api/chat")
def chat(req: ChatRequest):
    # Use Razorpay LiteLLM gateway (OpenAI-compatible endpoint)
    litellm_key = os.environ.get("LITELLM_API_KEY", "")
    base_url    = os.environ.get("ANTHROPIC_BASE_URL", "https://llm-gateway.razorpay.com")

    if not litellm_key:
        raise HTTPException(status_code=503, detail="Chatbot not configured (missing LITELLM_API_KEY)")

    # Build data context from live cache
    data = load_data()
    from data_logic import calculate_aggregates, compute_data_freshness, get_filter_options
    aggs = calculate_aggregates(data["rows"], data["headers"])
    freshness = compute_data_freshness(data["rows"], data["headers"])
    filter_opts = get_filter_options(data, {})

    adv_list = "\n".join(
        f"  - {a['advertiser']}: {a['status'].replace('_', ' ')} "
        f"(pub last: {a['pubLastDate']}, adv last: {a['advLastDate']})"
        for a in freshness["advertisers"]
    )

    system_prompt = f"""You are a helpful data assistant for the Razorpay Media Network Dashboard.
You answer questions about the live data powering this dashboard. Be concise and factual.

=== CURRENT DATA SNAPSHOT (as of {freshness['computedAt']}) ===

SUMMARY METRICS:
- Impressions + Distribution: {aggs['impressionsAndDistribution']:,}
- Clicks: {aggs['clicks']:,}
- Publisher Spends: ₹{aggs['spends']:,}
- Advertiser Spends: ₹{aggs['advertiserSpends']:,}
- CTR: {aggs['ctr']}% | CPM: ₹{aggs['cpm']} | CPC: ₹{aggs['cpc']}
- QL: {aggs['ql']:,} | QQG: {aggs['qqg']:,}
- Total advertisers: {aggs['advertiserCount']} | Publishers: {aggs['publisherCount']}

DATA FRESHNESS (reference date: {freshness.get('maxDataDate', 'unknown')}):
- Up to date: {freshness['upToDateCount']} advertisers
- Publisher data outdated: {freshness['publisherOutdatedCount']} advertisers
- Advertiser data outdated: {freshness['advertiserOutdatedCount']} advertisers
- Both outdated: {freshness['bothOutdatedCount']} advertisers

ADVERTISER-LEVEL FRESHNESS:
{adv_list}

PUBLISHERS in data: {', '.join(filter_opts.get('publishers', []))}
ADVERTISERS in data: {', '.join(filter_opts.get('advertisers', []))}

Answer questions about this data directly. If asked about a specific advertiser or publisher, look them up above.
If something is off (e.g. data not refreshed), explain clearly which entity and when it was last updated."""

    # Call via OpenAI-compatible endpoint on the LiteLLM gateway
    import urllib.request as _urllib_req
    import json as _json

    # Build OpenAI-format messages with system prompt prepended
    oai_messages = [{"role": "system", "content": system_prompt}]
    for m in (req.history or [])[-10:]:
        oai_messages.append(m)
    oai_messages.append({"role": "user", "content": req.message})

    payload = _json.dumps({
        "model": "gpt-5.4-mini",
        "max_tokens": 512,
        "messages": oai_messages,
    }).encode()

    gateway_url = base_url.rstrip("/") + "/v1/chat/completions"
    http_req = _urllib_req.Request(
        gateway_url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {litellm_key}",
        },
        method="POST",
    )

    try:
        import ssl
        ctx = ssl.create_default_context()
        resp = _urllib_req.urlopen(http_req, context=ctx, timeout=30)
        result = _json.loads(resp.read().decode())
        reply = result["choices"][0]["message"]["content"]
        return {"reply": reply}
    except Exception as e:
        try:
            err_body = e.read().decode()
            raise HTTPException(status_code=500, detail=err_body[:400])
        except AttributeError:
            raise HTTPException(status_code=500, detail=str(e))


# ── Campaign Onboarding (removed) ─────────────────────────────────────────────
# The legacy Google-Sheet-backed Campaign Onboarding flow (submit / send-email /
# campaigns / templates) and its /api/onboarding/* endpoints were removed along
# with the frontend tab. Superseded by the Postgres-backed Sales pipeline +
# Advertiser wizard below.


# ── Sales pipeline (Dashboard 1) — Postgres-backed ───────────────────────────
# Lead -> negotiation -> signed agreement. Closing a lead opens a campaign in
# Ops (see workflow_repo.close_lead). Persisted in the rmn_* Postgres tables.

class CreateLeadRequest(BaseModel):
    advertiser: str
    owner_email: str
    source: str = ""
    est_value: Optional[int] = None
    currency: str = "INR"


class UpdateLeadRequest(BaseModel):
    negotiation_status: Optional[str] = None
    est_value: Optional[int] = None
    owner_email: Optional[str] = None


class CloseLeadRequest(BaseModel):
    buy_type: str
    contract_value: int
    currency: str = "INR"
    signed_doc_url: str = ""


@app.get("/api/sales/leads")
async def list_leads(status: Optional[str] = Query(None), db: AsyncSession = Depends(get_db)):
    leads = await repo.list_leads(db, status)
    out = [repo.lead_dict(l) for l in leads]
    return {"leads": out, "total": len(out)}


@app.post("/api/sales/leads")
async def create_lead(req: CreateLeadRequest, db: AsyncSession = Depends(get_db)):
    if not req.advertiser or not req.owner_email:
        raise HTTPException(status_code=400, detail="advertiser and owner_email are required")
    lead = await repo.create_lead(
        db, advertiser=req.advertiser, owner_email=req.owner_email,
        source=req.source, est_value=req.est_value, currency=req.currency,
    )
    return {"success": True, "lead": repo.lead_dict(lead)}


@app.patch("/api/sales/leads/{lead_id}")
async def update_lead(lead_id: str, req: UpdateLeadRequest, db: AsyncSession = Depends(get_db)):
    lead = await repo.get_lead(db, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail=f"lead {lead_id} not found")
    if req.negotiation_status is not None and req.negotiation_status.upper() not in wf.NEGOTIATION_STATUSES:
        raise HTTPException(status_code=400, detail=f"invalid negotiation_status {req.negotiation_status!r}")
    lead = await repo.update_lead(
        db, lead, negotiation_status=req.negotiation_status,
        est_value=req.est_value, owner_email=req.owner_email,
    )
    return {"success": True, "lead": repo.lead_dict(lead)}


@app.post("/api/sales/leads/{lead_id}/close")
async def close_lead(lead_id: str, req: CloseLeadRequest, db: AsyncSession = Depends(get_db)):
    """Mark a lead WON, create a SIGNED agreement, and open a campaign in Ops."""
    if req.buy_type.upper() not in wf.BUY_TYPES:
        raise HTTPException(status_code=400, detail=f"invalid buy_type {req.buy_type!r}")
    if req.contract_value <= 0:
        raise HTTPException(status_code=400, detail="contract_value must be positive")
    lead = await repo.get_lead(db, lead_id)
    if not lead:
        raise HTTPException(status_code=404, detail=f"lead {lead_id} not found")
    if lead.negotiation_status == "WON":
        raise HTTPException(status_code=400, detail=f"lead {lead_id} already closed")
    result = await repo.close_lead(
        db, lead, buy_type=req.buy_type, contract_value=req.contract_value,
        currency=req.currency, signed_doc_url=req.signed_doc_url,
    )
    return {"success": True, **result}


# ── Admin: read-only query console ────────────────────────────────────────────
# A SELECT-only SQL console, CREATOR-role only (ADMINs manage everything else
# but don't get raw DB access). Enforced read-only at the DB level (READ ONLY
# transaction) + single-statement SELECT/WITH guard, capped rows and a
# statement timeout.

async def _console_allowed(request: Request, db: AsyncSession) -> bool:
    """Query console is restricted to the CREATOR role."""
    if not auth_enabled():
        return True
    email = (getattr(request.state, "user_email", None) or "").strip().lower()
    if not email:
        return False
    user = await repo.get_user_role(db, email)
    return bool(user and (user.role or "").upper() == "CREATOR")


async def _require_console(request: Request, db: AsyncSession) -> None:
    if not await _console_allowed(request, db):
        raise HTTPException(status_code=403, detail="Query console requires the CREATOR role")


def _cell(v):
    import datetime
    import decimal
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    return str(v)


class QueryRequest(BaseModel):
    sql: str


@app.get("/api/admin/console-access")
async def console_access(request: Request, db: AsyncSession = Depends(get_db)):
    # Key name kept as "is_admin" for frontend compat; means "can use console".
    return {"is_admin": await _console_allowed(request, db)}


@app.get("/api/admin/tables")
async def admin_tables(request: Request, db: AsyncSession = Depends(get_db)):
    await _require_console(request, db)
    async with engine.connect() as conn:
        res = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' ORDER BY table_name"
        ))
        return {"tables": [r[0] for r in res.fetchall()]}


@app.post("/api/admin/query")
async def admin_query(req: QueryRequest, request: Request, db: AsyncSession = Depends(get_db)):
    await _require_console(request, db)
    import re
    sql = (req.sql or "").strip().rstrip(";").strip()
    if not sql:
        raise HTTPException(status_code=400, detail="Empty query")
    # DESCRIBE <table> / DESC <table> / \d <table>  ->  information_schema lookup
    m = re.match(r"^(?:describe|desc|\\d)\s+(\w+)$", sql, re.IGNORECASE)
    if m:
        tbl = m.group(1)
        sql = (
            "SELECT column_name, data_type, character_maximum_length AS max_length, "
            "is_nullable, column_default FROM information_schema.columns "
            f"WHERE table_schema='public' AND table_name='{tbl}' ORDER BY ordinal_position"
        )
    if ";" in sql:
        raise HTTPException(status_code=400, detail="Only a single statement is allowed")
    low = sql.lower()
    if not (low.startswith("select") or low.startswith("with")):
        raise HTTPException(status_code=400, detail="Only SELECT / WITH queries are allowed")
    try:
        async with engine.connect() as conn:
            trans = await conn.begin()
            await conn.execute(text("SET TRANSACTION READ ONLY"))
            await conn.execute(text("SET LOCAL statement_timeout = '10000'"))
            result = await conn.execute(text(sql))
            cols = list(result.keys())
            rows = result.fetchmany(1000)
            await trans.rollback()
        data = [[_cell(v) for v in row] for row in rows]
        return {"columns": cols, "rows": data, "row_count": len(data), "truncated": len(data) >= 1000}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Query error: {e}")


# ── Advertisers (6-step onboarding wizard) — Postgres-backed ─────────────────
# Drafts autosave as the user moves through the wizard; id is ADV-<3 letters>-NNNN.

def _today_ist():
    from datetime import datetime as _dt, timedelta as _td, timezone as _tz
    return _dt.now(_tz(_td(hours=5, minutes=30))).date()


def _normalize_billing_model(side: str, model: str) -> str:
    side = (side or "").strip().lower()
    model = (model or "").strip().lower()
    allowed_models = {"publisher": {"cpc", "cpm", "roas"}, "advertiser": {"roas", "cpc"}}
    if side not in allowed_models:
        raise HTTPException(status_code=400, detail="side must be publisher or advertiser")
    if model not in allowed_models[side]:
        allowed = ", ".join(sorted(allowed_models[side])).upper()
        raise HTTPException(status_code=400, detail=f"{side} billing supports only {allowed}")
    return model


def _safe_billing_rate(value) -> float:
    try:
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return 0.0


def _billing_summary(side: str, model: str, rate: float, start_date, source: str = None) -> str:
    label = {"roas": "ROAS", "cpc": "CPC", "cpm": "CPM"}.get(model, model.upper())
    parts = [f"{side}:{label}", f"rate={rate:g}", f"start={start_date.isoformat()}"]
    if source:
        parts.append(f"source={source}")
    return " | ".join(parts)


def _advertiser_default_terms(adv: models.Advertiser) -> tuple:
    model = (adv.buy_type or "").strip().lower().replace("_commit", "")
    if model == "roas":
        return "roas", _safe_billing_rate(adv.roas_multiplier)
    if model == "cpc":
        return "cpc", _safe_billing_rate(adv.cpc_rate)
    return "", 0.0


def _publisher_default_terms(campaign: models.Campaign) -> tuple:
    model = (campaign.publisher_billing_model or "").strip().lower()
    rate = _safe_billing_rate(campaign.publisher_billing_rate)
    if not model and campaign.cpc_cpd:
        model = "cpc"
        rate = _safe_billing_rate(campaign.cpc_cpd)
    if model not in {"cpc", "cpm", "roas"}:
        return "", 0.0
    return model, rate


def _billing_terms_changed(old_terms: tuple, new_terms: tuple) -> bool:
    old_model, old_rate = old_terms
    new_model, new_rate = new_terms
    return old_model != new_model or abs(float(old_rate or 0) - float(new_rate or 0)) > 0.000001


def _active_config_for_date(configs, start_date):
    for cfg in configs:
        if cfg.start_date <= start_date and (cfg.end_date is None or cfg.end_date >= start_date):
            return cfg
    return None


async def _upsert_billing_config(
    db: AsyncSession,
    campaign: models.Campaign,
    *,
    side: str,
    billing_model: str,
    rate: float,
    start_date,
    changed_by: str = None,
    source: str = "billing_tab",
    recompute: bool = True,
    old_summary_override: str = None,
) -> int:
    side = (side or "").strip().lower()
    billing_model = _normalize_billing_model(side, billing_model)
    rate = _safe_billing_rate(rate)
    if rate <= 0:
        raise HTTPException(status_code=400, detail="rate must be greater than 0")

    result = await db.execute(
        select(models.BillingConfig)
        .where(models.BillingConfig.campaign_id == campaign.id)
        .where(models.BillingConfig.side == side)
        .order_by(models.BillingConfig.start_date.asc(), models.BillingConfig.id.asc())
    )
    configs = result.scalars().all()
    old_config = _active_config_for_date(configs, start_date)
    old_summary = old_summary_override or (
        _billing_summary(side, old_config.billing_model, old_config.rate, old_config.start_date)
        if old_config else None
    )

    same_start = [cfg for cfg in configs if cfg.start_date == start_date]
    if same_start:
        new_config = same_start[0]
        new_config.billing_model = billing_model
        new_config.rate = rate
        new_config.created_by = changed_by
        for duplicate in same_start[1:]:
            await db.delete(duplicate)
        configs = [cfg for cfg in configs if cfg not in same_start[1:]]
    else:
        new_config = models.BillingConfig(
            campaign_id=campaign.id,
            side=side,
            billing_model=billing_model,
            rate=rate,
            start_date=start_date,
            created_by=changed_by,
        )
        db.add(new_config)
        configs.append(new_config)
        await db.flush()

    configs.sort(key=lambda cfg: (cfg.start_date, cfg.id or 0))
    for idx, cfg in enumerate(configs):
        next_cfg = configs[idx + 1] if idx + 1 < len(configs) else None
        cfg.end_date = (next_cfg.start_date - timedelta(days=1)) if next_cfg else None

    new_summary = _billing_summary(side, billing_model, rate, start_date, source)
    if old_summary != new_summary:
        db.add(models.CampaignChangelog(
            campaign_id=campaign.id,
            field_name=f"billing.{side}",
            old_value=old_summary,
            new_value=new_summary,
            changed_by=changed_by,
            source=source,
        ))

    await db.commit()
    if recompute:
        recompute_result = await recompute_campaign_metrics(campaign.id, db)
        return int(recompute_result.get("recomputed", 0))
    return 0


async def _validate_billing_metrics_if_configured(campaign: models.Campaign, side: str, billing_model: str):
    try:
        metrics_config = json.loads(campaign.metrics_json or "{}")
    except Exception:
        metrics_config = {}
    publisher_metrics = {str(m).strip().lower() for m in metrics_config.get("publisher_metrics", [])}
    advertiser_metrics = {str(m).strip().lower() for m in metrics_config.get("advertiser_metrics", [])}
    if not publisher_metrics and not advertiser_metrics:
        return
    if side == "publisher" and billing_model == "cpc" and "clicks" not in publisher_metrics:
        raise HTTPException(status_code=400, detail="Publisher CPC requires Clicks in publisher metrics")
    if side == "publisher" and billing_model == "cpm" and "impressions" not in publisher_metrics:
        raise HTTPException(status_code=400, detail="Publisher CPM requires Impressions in publisher metrics")
    if side == "publisher" and billing_model == "roas" and "revenue" not in advertiser_metrics:
        raise HTTPException(status_code=400, detail="Publisher ROAS requires Revenue in advertiser metrics")
    if side == "advertiser" and billing_model == "roas" and "revenue" not in advertiser_metrics:
        raise HTTPException(status_code=400, detail="Advertiser ROAS requires Revenue in advertiser metrics")
    if side == "advertiser" and billing_model == "cpc" and "clicks" not in publisher_metrics:
        raise HTTPException(status_code=400, detail="Advertiser CPC requires Clicks in publisher metrics")


async def _get_campaign_advertiser(db: AsyncSession, campaign: models.Campaign) -> Optional[models.Advertiser]:
    if not campaign.advertiser_ref_id:
        return None
    return await repo.get_advertiser(db, campaign.advertiser_ref_id)


async def _validate_go_live_billing_defaults(db: AsyncSession, campaign: models.Campaign):
    adv = await _get_campaign_advertiser(db, campaign)
    adv_model, adv_rate = _advertiser_default_terms(adv) if adv else ("", 0.0)
    if adv_model not in {"roas", "cpc"} or adv_rate <= 0:
        raise HTTPException(status_code=400, detail="Advertiser billing default is missing ROAS/CPC rate")
    pub_model, pub_rate = _publisher_default_terms(campaign)
    if pub_model not in {"cpc", "cpm", "roas"} or pub_rate <= 0:
        raise HTTPException(status_code=400, detail="Publisher billing default is missing CPC/CPM/ROAS rate")


async def _seed_go_live_billing_defaults(db: AsyncSession, campaign: models.Campaign, changed_by: str = None) -> int:
    start_date = _today_ist()
    updated = 0
    adv = await _get_campaign_advertiser(db, campaign)
    adv_model, adv_rate = _advertiser_default_terms(adv) if adv else ("", 0.0)
    if adv_model and adv_rate > 0:
        updated += await _upsert_billing_config(
            db, campaign, side="advertiser", billing_model=adv_model, rate=adv_rate,
            start_date=start_date, changed_by=changed_by, source="go_live_advertiser_default",
            recompute=False,
        )
    pub_model, pub_rate = _publisher_default_terms(campaign)
    if pub_model and pub_rate > 0:
        updated += await _upsert_billing_config(
            db, campaign, side="publisher", billing_model=pub_model, rate=pub_rate,
            start_date=start_date, changed_by=changed_by, source="go_live_publisher_default",
            recompute=False,
        )
    recompute_result = await recompute_campaign_metrics(campaign.id, db)
    return updated + int(recompute_result.get("recomputed", 0))


async def _sync_advertiser_defaults_to_live_campaigns(
    db: AsyncSession,
    adv: models.Advertiser,
    changed_by: str = None,
) -> int:
    model, rate = _advertiser_default_terms(adv)
    if model not in {"roas", "cpc"} or rate <= 0:
        return 0
    rows = (await db.execute(
        select(models.Campaign)
        .where(models.Campaign.advertiser_ref_id == adv.id)
        .where(models.Campaign.current_stage == wf.STAGE_LIVE)
        .where(models.Campaign.is_deleted.is_(False))
    )).scalars().all()
    updated = 0
    for campaign in rows:
        await _upsert_billing_config(
            db, campaign, side="advertiser", billing_model=model, rate=rate,
            start_date=_today_ist(), changed_by=changed_by,
            source="advertiser_default_change", recompute=True,
        )
        updated += 1
    return updated


@app.get("/api/advertisers")
async def list_advertisers(db: AsyncSession = Depends(get_db)):
    advs = await repo.list_advertisers(db)
    return {"advertisers": [repo.advertiser_dict(a) for a in advs], "total": len(advs)}


@app.get("/api/advertisers/{adv_id}")
async def get_advertiser(adv_id: str, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    return {"advertiser": repo.advertiser_dict(adv)}


@app.post("/api/advertisers")
async def create_advertiser(request: Request, payload: dict, db: AsyncSession = Depends(get_db)):
    if not (payload.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="advertiser name is required to mint an ID")
    if not payload.get("owner_email"):
        payload["owner_email"] = getattr(request.state, "user_email", None)
    try:
        adv = await repo.create_advertiser(db, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "advertiser": repo.advertiser_dict(adv)}


_BUDGET_FIELDS = {"budget_hint", "budget_type", "budget_months"}


async def _enforce_budget_rules(db: AsyncSession, adv, payload: dict, request: Request):
    """Budget governance for onboarded advertisers: only the owner (or an
    admin) may change budget settings, and MONTHLY budgets lock the current
    month once its value is set — past months are read-only, future months
    stay editable. Admins bypass the month lock as an escape hatch.

    Returns an actor-context dict {email, is_owner, is_admin} when budget
    fields on an onboarded advertiser are touched (used for changelog
    attribution), else None."""
    if not (_BUDGET_FIELDS & set(payload.keys())) or adv.status != "ONBOARDED":
        return None
    email = (getattr(request.state, "user_email", None) or payload.get("changed_by") or "").strip().lower()
    is_owner = bool(email and adv.owner_email and email == adv.owner_email.strip().lower())
    is_admin = False
    if email:
        user = await repo.get_user_role(db, email)
        is_admin = bool(user and (user.role or "").upper() in ("CREATOR", "ADMIN"))
    if email and not (is_owner or is_admin):
        raise HTTPException(status_code=403, detail="Only the advertiser owner or an admin can change budget settings")
    ctx = {"email": email or None, "is_owner": is_owner, "is_admin": is_admin}
    if is_admin:
        # Admins bypass the month locks even when they also own the
        # advertiser — otherwise an admin-owner would have no escape hatch.
        return ctx

    cur = repo.datetime.now(repo.timezone.utc).strftime("%Y-%m")
    old_type = (adv.budget_type or "AGNOSTIC").upper()
    old_months = repo.parse_budget_months(adv)
    new_type = str(payload.get("budget_type") or old_type).strip().upper()
    if old_type == "MONTHLY" and new_type != "MONTHLY" and str(old_months.get(cur, "")).strip():
        raise HTTPException(status_code=400, detail=f"Budget for {cur} is locked — the budget type can't be changed mid-month (ask an admin)")
    if "budget_months" in payload:
        raw = payload.get("budget_months") or {}
        new_months = {str(k).strip(): str(v).strip() for k, v in raw.items()} if isinstance(raw, dict) else {}
        for m in set(old_months) | set(new_months):
            old_v = str(old_months.get(m, "")).strip()
            new_v = str(new_months.get(m, "")).strip()
            if old_v == new_v:
                continue
            if m < cur:
                raise HTTPException(status_code=400, detail=f"Budget for {m} is in the past and can't be changed")
            if m == cur and old_v:
                raise HTTPException(status_code=400, detail=f"Budget for {m} is locked for the current month — it unlocks next month")
    return ctx


async def _log_budget_changes(db: AsyncSession, adv, old_budget: tuple, ctx: dict) -> None:
    """Write one rmn_advertiser_changelog row per budget value that actually
    changed. Monthly budgets log each month as its own field
    ("budget_months.YYYY-MM"). Changes that bypassed a month lock (only
    admins get past enforcement with those) are tagged source=admin_override;
    otherwise source is owner/admin by actor role."""
    old_hint, old_type, old_months = old_budget
    new_hint = adv.budget_hint
    new_type = (adv.budget_type or "AGNOSTIC").upper()
    new_months = repo.parse_budget_months(adv)
    cur = repo.datetime.now(repo.timezone.utc).strftime("%Y-%m")

    rows = []  # (field_name, old, new, bypassed_lock)
    if str(old_hint or "").strip() != str(new_hint or "").strip():
        rows.append(("budget_hint", old_hint, new_hint, False))
    if old_type != new_type:
        locked = old_type == "MONTHLY" and str(old_months.get(cur, "")).strip() != ""
        rows.append(("budget_type", old_type, new_type, locked))
    for m in sorted(set(old_months) | set(new_months)):
        old_v = str(old_months.get(m, "")).strip()
        new_v = str(new_months.get(m, "")).strip()
        if old_v == new_v:
            continue
        bypassed = m < cur or (m == cur and bool(old_v))
        rows.append((f"budget_months.{m}", old_v or None, new_v or None, bypassed))
    if not rows:
        return

    role_source = "owner" if ctx["is_owner"] else ("admin" if ctx["is_admin"] else None)
    for field, old_v, new_v, bypassed in rows:
        db.add(models.AdvertiserChangelog(
            advertiser_id=adv.id,
            field_name=field,
            old_value=None if old_v is None else str(old_v),
            new_value=None if new_v is None else str(new_v),
            changed_by=ctx["email"],
            source="admin_override" if bypassed else role_source,
        ))
    await db.commit()


@app.patch("/api/advertisers/{adv_id}")
async def update_advertiser(adv_id: str, payload: dict, request: Request, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    budget_ctx = await _enforce_budget_rules(db, adv, payload, request)
    old_budget = (adv.budget_hint, (adv.budget_type or "AGNOSTIC").upper(), repo.parse_budget_months(adv)) if budget_ctx else None
    old_terms = _advertiser_default_terms(adv)
    try:
        adv = await repo.update_advertiser(db, adv, payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if budget_ctx:
        await _log_budget_changes(db, adv, old_budget, budget_ctx)
    billing_updated = 0
    if _billing_terms_changed(old_terms, _advertiser_default_terms(adv)):
        changed_by = getattr(request.state, "user_email", None) or payload.get("changed_by")
        billing_updated = await _sync_advertiser_defaults_to_live_campaigns(db, adv, changed_by=changed_by)
    return {"success": True, "advertiser": repo.advertiser_dict(adv), "billing_updated": billing_updated}


@app.post("/api/advertisers/{adv_id}/submit")
async def submit_advertiser(adv_id: str, request: Request, payload: dict = None, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    old_terms = _advertiser_default_terms(adv)
    merged = dict(payload or {})
    merged["status"] = "ONBOARDED"
    try:
        adv = await repo.update_advertiser(db, adv, merged)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    billing_updated = 0
    if _billing_terms_changed(old_terms, _advertiser_default_terms(adv)):
        changed_by = getattr(request.state, "user_email", None) or merged.get("changed_by")
        billing_updated = await _sync_advertiser_defaults_to_live_campaigns(db, adv, changed_by=changed_by)
    return {"success": True, "advertiser": repo.advertiser_dict(adv), "billing_updated": billing_updated}


@app.get("/api/workflow/available-combos")
async def available_combos(db: AsyncSession = Depends(get_db)):
    """Get advertiser+publisher combos that have budget allocated."""
    result = await db.execute(
        text("""
            SELECT DISTINCT a.advertiser_id, adv.name, a.publisher_id, p.name
            FROM rmn_budget_allocations a
            JOIN rmn_advertisers adv ON adv.id = a.advertiser_id
            JOIN rmn_publishers p ON p.id = a.publisher_id
            WHERE a.amount > 0
            ORDER BY adv.name, p.name
        """)
    )
    rows = result.fetchall()
    return {"combos": [
        {"advertiser_id": r[0], "advertiser_name": r[1], "publisher_id": r[2], "publisher_name": r[3]}
        for r in rows
    ]}


class CreateCampaignRequest(BaseModel):
    advertiser_id: str
    publisher_id: Optional[str] = None
    offer_title: Optional[str] = None


@app.post("/api/workflow/campaigns")
async def create_campaign(req: CreateCampaignRequest, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, req.advertiser_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {req.advertiser_id} not found")
    pub_name = None
    if req.publisher_id:
        pubs = await repo.list_publishers(db)
        pub = next((p for p in pubs if p["id"] == req.publisher_id), None)
        if not pub:
            raise HTTPException(status_code=404, detail=f"publisher {req.publisher_id} not found")
        pub_name = pub["name"]
    campaign = await repo.create_new_campaign(db, adv, publisher_id=req.publisher_id, publisher_name=pub_name, offer_title=req.offer_title)
    return {"success": True, "campaign": repo.campaign_dict(campaign)}


class CloneCampaignRequest(BaseModel):
    # Optional field overrides for the clone (e.g. new offer_title / targeting).
    # Keys not in workflow_repo.CLONEABLE_FIELDS are rejected with a 400.
    overrides: Dict[str, Any] = {}


@app.post("/api/workflow/campaigns/{campaign_id}/clone")
async def clone_campaign(campaign_id: str, req: Optional[CloneCampaignRequest] = None,
                         request: Request = None, db: AsyncSession = Depends(get_db)):
    source = await repo.get_campaign(db, campaign_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    overrides = (req.overrides if req else {}) or {}
    bad = [k for k in overrides if k not in repo.CLONEABLE_FIELDS]
    if bad:
        raise HTTPException(status_code=400, detail=f"cannot override field(s): {', '.join(bad)}")
    changed_by = getattr(request.state, "user_email", None) if request else None
    new_camp = await repo.clone_campaign(db, source, overrides=overrides, changed_by=changed_by)
    return {"success": True, "campaign": repo.campaign_dict(new_camp), "source_id": campaign_id}


class WelcomeEmailRequest(BaseModel):
    to: str = ""
    subject: str = ""
    body: str = ""


@app.post("/api/advertisers/{adv_id}/welcome-email")
async def record_welcome_email(adv_id: str, req: WelcomeEmailRequest, db: AsyncSession = Depends(get_db)):
    """Record that the welcome email was sent (the send itself happens client-side)."""
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    adv = await repo.record_welcome_email(db, adv, to=req.to, subject=req.subject, body=req.body)
    return {"success": True, "advertiser": repo.advertiser_dict(adv)}


# ── User Roles ────────────────────────────────────────────────────────────────

@app.get("/api/auth/me")
async def auth_me(request: Request, db: AsyncSession = Depends(get_db)):
    """Returns the current user's role based on their signed-in email."""
    email = getattr(request.state, "user_email", None)
    if not email:
        return {"email": None, "role": "VIEWER", "name": None}
    user = await repo.get_user_role(db, email)
    if user:
        return {"email": email, "role": user.role, "name": user.name}
    return {"email": email, "role": "VIEWER", "name": None}


async def _require_role_admin(request: Request, db: AsyncSession) -> None:
    """Gate for role management: CREATOR/ADMIN DB roles, or env ADMIN_EMAILS
    (bootstrap fallback so access can be granted before any DB rows exist).

    The User Roles tab is already hidden from non-admins in the UI, but these
    endpoints must enforce it server-side too — otherwise any signed-in user
    could POST themselves an ADMIN role."""
    if not auth_enabled():
        return
    email = (getattr(request.state, "user_email", None) or "").strip().lower()
    if is_admin(email):
        return
    user = await repo.get_user_role(db, email)
    if user and (user.role or "").upper() in ("CREATOR", "ADMIN"):
        return
    raise HTTPException(status_code=403, detail="Admin access required")


@app.get("/api/roles")
async def list_roles(request: Request, db: AsyncSession = Depends(get_db)):
    await _require_role_admin(request, db)
    roles = await repo.list_user_roles(db)
    return {"roles": roles}


class SetRoleRequest(BaseModel):
    email: str
    role: str
    name: Optional[str] = None


@app.post("/api/roles")
async def set_role(req: SetRoleRequest, request: Request, db: AsyncSession = Depends(get_db)):
    await _require_role_admin(request, db)
    if req.role not in repo.VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(repo.VALID_ROLES)}")
    result = await repo.set_user_role(db, email=req.email, role=req.role, name=req.name)
    return {"success": True, "user": result}


@app.delete("/api/roles/{email}")
async def delete_role(email: str, request: Request, db: AsyncSession = Depends(get_db)):
    await _require_role_admin(request, db)
    await repo.delete_user_role(db, email)
    return {"success": True}


# ── Publishers & Budget Allocation ────────────────────────────────────────────

@app.get("/api/publishers")
async def list_publishers(db: AsyncSession = Depends(get_db)):
    pubs = await repo.list_publishers(db)
    return {"publishers": pubs}


class CreatePublisherRequest(BaseModel):
    name: str
    code: Optional[str] = None


@app.post("/api/publishers")
async def create_publisher(req: CreatePublisherRequest, db: AsyncSession = Depends(get_db)):
    try:
        pub = await repo.create_publisher(db, name=req.name, code=req.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "publisher": pub}


@app.get("/api/advertisers/{adv_id}/allocations")
async def get_allocations(adv_id: str, month: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    allocs = await repo.get_allocations(db, adv_id, month=month)
    return {"allocations": allocs}


@app.get("/api/allocations")
async def get_all_allocations(month: str, db: AsyncSession = Depends(get_db)):
    allocs = await repo.get_all_allocations_for_month(db, month)
    return {"allocations": allocs}


@app.get("/api/allocations/summary")
async def allocations_monthly_summary(db: AsyncSession = Depends(get_db)):
    """Total allocated per month across all advertisers. Budget Allocation uses
    this for carry-forward: unallocated budget from prior months rolls into the
    selected month's available budget."""
    result = await db.execute(text(
        "SELECT month, COALESCE(SUM(amount), 0) FROM rmn_budget_allocations "
        "WHERE status IS DISTINCT FROM 'CANT_GO_LIVE' "
        "GROUP BY month ORDER BY month"
    ))
    return {"summary": [{"month": r[0], "allocated": int(r[1])} for r in result.fetchall()]}


class AllocationItem(BaseModel):
    publisher_id: str
    amount: Optional[int] = None
    status: Optional[str] = None
    notes: Optional[str] = None


class SaveAllocationsRequest(BaseModel):
    month: str
    allocations: list[AllocationItem]


@app.post("/api/advertisers/{adv_id}/allocations")
async def save_allocations(adv_id: str, req: SaveAllocationsRequest, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    await repo.upsert_allocations(db, adv_id, req.month, [a.model_dump() for a in req.allocations])
    allocs = await repo.get_allocations(db, adv_id, month=req.month)
    return {"success": True, "allocations": allocs}


# ── Campaign Ops stage machine (Dashboard 2) — Postgres-backed ───────────────
# Campaigns opened from a closed lead progress through validated stages with
# hand-off emails. ops-tasks gate the go-live transition.

class UpdateOpsTaskRequest(BaseModel):
    status: Optional[str] = None
    owner_email: Optional[str] = None


class TransitionRequest(BaseModel):
    to_stage: str
    actor_email: str = ""
    notify_recipients: Optional[List[str]] = None


@app.get("/api/workflow/stages")
def workflow_stages():
    return {
        "stages": wf.OPS_STAGES,
        "labels": wf.STAGE_LABELS,
        "transitions": {s: wf.allowed_transitions(s) for s in wf.OPS_STAGES},
        "handoff_on": wf.HANDOFF_ON,
    }


@app.get("/api/workflow/campaigns")
async def workflow_campaigns(db: AsyncSession = Depends(get_db)):
    camps = await repo.list_campaigns(db)
    return {"campaigns": [repo.campaign_dict(c) for c in camps], "total": len(camps)}


@app.post("/api/workflow/backfill-campaigns")
async def workflow_backfill_campaigns(db: AsyncSession = Depends(get_db)):
    """One-time: open Ops campaigns for advertisers that were ONBOARDED before
    the Sales→Ops linkage existed."""
    opened = await repo.backfill_campaigns_for_onboarded(db)
    return {"opened": [repo.campaign_dict(c) for c in opened], "count": len(opened)}


@app.get("/api/workflow/campaigns/{campaign_id}/ops-tasks")
async def workflow_ops_tasks(campaign_id: str, db: AsyncSession = Depends(get_db)):
    tasks = await repo.list_ops_tasks(db, campaign_id)
    return {"ops_tasks": [repo.ops_task_dict(t) for t in tasks]}


@app.post("/api/workflow/campaigns/{campaign_id}/upload-asset")
async def workflow_upload_asset(campaign_id: str, file: UploadFile = File(...), field: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Upload a creative or logo image to Google Drive and save the URL on the campaign."""
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    if field not in ("creative_url", "logo_url"):
        raise HTTPException(status_code=400, detail="field must be creative_url or logo_url")
    if file.content_type not in ("image/jpeg", "image/png"):
        raise HTTPException(status_code=400, detail="Only JPG/PNG files are allowed")

    content = await file.read()
    from sheets_client import upload_campaign_asset
    result = upload_campaign_asset(content, file.filename, file.content_type)

    setattr(campaign, field, result["url"])
    campaign.updated_at = repo.datetime.now(repo.timezone.utc)
    await db.commit()
    await db.refresh(campaign)
    return {"success": True, "url": result["url"], "drive_id": result["id"], "campaign": repo.campaign_dict(campaign)}


@app.patch("/api/workflow/campaigns/{campaign_id}/assets")
async def workflow_update_assets(campaign_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    payload = await request.json()
    user_email = getattr(request.state, "user_email", None) or payload.pop("changed_by", None)
    campaign, changes = await repo.update_campaign_assets(db, campaign, payload, changed_by=user_email)
    return {"success": True, "campaign": repo.campaign_dict(campaign), "changes": changes}


@app.get("/api/workflow/campaigns/{campaign_id}/changelog")
async def workflow_get_changelog(campaign_id: str, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select
    rows = (await db.execute(
        select(models.CampaignChangelog)
        .where(models.CampaignChangelog.campaign_id == campaign_id)
        .order_by(models.CampaignChangelog.changed_at.desc())
        .limit(100)
    )).scalars().all()
    return {"entries": [
        {"id": r.id, "field": r.field_name, "old_value": r.old_value,
         "new_value": r.new_value, "changed_by": r.changed_by,
         "source": r.source,
         "changed_at": r.changed_at.isoformat() if r.changed_at else None}
        for r in rows
    ]}


@app.get("/api/advertisers/{adv_id}/changelog")
async def advertiser_changelog(adv_id: str, db: AsyncSession = Depends(get_db)):
    """Field-level change history for an advertiser (budget edits)."""
    from sqlalchemy import select
    rows = (await db.execute(
        select(models.AdvertiserChangelog)
        .where(models.AdvertiserChangelog.advertiser_id == adv_id)
        .order_by(models.AdvertiserChangelog.changed_at.desc())
        .limit(100)
    )).scalars().all()
    return {"entries": [
        {"id": r.id, "field": r.field_name, "old_value": r.old_value,
         "new_value": r.new_value, "changed_by": r.changed_by,
         "source": r.source,
         "changed_at": r.changed_at.isoformat() if r.changed_at else None}
        for r in rows
    ]}


class NotLiveRequest(BaseModel):
    reason: str = ""


@app.post("/api/workflow/campaigns/{campaign_id}/not-live")
async def workflow_mark_not_live(campaign_id: str, req: NotLiveRequest, db: AsyncSession = Depends(get_db)):
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    campaign.not_live_reason = req.reason
    await db.commit()
    try:
        campaign = await repo.transition_campaign(db, campaign, to_stage="NOT_LIVE")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"success": True, "campaign": repo.campaign_dict(campaign)}


# ── Postgres-backed Dashboard (Phase 4) — raw SQL for reliability ──────────────

def _pg_where(params, advertiser, publisher, dateFrom, dateTo, segment=None):
    from datetime import datetime as _dt
    clauses = []
    if advertiser:
        placeholders = ",".join(f":adv_{i}" for i in range(len(advertiser)))
        clauses.append(f"advertiser IN ({placeholders})")
        for i, a in enumerate(advertiser): params[f"adv_{i}"] = a
    if publisher:
        placeholders = ",".join(f":pub_{i}" for i in range(len(publisher)))
        clauses.append(f"publisher IN ({placeholders})")
        for i, p in enumerate(publisher): params[f"pub_{i}"] = p
    if segment:
        placeholders = ",".join(f":seg_{i}" for i in range(len(segment)))
        clauses.append(f"segment IN ({placeholders})")
        for i, s in enumerate(segment): params[f"seg_{i}"] = s
    if dateFrom:
        clauses.append("date >= :dateFrom")
        try: params["dateFrom"] = _dt.strptime(dateFrom, "%Y-%m-%d").date()
        except Exception: params["dateFrom"] = dateFrom
    if dateTo:
        clauses.append("date <= :dateTo")
        try: params["dateTo"] = _dt.strptime(dateTo, "%Y-%m-%d").date()
        except Exception: params["dateTo"] = dateTo
    return (" WHERE " + " AND ".join(clauses)) if clauses else ""


PG_PUBLISHER_SPENDS_EXPR = (
    "CASE "
    "WHEN publisher_spends_source IN ('sheet', 'calculated') THEN COALESCE(publisher_spends, 0) "
    "WHEN publisher_spends != 0 THEN publisher_spends "
    "ELSE COALESCE(spends, 0) END"
)
PG_ADVERTISER_METRICS_EXPR = "COALESCE(NULLIF(advertiser_metrics, ''), '{}')::jsonb"


@app.get("/api/dashboard/pg/filters")
async def pg_filters(db: AsyncSession = Depends(get_db)):
    advertisers = [r[0] for r in (await db.execute(text("SELECT DISTINCT advertiser FROM rmn_campaign_metrics WHERE advertiser IS NOT NULL ORDER BY advertiser"))).all()]
    publishers = [r[0] for r in (await db.execute(text("SELECT DISTINCT publisher FROM rmn_campaign_metrics WHERE publisher IS NOT NULL ORDER BY publisher"))).all()]
    segments = [r[0] for r in (await db.execute(text("SELECT DISTINCT segment FROM rmn_campaign_metrics WHERE segment IS NOT NULL AND segment != '' ORDER BY segment"))).all()]
    return {"advertisers": advertisers, "publishers": publishers, "segments": segments}


@app.get("/api/dashboard/pg/aggregates")
async def pg_aggregates(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    params = {}
    where = _pg_where(params, advertiser, publisher, dateFrom, dateTo, segment)
    revenue_expr = f"COALESCE(NULLIF(COALESCE({PG_ADVERTISER_METRICS_EXPR}->>'Revenue', {PG_ADVERTISER_METRICS_EXPR}->>'revenue'), '')::float, 0)"
    # Advertiser-side clicks live in the advertiser_metrics JSON (only populated when
    # the campaign's advertiser mapping includes a clicks column); the `clicks` column
    # itself always holds publisher-sheet clicks.
    adv_clicks_expr = f"COALESCE(NULLIF(COALESCE({PG_ADVERTISER_METRICS_EXPR}->>'Clicks', {PG_ADVERTISER_METRICS_EXPR}->>'clicks'), '')::float, 0)"
    direct_adv_spends_expr = f"NULLIF(COALESCE({PG_ADVERTISER_METRICS_EXPR}->>'Spends', {PG_ADVERTISER_METRICS_EXPR}->>'spends'), '')::float"
    adv_spends_expr = (
        "CASE "
        "WHEN advertiser_spends_source IN ('sheet', 'calculated') THEN COALESCE(advertiser_spends, 0) "
        f"ELSE COALESCE({direct_adv_spends_expr}, 0) END"
    )
    sql = f"SELECT COALESCE(SUM(impressions),0) as impressions, COALESCE(SUM(clicks),0) as clicks, COALESCE(SUM({adv_clicks_expr}),0) as adv_clicks, COALESCE(SUM(spends),0) as raw_spends, COALESCE(SUM({PG_PUBLISHER_SPENDS_EXPR}),0) as pub_spends, COALESCE(SUM(orders_pub),0) as orders, COALESCE(SUM({adv_spends_expr}),0) as adv_spends, COALESCE(SUM({revenue_expr}),0) as adv_revenue, COUNT(DISTINCT date) as days FROM rmn_campaign_metrics{where}"
    row = (await db.execute(text(sql), params)).one()
    imp, clicks, pub_spends, orders = int(row.impressions), int(row.clicks), float(row.pub_spends), int(row.orders)
    adv_clicks = int(row.adv_clicks)
    # Count distinct advertisers/publishers
    count_sql = f"SELECT COUNT(DISTINCT advertiser) as adv_count, COUNT(DISTINCT publisher) as pub_count, COALESCE(SUM(distribution),0) as distribution, COALESCE(SUM(redirections),0) as redirections, COUNT(*) as total_rows FROM rmn_campaign_metrics{where}"
    counts = (await db.execute(text(count_sql), params)).one()
    dist = int(counts.distribution)
    return {
        "impressions": imp, "distribution": dist, "impressionsAndDistribution": imp + dist,
        # clicks = pub + adv total (card headline); split fields drive the card subtext.
        "clicks": clicks + adv_clicks, "publisher_clicks": clicks, "advertiser_clicks": adv_clicks,
        "spends": round(pub_spends, 2), "raw_spends": round(float(row.raw_spends), 2), "orders": orders,
        "ctr": round((clicks / imp * 100) if imp > 0 else 0, 2),
        "cpm": round((pub_spends / imp * 1000) if imp > 0 else 0, 2),
        "cpc": round((pub_spends / clicks) if clicks > 0 else 0, 2),
        "publisher_spends": round(pub_spends, 2),
        "advertiser_spends": round(float(row.adv_spends), 2),
        "advertiser_revenue": round(float(row.adv_revenue), 2),
        "redirections": int(counts.redirections),
        "advertiserCount": int(counts.adv_count), "publisherCount": int(counts.pub_count),
        "totalRows": int(counts.total_rows), "cacheAge": 0,
        "hasQL": False, "hasQQG": False, "hasCouponOrders": False,
        "days": int(row.days), "source": "postgres",
    }


@app.get("/api/dashboard/pg/timeseries")
async def pg_timeseries(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    groupBy: Optional[str] = "day",
    db: AsyncSession = Depends(get_db),
):
    params = {}
    where = _pg_where(params, advertiser, publisher, dateFrom, dateTo, segment)
    if groupBy == "week":
        date_expr = "DATE_TRUNC('week', date)::date"
    elif groupBy == "month":
        date_expr = "DATE_TRUNC('month', date)::date"
    else:
        date_expr = "date"
    sql = f"SELECT {date_expr} as date, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM({PG_PUBLISHER_SPENDS_EXPR}) as spends, SUM(orders_pub) as orders FROM rmn_campaign_metrics{where} GROUP BY {date_expr} ORDER BY {date_expr}"
    rows = (await db.execute(text(sql), params)).all()
    return {
        "timeSeries": [{"date": r.date.isoformat(), "impressions": int(r.impressions or 0), "clicks": int(r.clicks or 0), "spends": round(float(r.spends or 0), 2), "orders": int(r.orders or 0)} for r in rows],
        "source": "postgres",
    }


@app.get("/api/dashboard/pg/breakdowns")
async def pg_breakdowns(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    params_adv = {}
    where_adv = _pg_where(params_adv, advertiser, publisher, dateFrom, dateTo, segment)
    sql_adv = f"SELECT advertiser as name, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM({PG_PUBLISHER_SPENDS_EXPR}) as spends FROM rmn_campaign_metrics{where_adv} GROUP BY advertiser ORDER BY spends DESC"
    adv_rows = (await db.execute(text(sql_adv), params_adv)).all()

    params_pub = {}
    where_pub = _pg_where(params_pub, advertiser, publisher, dateFrom, dateTo, segment)
    sql_pub = f"SELECT publisher as name, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM({PG_PUBLISHER_SPENDS_EXPR}) as spends FROM rmn_campaign_metrics{where_pub} GROUP BY publisher ORDER BY spends DESC"
    pub_rows = (await db.execute(text(sql_pub), params_pub)).all()

    params_seg = {}
    where_seg = _pg_where(params_seg, advertiser, publisher, dateFrom, dateTo, segment)
    segment_filter = "segment IS NOT NULL AND segment != ''"
    where_seg = f"{where_seg} AND {segment_filter}" if where_seg else f" WHERE {segment_filter}"
    sql_seg = f"SELECT segment as name, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM({PG_PUBLISHER_SPENDS_EXPR}) as spends FROM rmn_campaign_metrics{where_seg} GROUP BY segment ORDER BY impressions DESC"
    seg_rows = (await db.execute(text(sql_seg), params_seg)).all()

    return {
        "breakdowns": {
            "byAdvertiser": [{"name": r.name, "impressions": int(r.impressions or 0), "clicks": int(r.clicks or 0), "spends": round(float(r.spends or 0), 2)} for r in adv_rows],
            "byPublisher": [{"name": r.name, "impressions": int(r.impressions or 0), "clicks": int(r.clicks or 0), "spends": round(float(r.spends or 0), 2)} for r in pub_rows],
            "bySegment": [{"name": r.name, "impressions": int(r.impressions or 0), "clicks": int(r.clicks or 0), "spends": round(float(r.spends or 0), 2)} for r in seg_rows],
        },
        "source": "postgres",
    }


@app.get("/api/dashboard/pg/table")
async def pg_table(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    segment: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    offset: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    params = {}
    where = _pg_where(params, advertiser, publisher, dateFrom, dateTo, segment)
    count_sql = f"SELECT COUNT(*) as cnt FROM rmn_campaign_metrics{where}"
    total = (await db.execute(text(count_sql), params)).scalar() or 0

    params2 = dict(params)
    params2["lim"] = limit
    params2["off"] = offset
    direct_adv_spends_expr = f"NULLIF(COALESCE({PG_ADVERTISER_METRICS_EXPR}->>'Spends', {PG_ADVERTISER_METRICS_EXPR}->>'spends'), '')::float"
    adv_spends_expr = (
        "CASE "
        "WHEN advertiser_spends_source IN ('sheet', 'calculated') THEN COALESCE(advertiser_spends, 0) "
        f"ELSE COALESCE({direct_adv_spends_expr}, 0) END"
    )
    sql = f"SELECT date, advertiser, publisher, segment, impressions, clicks, spends, orders_pub, {PG_PUBLISHER_SPENDS_EXPR} as publisher_spends, {adv_spends_expr} as advertiser_spends, publisher_spends_source, advertiser_spends_source, advertiser_metrics FROM rmn_campaign_metrics{where} ORDER BY date DESC LIMIT :lim OFFSET :off"
    rows = (await db.execute(text(sql), params2)).all()
    return {
        "rows": [{"date": r.date.isoformat(), "advertiser": r.advertiser, "publisher": r.publisher, "segment": r.segment, "impressions": r.impressions, "clicks": r.clicks, "spends": r.spends, "orders_pub": r.orders_pub, "publisher_spends": r.publisher_spends, "advertiser_spends": r.advertiser_spends, "publisher_spends_source": r.publisher_spends_source, "advertiser_spends_source": r.advertiser_spends_source, "advertiser_metrics": json.loads(r.advertiser_metrics) if r.advertiser_metrics else {}} for r in rows],
        "total": total, "source": "postgres",
    }


# ── Revenue Attribution ───────────────────────────────────────────────────────

@app.post("/api/workflow/campaigns/{campaign_id}/attribution")
async def run_campaign_attribution(campaign_id: str, file: UploadFile = File(...), drive_folder_url: str = Query(...), db: AsyncSession = Depends(get_db)):
    """Run revenue attribution for a campaign using uploaded redemption file + Drive folder."""
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")

    content = await file.read()
    from attribution_worker import run_attribution
    result = run_attribution(content, file.filename, drive_folder_url)

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, **result}


# ── ETL Sync ──────────────────────────────────────────────────────────────────

@app.post("/api/workflow/campaigns/{campaign_id}/sync")
async def sync_campaign_endpoint(campaign_id: str, db: AsyncSession = Depends(get_db)):
    """Trigger ETL sync for one campaign."""
    import etl_worker
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    if not campaign.tracking_submitted:
        raise HTTPException(status_code=400, detail="Tracking setup not submitted yet")
    result = await etl_worker.sync_campaign(db, campaign)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return {"success": True, **result}


@app.post("/api/sync/all")
async def sync_all_endpoint(db: AsyncSession = Depends(get_db)):
    """Trigger ETL sync for all campaigns with tracking submitted."""
    import etl_worker
    results = await etl_worker.sync_all_campaigns(db)
    return {"success": True, "results": results, "total": len(results)}


@app.post("/api/workflow/campaigns/{campaign_id}/recompute")
async def recompute_campaign_metrics(campaign_id: str, db: AsyncSession = Depends(get_db)):
    """Re-evaluate formulas on existing metric rows without re-syncing from sheets.
    Uses billing config first, then Sales/Campaign Ops billing defaults."""
    import etl_worker
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")

    pub_model, pub_rate = _publisher_default_terms(campaign)
    pub_formula = etl_worker._publisher_formula_from_terms(pub_model, pub_rate)
    adv = await _get_campaign_advertiser(db, campaign)
    adv_model, adv_rate = _advertiser_default_terms(adv) if adv else ("", 0.0)
    adv_formula = etl_worker._advertiser_formula_from_terms(adv_model, adv_rate)
    billing_configs = await etl_worker._load_billing_configs(db, campaign_id)
    metrics_config = json.loads(campaign.metrics_json or '{}')
    adv_metric_names = metrics_config.get('advertiser_metrics', [])
    pub_col_mapping = await etl_worker._load_column_mapping(
        db, campaign.publisher_name or "", "publisher",
        sheet_url=campaign.publisher_data_url, campaign_id=campaign.id,
    )
    publisher_mapping_has_spends = etl_worker._mapping_has_publisher_spends(pub_col_mapping)

    result = await db.execute(
        select(models.CampaignMetric).where(models.CampaignMetric.campaign_id == campaign_id)
    )
    rows = result.scalars().all()
    updated = 0
    for m in rows:
        row_data = {
            'Impressions': float(m.impressions or 0), 'Distribution': float(m.distribution or 0),
            'Clicks': float(m.clicks or 0), 'Orders_pub': float(m.orders_pub or 0),
            'Scratches': float(m.scratches or 0), 'Coins_Burned': float(m.coins_burned or 0),
            'Redirections': float(m.redirections or 0), 'Spends': float(m.spends or 0),
        }
        row_data['CTR'] = (row_data['Clicks'] / row_data['Distribution'] * 100) if row_data['Distribution'] > 0 else 0
        row_data['CPM'] = (row_data['Spends'] / row_data['Distribution'] * 1000) if row_data['Distribution'] > 0 else 0
        row_data['CPC'] = (row_data['Spends'] / row_data['Clicks']) if row_data['Clicks'] > 0 else 0
        adv_metrics = json.loads(m.advertiser_metrics) if m.advertiser_metrics else {}
        for k, v in adv_metrics.items():
            etl_worker._add_metric_alias(row_data, k, v)

        pub_billing_config = etl_worker._active_billing_config(billing_configs, "publisher", m.date)
        adv_billing_config = etl_worker._active_billing_config(billing_configs, "advertiser", m.date)
        pub_row_meta = {
            etl_worker.SHEET_SPENDS_FLAG: (
                m.publisher_spends_source == "sheet"
                or publisher_mapping_has_spends
                or (m.publisher_spends_source is None and float(m.spends or 0) != 0)
            )
        }
        new_pub, new_pub_source = etl_worker._choose_publisher_spends(
            row_data, pub_row_meta, pub_billing_config, pub_formula
        )
        if m.advertiser_spends_source == "sheet" and not etl_worker._has_metric(
            adv_metrics, "Spends", "spends", "Advertiser_Spends", "advertiser_spends"
        ):
            new_adv = float(m.advertiser_spends or 0)
            new_adv_source = "sheet"
        else:
            new_adv, new_adv_source = etl_worker._choose_advertiser_spends(
                row_data, adv_metrics, adv_billing_config, adv_formula
            )
        row_data['Publisher_Spends'] = new_pub
        row_data['Advertiser_Spends'] = new_adv
        computed = etl_worker._compute_advertiser_metrics(adv_metric_names, row_data)
        adv_metrics.update(computed)

        m.publisher_spends = new_pub
        m.advertiser_spends = new_adv
        m.publisher_spends_source = new_pub_source
        m.advertiser_spends_source = new_adv_source
        m.advertiser_metrics = json.dumps(adv_metrics)
        updated += 1

    await db.commit()
    return {"success": True, "recomputed": updated}


@app.get("/api/workflow/campaigns/{campaign_id}/metrics")
async def get_campaign_metrics(campaign_id: str, db: AsyncSession = Depends(get_db)):
    """Get synced metrics for a campaign."""
    result = await db.execute(
        select(models.CampaignMetric).where(models.CampaignMetric.campaign_id == campaign_id).order_by(models.CampaignMetric.date.desc())
    )
    rows = result.scalars().all()
    return {
        "campaign_id": campaign_id,
        "rows": len(rows),
        "last_synced": rows[0].synced_at.isoformat() if rows else None,
        "metrics": [
            {
                "date": r.date.isoformat(),
                "impressions": r.impressions, "clicks": r.clicks, "spends": r.spends,
                "orders_pub": r.orders_pub, "publisher_spends": r.publisher_spends,
                "advertiser_spends": r.advertiser_spends,
                "publisher_spends_source": r.publisher_spends_source,
                "advertiser_spends_source": r.advertiser_spends_source,
                "advertiser_metrics": json.loads(r.advertiser_metrics) if r.advertiser_metrics else {},
            }
            for r in rows[:60]  # last 60 days
        ],
    }


@app.get("/api/workflow/campaigns/{campaign_id}/billing")
async def get_billing_config(campaign_id: str, db: AsyncSession = Depends(get_db)):
    """Get billing config + computed spends for a campaign."""
    result = await db.execute(
        select(models.BillingConfig)
        .where(models.BillingConfig.campaign_id == campaign_id)
        .order_by(models.BillingConfig.side, models.BillingConfig.start_date.desc())
    )
    configs = result.scalars().all()

    # Compute spends from metrics + billing config
    from datetime import date as dt_date, timedelta
    thirty_days_ago = dt_date.today() - timedelta(days=30)
    metrics_result = await db.execute(
        select(models.CampaignMetric)
        .where(models.CampaignMetric.campaign_id == campaign_id)
        .where(models.CampaignMetric.date >= thirty_days_ago)
    )
    metric_rows = metrics_result.scalars().all()

    import etl_worker
    billing_configs = [
        {
            "side": c.side,
            "billing_model": c.billing_model,
            "rate": c.rate,
            "start_date": c.start_date,
            "end_date": c.end_date,
        }
        for c in configs
    ]
    pub_total = 0.0
    adv_total = 0.0
    for m in metric_rows:
        row_data = {
            "Impressions": float(m.impressions or 0),
            "Clicks": float(m.clicks or 0),
            "Orders_pub": float(m.orders_pub or 0),
            "Spends": float(m.spends or 0),
        }
        adv_metrics = json.loads(m.advertiser_metrics) if m.advertiser_metrics else {}
        for k, v in adv_metrics.items():
            etl_worker._add_metric_alias(row_data, k, v)
        pub_cfg = etl_worker._active_billing_config(billing_configs, "publisher", m.date)
        adv_cfg = etl_worker._active_billing_config(billing_configs, "advertiser", m.date)
        if pub_cfg:
            pub_total += etl_worker._billing_spend_from_config(pub_cfg, row_data)
        if adv_cfg:
            adv_total += etl_worker._billing_spend_from_config(adv_cfg, row_data)

    return {
        "configs": [
            {
                "id": c.id, "campaign_id": c.campaign_id, "side": c.side,
                "billing_model": c.billing_model, "rate": c.rate,
                "start_date": c.start_date.isoformat(), "end_date": c.end_date.isoformat() if c.end_date else None,
                "created_at": c.created_at.isoformat() if c.created_at else None,
                "created_by": c.created_by,
            }
            for c in configs
        ],
        "spends": {
            "publisher": round(pub_total, 2),
            "advertiser": round(adv_total, 2),
            "margin": round(adv_total - pub_total, 2),
            "margin_pct": round((adv_total - pub_total) / adv_total * 100, 1) if adv_total > 0 else 0,
        },
    }


class BillingConfigRequest(BaseModel):
    side: str
    billing_model: str
    rate: float
    start_date: str
    replace_config_id: Optional[int] = None


@app.post("/api/workflow/campaigns/{campaign_id}/billing")
async def add_billing_config(campaign_id: str, req: BillingConfigRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Add or change billing config for a campaign side."""
    from datetime import date as dt_date
    side = (req.side or "").strip().lower()
    billing_model = _normalize_billing_model(side, req.billing_model)

    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    await _validate_billing_metrics_if_configured(campaign, side, billing_model)
    if _safe_billing_rate(req.rate) <= 0:
        raise HTTPException(status_code=400, detail="rate must be greater than 0")

    try:
        new_start = dt_date.fromisoformat(req.start_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")
    user_email = getattr(request.state, "user_email", None)
    old_summary_override = None
    if req.replace_config_id:
        existing = (await db.execute(
            select(models.BillingConfig)
            .where(models.BillingConfig.id == req.replace_config_id)
            .where(models.BillingConfig.campaign_id == campaign_id)
            .where(models.BillingConfig.side == side)
        )).scalar_one_or_none()
        if not existing:
            raise HTTPException(status_code=404, detail="billing config not found")
        old_summary_override = _billing_summary(side, existing.billing_model, existing.rate, existing.start_date)
        await db.delete(existing)
        await db.flush()
    recomputed = await _upsert_billing_config(
        db, campaign, side=side, billing_model=billing_model, rate=req.rate,
        start_date=new_start, changed_by=user_email, source="billing_tab", recompute=True,
        old_summary_override=old_summary_override,
    )
    return {"success": True, "recomputed": recomputed}


@app.get("/api/sheet-headers")
async def get_sheet_headers(url: str = Query(...)):
    """Read column headers from a Google Sheet URL for metric auto-detection."""
    from sheets_client import read_sheet_headers
    headers = read_sheet_headers(url)
    return {"headers": headers}


class TrackingSetupRequest(BaseModel):
    campaign_type: str = "Single Campaign Sheet"
    advertiser_data_url: str = ""
    publisher_data_url: str = ""
    segment_pub: str = ""
    segment_adv: str = ""
    # Self-targeted (per sheet side): that side's sheet has no segment column
    # — the segment is the brand itself (Setup shows a name dropdown instead).
    self_targeted_adv: bool = False
    self_targeted_pub: bool = False
    goals_json: str = "{}"
    metrics_json: str = "{}"
    additional_context: str = ""


@app.post("/api/workflow/campaigns/{campaign_id}/tracking-setup")
async def workflow_tracking_setup(campaign_id: str, req: TrackingSetupRequest, db: AsyncSession = Depends(get_db)):
    """Save tracking fields, write row to Automation Tracker sheet, transition to COMPLETED."""
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")

    # Save tracking fields on campaign
    campaign.advertiser_data_url = req.advertiser_data_url
    campaign.publisher_data_url = req.publisher_data_url
    campaign.segment_pub = req.segment_pub
    campaign.segment_adv = req.segment_adv
    campaign.self_targeted_adv = req.self_targeted_adv
    campaign.self_targeted_pub = req.self_targeted_pub
    campaign.goals_json = req.goals_json
    campaign.metrics_json = req.metrics_json
    campaign.additional_context = req.additional_context
    campaign.tracking_submitted = True
    await db.commit()
    await db.refresh(campaign)

    # Build campaign_details JSON from existing asset fields
    import json
    # Derive buy_type from agreement for campaign_details
    buy_type_str = ""
    if campaign.agreement_id:
        ag_result = await db.execute(
            select(models.Agreement.buy_type).where(models.Agreement.id == campaign.agreement_id)
        )
        buy_type_str = ag_result.scalar() or ""
    pub_model, pub_rate = _publisher_default_terms(campaign)
    campaign_details = json.dumps({
        "campaign_details": {
            "brand_name": campaign.advertiser_name or campaign.name or "",
            "offer_title": campaign.offer_title or "",
            "details": campaign.details_tc or "",
            "how_to_redeem": campaign.how_to_redeem or "",
            "tracking": {"landing_link": campaign.landing_link or "", "utm_redirection_link": ""},
            "incentives": {"codes": [c.strip() for c in (campaign.promo_codes or "").split(",") if c.strip()],
                          "codes_validity": {"start_date": "", "expiry_date": campaign.code_validity or ""}},
            "assets": {"creative_url": campaign.creative_url or "", "logo_url": campaign.logo_url or ""},
            "targeting": {"Segment_link": "", "Segment_Description": campaign.targeting or "", "Size": "", "Cohort_Name": ""},
            "budget_and_metrics": {
                "buy_type": pub_model.upper() if pub_model else buy_type_str,
                "rate": pub_rate or "",
                "total_budget": 0,
            },
            "Rzp_cut": 0,
        }
    })

    # Write row to Automation Tracker sheet
    from sheets_client import append_rows
    KPI_SPREADSHEET_ID = os.environ.get("KPI_SPREADSHEET_ID", "1VDr2ewZw2Xl43PuYBoKt8PgepItHZs-icD49YnILBss")
    row = [
        req.campaign_type,                         # A: Campaign type
        campaign.advertiser_name or "",            # B: Advertiser
        campaign.publisher_name or "",             # C: Publisher
        "",                                        # D: Advertiser Industry
        campaign.advertiser_name or "",            # E: Brand
        campaign.offer_title or "",                # F: Offer
        req.advertiser_data_url,                   # G: Advertiser Data URL
        req.publisher_data_url,                    # H: Publisher Data URL
        "",                                        # I: Merged Sheet URL
        req.goals_json,                            # J: Goals JSON
        req.metrics_json,                          # K: Metrics JSON
        req.segment_pub,                           # L: Segment Pub
        req.segment_adv,                           # M: Segment Adv
        req.additional_context,                    # N: Additional Context
        campaign_details,                          # O: Campaign Details JSON
        "",                                        # P: Changes
        "Pending",                                 # Q: Status
    ]
    try:
        append_rows(KPI_SPREADSHEET_ID, "Sheet1", [row])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to write to tracker sheet: {e}")

    # Transition to COMPLETED
    try:
        campaign = await repo.transition_campaign(db, campaign, to_stage="COMPLETED")
    except ValueError:
        pass  # already completed or can't transition — still ok

    return {"success": True, "campaign": repo.campaign_dict(campaign)}


class PublisherEmailRequest(BaseModel):
    to: str = ""
    subject: str = ""
    body: str = ""
    thread_id: Optional[str] = None
    message_id: Optional[str] = None


@app.post("/api/workflow/campaigns/{campaign_id}/publisher-email")
async def workflow_record_publisher_email(campaign_id: str, req: PublisherEmailRequest, db: AsyncSession = Depends(get_db)):
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    campaign = await repo.record_publisher_email(db, campaign, to=req.to, subject=req.subject, body=req.body,
                                                    thread_id=req.thread_id, message_id=req.message_id)
    return {"success": True, "campaign": repo.campaign_dict(campaign)}


@app.patch("/api/workflow/ops-tasks/{task_id}")
async def workflow_update_ops_task(task_id: str, req: UpdateOpsTaskRequest, db: AsyncSession = Depends(get_db)):
    task = await repo.get_ops_task(db, task_id)
    if not task:
        raise HTTPException(status_code=404, detail=f"ops task {task_id} not found")
    if req.status is not None and req.status.upper() not in wf.TASK_STATUSES:
        raise HTTPException(status_code=400, detail=f"invalid status {req.status!r}")
    task = await repo.update_ops_task(db, task, status=req.status, owner_email=req.owner_email)
    return {"success": True, "ops_task": repo.ops_task_dict(task)}


@app.post("/api/workflow/campaigns/{campaign_id}/transition")
async def workflow_transition(campaign_id: str, req: TransitionRequest, request: Request, db: AsyncSession = Depends(get_db)):
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    from_stage = campaign.current_stage
    actor_email = req.actor_email or getattr(request.state, "user_email", None)
    if wf.normalize_stage(req.to_stage) == wf.STAGE_LIVE and from_stage != wf.STAGE_LIVE:
        await _validate_go_live_billing_defaults(db, campaign)
    try:
        campaign = await repo.transition_campaign(
            db, campaign, to_stage=req.to_stage, actor_email=actor_email,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    billing_recomputed = 0
    if campaign.current_stage == wf.STAGE_LIVE and from_stage != wf.STAGE_LIVE:
        billing_recomputed = await _seed_go_live_billing_defaults(db, campaign, changed_by=actor_email)

    # Fire-and-forget hand-off email: a send failure must not undo the committed
    # stage change.
    notified: List[str] = []
    team = wf.HANDOFF_ON.get(campaign.current_stage)
    if team and req.notify_recipients:
        recips = [r.strip() for r in req.notify_recipients if r and r.strip()]
        if recips:
            try:
                from sheets_client import send_email
                label = wf.STAGE_LABELS.get(campaign.current_stage, campaign.current_stage)
                subject = f"[RMN] Campaign '{campaign.name}' → {label}"
                body = f"Campaign '{campaign.name}' has moved to {label} ({team} hand-off)."
                send_email(recips, subject, body, subtype="plain")
                notified = recips
            except Exception as e:
                logger.warning(f"hand-off email failed: {e}")

    return {
        "success": True,
        "campaign": repo.campaign_dict(campaign),
        "from_stage": from_stage,
        "billing_recomputed": billing_recomputed,
        "notified": notified,
    }


# ── Reporting: shared helpers ─────────────────────────────────────────────────

def _ensure_registry(sheet_name: str, headers: List[str]):
    """Create registry sheet with headers if it doesn't already exist."""
    try:
        from sheets_client import get_sheet_names
        names = get_sheet_names(KPI_SPREADSHEET_ID)
        if sheet_name not in names:
            ensure_sheet_tab(KPI_SPREADSHEET_ID, sheet_name)
            append_rows(KPI_SPREADSHEET_ID, sheet_name, [headers])
    except Exception as e:
        logger.warning(f"Could not ensure registry sheet {sheet_name}: {e}")


def _read_registry(sheet_name: str) -> List:
    try:
        rows = read_kpi_sheet(sheet_name)
        return rows or []
    except Exception:
        return []


# ── Drive-folder report registry helpers ───────────────────────────────────────
# Reports live as spreadsheets in a dedicated Drive folder owned by the service
# account. All metadata travels with each file as appProperties — no separate
# registry sheet to keep in sync (which previously broke silently on the
# read-only KPI spreadsheet).

def _drive_file_to_adv_report(f: dict) -> dict:
    ap = f.get("appProperties", {}) or {}
    created = f.get("createdTime", "") or ""
    return {
        "id": f.get("id", ""),
        "reportName": ap.get("mdReportName", f.get("name", "")),
        "advertiser": ap.get("mdAdvertiser", ""),
        "dateFrom": ap.get("mdDateFrom", "All"),
        "views": [v for v in ap.get("mdViews", "").split(",") if v],
        "selectedColumns": [c for c in ap.get("mdSelectedColumns", "").split(",") if c],
        "spreadsheetUrl": f.get("webViewLink", ""),
        "spreadsheetId": f.get("id", ""),
        "createdBy": ap.get("mdCreatedBy", ""),
        "createdDate": created.replace("T", " ")[:19] if created else "",
        "lastRefreshed": ap.get("mdLastRefreshed", ""),
    }


def _drive_file_to_pub_report(f: dict) -> dict:
    import json as _json
    ap = f.get("appProperties", {}) or {}
    created = f.get("createdTime", "") or ""
    try:
        advertisers = _json.loads(ap.get("mdAdvertisersJson", "")) if ap.get("mdAdvertisersJson") else []
    except Exception:
        advertisers = []
    return {
        "id": f.get("id", ""),
        "reportName": ap.get("mdReportName", f.get("name", "")),
        "publisher": ap.get("mdPublisher", ""),
        "advertisers": advertisers,
        "dateFrom": ap.get("mdDateFrom", "All"),
        "dateTo": ap.get("mdDateTo", ""),
        "reportingLevels": [v for v in ap.get("mdReportingLevels", "").split(",") if v],
        "spreadsheetUrl": f.get("webViewLink", ""),
        "spreadsheetId": f.get("id", ""),
        "createdBy": ap.get("mdCreatedBy", ""),
        "createdDate": created.replace("T", " ")[:19] if created else "",
        "lastRefreshed": ap.get("mdLastRefreshed", ""),
    }


def _list_drive_reports(report_type: str) -> List[dict]:
    """List reports of the given type ('advertiser'|'publisher') from the Drive folder."""
    folder_id = ensure_reports_folder()
    files = list_folder_files(folder_id)
    out = []
    for f in files:
        ap = f.get("appProperties", {}) or {}
        if ap.get("mdType") != report_type:
            continue
        out.append(
            _drive_file_to_adv_report(f) if report_type == "advertiser"
            else _drive_file_to_pub_report(f)
        )
    return out


def _get_drive_report(report_id: str, report_type: str) -> Optional[dict]:
    try:
        f = get_app_properties(report_id)
    except Exception as e:
        logger.error(f"Could not fetch report {report_id}: {e}")
        return None
    ap = f.get("appProperties", {}) or {}
    if ap.get("mdType") != report_type:
        return None
    return (
        _drive_file_to_adv_report(f) if report_type == "advertiser"
        else _drive_file_to_pub_report(f)
    )


def _merged_reports(report_type: str, registry_sheet: str, parse_fn) -> List[dict]:
    """Hybrid list: new reports from the Drive folder + legacy reports from the
    read-only KPI registry. Drive entries win on duplicate spreadsheet IDs.

    New reports (owned by the current app account) are fully functional.
    Legacy reports (owned by the original creator) are read/open-only — they
    appear with a `legacy: True` flag so the UI can hint that refresh/delete
    aren't available until access is granted.
    """
    drive_reports = _list_drive_reports(report_type)
    drive_ss_ids = {r.get("spreadsheetId") for r in drive_reports if r.get("spreadsheetId")}

    legacy = []
    try:
        legacy = parse_fn(_read_registry(registry_sheet))
    except Exception as e:
        logger.warning(f"Could not read legacy registry {registry_sheet}: {e}")

    legacy_only = [
        {**r, "legacy": True}
        for r in legacy
        if r.get("spreadsheetId") and r["spreadsheetId"] not in drive_ss_ids
    ]
    return drive_reports + legacy_only


# ── Advertiser Reporting ───────────────────────────────────────────────────────

@app.get("/api/reporting/advertiser/list")
def list_advertiser_reports():
    return {"reports": _merged_reports("advertiser", ADVERTISER_REGISTRY_SHEET, parse_adv_registry)}


@app.get("/api/reporting/advertiser/columns")
def get_adv_columns():
    data = load_report_data()
    cols = get_available_columns(data["headers"])
    return {"columns": cols, "forcedColumns": FORCED_COLS}


class AdvReportConfig(BaseModel):
    reportName: str
    advertiser: str
    dateFrom: Optional[str] = None
    selectedColumns: List[str]
    viewsToCreate: List[str]  # consolidated, monthly, weekly, segmentWeekly


@app.post("/api/reporting/advertiser/create")
def create_advertiser_report(config: AdvReportConfig):
    import json as _json
    from datetime import datetime as _dt

    data = load_report_data()
    rows = filter_by_advertiser(data["rows"], data["headers"], config.advertiser)
    rows = filter_by_date(rows, data["headers"], config.dateFrom)

    if not rows:
        raise HTTPException(status_code=400, detail=f"No data found for advertiser '{config.advertiser}'")

    # Build sheets content for each view
    view_map = {
        "consolidated": build_consolidated,
        "monthly":      build_monthly,
        "weekly":       build_weekly,
        "segmentWeekly": build_segment_weekly,
    }

    tab_data = {}
    for view in config.viewsToCreate:
        if view in view_map:
            tab_data[view] = view_map[view](rows, data["headers"], config.selectedColumns)

    # Create Google Spreadsheet
    title = f"{config.advertiser} — {config.reportName}"
    try:
        ss = create_spreadsheet(title)
        ss_id = ss["spreadsheetId"]
        ss_url = ss["spreadsheetUrl"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create spreadsheet: {e}")

    # Write each view as a tab
    sheets_created = []
    for view_name, sheet_data in tab_data.items():
        tab_title = {
            "consolidated": "Consolidated",
            "monthly":      "Monthly",
            "weekly":       "Weekly",
            "segmentWeekly": "Segment Weekly",
        }.get(view_name, view_name)
        try:
            ensure_sheet_tab(ss_id, tab_title)
            write_sheet_tab(ss_id, tab_title, sheet_data)
            sheets_created.append(tab_title)
        except Exception as e:
            logger.error(f"Failed to write tab {tab_title}: {e}")

    # Share with team
    try:
        share_spreadsheet(ss_id, REPORT_SHARE_EMAILS)
    except Exception as e:
        logger.warning(f"Could not share spreadsheet {ss_id}: {e}")

    # Register: move into the reports folder + attach metadata as appProperties.
    # report_id is the Drive file id itself — no separate registry needed.
    now = _dt.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    date_from_str = config.dateFrom or "All"
    try:
        folder_id = ensure_reports_folder()
        move_to_folder(ss_id, folder_id)
        set_app_properties(ss_id, {
            "mdType": "advertiser",
            "mdReportName": config.reportName,
            "mdAdvertiser": config.advertiser,
            "mdDateFrom": date_from_str,
            "mdViews": ",".join(config.viewsToCreate),
            "mdSelectedColumns": ",".join(config.selectedColumns),
            "mdCreatedBy": "dashboard-user",
            "mdLastRefreshed": now,
        })
    except Exception as e:
        logger.error(f"Failed to register report in Drive folder: {e}")

    return {
        "success": True,
        "reportId": ss_id,
        "spreadsheetUrl": ss_url,
        "sheets": sheets_created,
    }


@app.post("/api/reporting/advertiser/refresh/{report_id}")
def refresh_advertiser_report(report_id: str):
    from datetime import datetime as _dt

    report = _get_drive_report(report_id, "advertiser")
    if not report:
        legacy = next((r for r in parse_adv_registry(_read_registry(ADVERTISER_REGISTRY_SHEET))
                       if r["id"] == report_id), None)
        if legacy:
            raise HTTPException(status_code=400, detail=(
                "This is a legacy report owned by another account. Refresh isn't "
                "available until edit access is granted, or recreate it as a new report."
            ))
        raise HTTPException(status_code=404, detail="Report not found")

    data = load_report_data()
    rows = filter_by_advertiser(data["rows"], data["headers"], report["advertiser"])
    rows = filter_by_date(rows, data["headers"], report["dateFrom"] if report["dateFrom"] != "All" else None)

    view_map = {
        "consolidated": build_consolidated,
        "monthly":      build_monthly,
        "weekly":       build_weekly,
        "segmentWeekly": build_segment_weekly,
    }

    ss_id = report["spreadsheetId"]
    for view in report["views"]:
        if view not in view_map:
            continue
        sheet_data = view_map[view](rows, data["headers"], report["selectedColumns"])
        tab_title = {"consolidated": "Consolidated", "monthly": "Monthly",
                     "weekly": "Weekly", "segmentWeekly": "Segment Weekly"}.get(view, view)
        try:
            ensure_sheet_tab(ss_id, tab_title)
            write_sheet_tab(ss_id, tab_title, sheet_data)
        except Exception as e:
            logger.error(f"Refresh: failed tab {tab_title}: {e}")

    # Update last refreshed in appProperties
    now = _dt.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        set_app_properties(report_id, {"mdLastRefreshed": now})
    except Exception as e:
        logger.error(f"Failed to update lastRefreshed for {report_id}: {e}")
    return {"success": True, "lastRefreshed": now}


@app.delete("/api/reporting/advertiser/{report_id}")
def delete_advertiser_report(report_id: str):
    if not _get_drive_report(report_id, "advertiser"):
        legacy = next((r for r in parse_adv_registry(_read_registry(ADVERTISER_REGISTRY_SHEET))
                       if r["id"] == report_id), None)
        if legacy:
            raise HTTPException(status_code=400, detail=(
                "This is a legacy report owned by another account and can't be "
                "deleted from here until edit access is granted."
            ))
    try:
        trash_file(report_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/reporting/advertiser/refresh-all")
def refresh_all_advertiser_reports():
    reports = _list_drive_reports("advertiser")
    results = []
    for r in reports:
        try:
            refresh_advertiser_report(r["id"])
            results.append({"id": r["id"], "status": "ok"})
        except Exception as e:
            results.append({"id": r["id"], "status": "error", "message": str(e)})
    return {"results": results}


# ── Publisher Reporting ───────────────────────────────────────────────────────

@app.get("/api/reporting/publisher/list")
def list_publisher_reports():
    return {"reports": _merged_reports("publisher", PUBLISHER_REGISTRY_SHEET, parse_pub_registry)}


@app.get("/api/reporting/publisher/metrics")
def get_pub_metrics():
    data = load_report_data()
    from reporting_logic import PUB_FIXED_METRICS
    extra = get_publisher_extra_metrics(data["headers"])
    return {"fixedMetrics": PUB_FIXED_METRICS, "extraMetrics": extra}


@app.get("/api/reporting/publisher/advertisers")
def get_pub_advertisers(
    publisher: str,
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
):
    data = load_report_data()
    advertisers = get_publisher_advertisers(data["rows"], data["headers"], publisher, dateFrom, dateTo)
    return {"advertisers": advertisers}


class PubAdvertiserConfig(BaseModel):
    name: str
    segments: Optional[List[str]] = []
    metrics: Optional[List[str]] = []


class PubReportConfig(BaseModel):
    reportName: str
    publisher: str
    dateFrom: Optional[str] = None
    dateTo: Optional[str] = None
    reportingLevels: List[str]  # daily, weekly, mtd
    advertisers: List[PubAdvertiserConfig]
    extraMetrics: Optional[List[str]] = []


@app.post("/api/reporting/publisher/create")
def create_publisher_report(config: PubReportConfig):
    import json as _json
    from datetime import datetime as _dt
    from reporting_logic import PUB_FIXED_METRICS

    data = load_report_data()
    rows = filter_by_publisher(data["rows"], data["headers"], config.publisher)
    rows = filter_by_date(rows, data["headers"], config.dateFrom, config.dateTo)

    if not rows:
        raise HTTPException(status_code=400, detail=f"No data found for publisher '{config.publisher}'")

    selected_adv_names = {a.name for a in config.advertisers}
    if selected_adv_names:
        adv_col = __import__("reporting_logic")._get_col(data["headers"], "Advertiser")
        rows = [r for r in rows if adv_col >= 0 and len(r) > adv_col and r[adv_col] in selected_adv_names]

    all_metrics = PUB_FIXED_METRICS + [m for m in (config.extraMetrics or []) if m not in PUB_FIXED_METRICS]

    level_builders = {
        "daily":  build_pub_daily,
        "weekly": build_pub_weekly,
        "mtd":    build_pub_mtd,
    }

    tab_data = {}
    for level in config.reportingLevels:
        if level in level_builders:
            tab_data[level] = level_builders[level](rows, data["headers"], all_metrics)

    # Create Google Spreadsheet
    title = f"{config.publisher} — {config.reportName}"
    try:
        ss = create_spreadsheet(title)
        ss_id = ss["spreadsheetId"]
        ss_url = ss["spreadsheetUrl"]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create spreadsheet: {e}")

    # Write tabs
    tab_titles = {"daily": "Daily", "weekly": "Weekly", "mtd": "MTD"}
    for level, sheet_data in tab_data.items():
        tab_title = tab_titles.get(level, level)
        try:
            ensure_sheet_tab(ss_id, tab_title)
            write_sheet_tab(ss_id, tab_title, sheet_data)
        except Exception as e:
            logger.error(f"Failed to write publisher tab {tab_title}: {e}")

    # Share
    try:
        share_spreadsheet(ss_id, REPORT_SHARE_EMAILS)
    except Exception as e:
        logger.warning(f"Could not share publisher spreadsheet {ss_id}: {e}")

    # Register: move into the reports folder + attach metadata as appProperties.
    now = _dt.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    adv_list = [{"name": a.name, "segments": a.segments, "metrics": a.metrics} for a in config.advertisers]
    try:
        folder_id = ensure_reports_folder()
        move_to_folder(ss_id, folder_id)
        set_app_properties(ss_id, {
            "mdType": "publisher",
            "mdReportName": config.reportName,
            "mdPublisher": config.publisher,
            "mdAdvertisersJson": _json.dumps(adv_list),
            "mdDateFrom": config.dateFrom or "All",
            "mdDateTo": config.dateTo or "",
            "mdReportingLevels": ",".join(config.reportingLevels),
            "mdCreatedBy": "dashboard-user",
            "mdLastRefreshed": now,
        })
    except Exception as e:
        logger.error(f"Failed to register publisher report in Drive folder: {e}")

    return {
        "success": True,
        "reportId": ss_id,
        "spreadsheetUrl": ss_url,
        "advertisers": [a.name for a in config.advertisers],
    }


@app.post("/api/reporting/publisher/refresh/{report_id}")
def refresh_publisher_report(report_id: str):
    import json as _json
    from datetime import datetime as _dt
    from reporting_logic import PUB_FIXED_METRICS

    report = _get_drive_report(report_id, "publisher")
    if not report:
        legacy = next((r for r in parse_pub_registry(_read_registry(PUBLISHER_REGISTRY_SHEET))
                       if r["id"] == report_id), None)
        if legacy:
            raise HTTPException(status_code=400, detail=(
                "This is a legacy report owned by another account. Refresh isn't "
                "available until edit access is granted, or recreate it as a new report."
            ))
        raise HTTPException(status_code=404, detail="Publisher report not found")

    data = load_report_data()
    rows = filter_by_publisher(data["rows"], data["headers"], report["publisher"])
    date_from = report["dateFrom"] if report["dateFrom"] not in ("All", "") else None
    date_to = report["dateTo"] if report.get("dateTo") else None
    rows = filter_by_date(rows, data["headers"], date_from, date_to)

    # Figure out metrics from stored advertisers config
    extra_metrics = []
    for adv in report.get("advertisers", []):
        if isinstance(adv, dict):
            for m in adv.get("metrics", []):
                if m not in PUB_FIXED_METRICS and m not in extra_metrics:
                    extra_metrics.append(m)
    all_metrics = PUB_FIXED_METRICS + extra_metrics

    level_builders = {
        "daily":  build_pub_daily,
        "weekly": build_pub_weekly,
        "mtd":    build_pub_mtd,
    }
    tab_titles = {"daily": "Daily", "weekly": "Weekly", "mtd": "MTD"}
    ss_id = report["spreadsheetId"]

    for level in report["reportingLevels"]:
        if level not in level_builders:
            continue
        sheet_data = level_builders[level](rows, data["headers"], all_metrics)
        tab_title = tab_titles.get(level, level)
        try:
            ensure_sheet_tab(ss_id, tab_title)
            write_sheet_tab(ss_id, tab_title, sheet_data)
        except Exception as e:
            logger.error(f"Refresh publisher tab {tab_title}: {e}")

    now = _dt.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    try:
        set_app_properties(report_id, {"mdLastRefreshed": now})
    except Exception as e:
        logger.error(f"Failed to update lastRefreshed for {report_id}: {e}")
    return {"success": True, "lastRefreshed": now}


@app.delete("/api/reporting/publisher/{report_id}")
def delete_publisher_report(report_id: str):
    if not _get_drive_report(report_id, "publisher"):
        legacy = next((r for r in parse_pub_registry(_read_registry(PUBLISHER_REGISTRY_SHEET))
                       if r["id"] == report_id), None)
        if legacy:
            raise HTTPException(status_code=400, detail=(
                "This is a legacy report owned by another account and can't be "
                "deleted from here until edit access is granted."
            ))
    try:
        trash_file(report_id)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/reporting/migrate-to-drive")
def migrate_reports_to_drive():
    """One-time backfill: copy existing KPI-registry reports into the Drive folder.

    Reads the old advertiser + publisher registries (read access still works on
    the KPI spreadsheet), and for each report sets appProperties + moves the
    spreadsheet into the reports folder. Idempotent — safe to run multiple times.
    """
    import json as _json

    folder_id = ensure_reports_folder()
    migrated = {"advertiser": 0, "publisher": 0, "errors": []}

    # Advertiser reports
    try:
        adv = parse_adv_registry(_read_registry(ADVERTISER_REGISTRY_SHEET))
    except Exception as e:
        adv = []
        migrated["errors"].append(f"read adv registry: {e}")
    for r in adv:
        ss_id = r.get("spreadsheetId", "")
        if not ss_id:
            continue
        try:
            set_app_properties(ss_id, {
                "mdType": "advertiser",
                "mdReportName": r.get("reportName", ""),
                "mdAdvertiser": r.get("advertiser", ""),
                "mdDateFrom": r.get("dateFrom", "All"),
                "mdViews": ",".join(r.get("views", [])),
                "mdSelectedColumns": ",".join(r.get("selectedColumns", [])),
                "mdCreatedBy": r.get("createdBy", ""),
                "mdLastRefreshed": r.get("lastRefreshed", ""),
            })
            move_to_folder(ss_id, folder_id)
            migrated["advertiser"] += 1
        except Exception as e:
            migrated["errors"].append(f"adv {ss_id}: {e}")

    # Publisher reports
    try:
        pub = parse_pub_registry(_read_registry(PUBLISHER_REGISTRY_SHEET))
    except Exception as e:
        pub = []
        migrated["errors"].append(f"read pub registry: {e}")
    for r in pub:
        ss_id = r.get("spreadsheetId", "")
        if not ss_id:
            continue
        try:
            set_app_properties(ss_id, {
                "mdType": "publisher",
                "mdReportName": r.get("reportName", ""),
                "mdPublisher": r.get("publisher", ""),
                "mdAdvertisersJson": _json.dumps(r.get("advertisers", [])),
                "mdDateFrom": r.get("dateFrom", "All"),
                "mdDateTo": r.get("dateTo", ""),
                "mdReportingLevels": ",".join(r.get("reportingLevels", [])),
                "mdCreatedBy": r.get("createdBy", ""),
                "mdLastRefreshed": r.get("lastRefreshed", ""),
            })
            move_to_folder(ss_id, folder_id)
            migrated["publisher"] += 1
        except Exception as e:
            migrated["errors"].append(f"pub {ss_id}: {e}")

    return migrated


# ── Registry mutation helpers ─────────────────────────────────────────────────

def _update_registry_field(sheet_name: str, headers: List[str], report_id: str, field: str, value: str):
    """Update a single field in a registry row identified by ID."""
    try:
        raw = _read_registry(sheet_name)
        if len(raw) < 2:
            return
        hdr = [str(h).strip() for h in raw[0]]
        id_i = hdr.index("ID") if "ID" in hdr else 0
        field_i = hdr.index(field) if field in hdr else -1
        if field_i < 0:
            return
        for row_num, row in enumerate(raw[1:], start=2):
            if len(row) > id_i and str(row[id_i]).strip() == report_id:
                col_letter = chr(65 + field_i)
                cell_ref = f"{sheet_name}!{col_letter}{row_num}"
                update_range(KPI_SPREADSHEET_ID, cell_ref, [[value]])
                return
    except Exception as e:
        logger.error(f"Failed to update registry field {field}: {e}")


def _delete_from_registry(sheet_name: str, headers: List[str], report_id: str):
    """Soft-delete by clearing the row (overwrite ID with empty string)."""
    try:
        raw = _read_registry(sheet_name)
        if len(raw) < 2:
            raise HTTPException(status_code=404, detail="Report not found")
        hdr = [str(h).strip() for h in raw[0]]
        id_i = hdr.index("ID") if "ID" in hdr else 0
        for row_num, row in enumerate(raw[1:], start=2):
            if len(row) > id_i and str(row[id_i]).strip() == report_id:
                # Clear all cells in the row
                empty_row = [[""] * len(hdr)]
                row_range = f"{sheet_name}!A{row_num}:{chr(64 + len(hdr))}{row_num}"
                update_range(KPI_SPREADSHEET_ID, row_range, empty_row)
                return {"success": True}
        raise HTTPException(status_code=404, detail="Report not found")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Dashboard View Tracker ────────────────────────────────────────────────────
VIEWS_SHEET = "Dashboard_Views"
VIEWS_HEADERS = ["Timestamp", "Identifier", "User_Agent"]

# Dedicated spreadsheet for view tracking (owned by the service account,
# so the backend always has full write access — unlike the KPI spreadsheet
# which is shared read-only).
_VIEWS_SPREADSHEET_ID: Optional[str] = os.environ.get("VIEWS_SPREADSHEET_ID")
_VIEWS_SS_ID_FILE = Path(__file__).parent / "views_spreadsheet_id.txt"


def _get_views_spreadsheet_id() -> str:
    """Return the ID of the dedicated views spreadsheet, creating it if needed."""
    global _VIEWS_SPREADSHEET_ID

    if _VIEWS_SPREADSHEET_ID:
        return _VIEWS_SPREADSHEET_ID

    # Check if we persisted the ID from a previous run
    if _VIEWS_SS_ID_FILE.exists():
        _VIEWS_SPREADSHEET_ID = _VIEWS_SS_ID_FILE.read_text().strip()
        if _VIEWS_SPREADSHEET_ID:
            logger.info(f"Loaded views spreadsheet ID from file: {_VIEWS_SPREADSHEET_ID}")
            return _VIEWS_SPREADSHEET_ID

    # Create a brand-new spreadsheet under the service account's Drive
    result = create_spreadsheet("Media Dashboard - View Tracking")
    _VIEWS_SPREADSHEET_ID = result["spreadsheetId"]
    logger.info(
        f"Created dedicated views spreadsheet: {result['spreadsheetUrl']}\n"
        f"  Set VIEWS_SPREADSHEET_ID={_VIEWS_SPREADSHEET_ID} as an env var to pin this."
    )

    # Persist so future pod restarts reuse the same sheet
    try:
        _VIEWS_SS_ID_FILE.write_text(_VIEWS_SPREADSHEET_ID)
    except Exception as e:
        logger.warning(f"Could not persist views spreadsheet ID to file: {e}")

    return _VIEWS_SPREADSHEET_ID


def _ensure_views_sheet():
    """Make sure the Dashboard_Views tab exists (with headers) in the dedicated spreadsheet."""
    try:
        from sheets_client import get_sheet_names
        ss_id = _get_views_spreadsheet_id()
        names = get_sheet_names(ss_id)
        if VIEWS_SHEET not in names:
            ensure_sheet_tab(ss_id, VIEWS_SHEET)
            append_rows(ss_id, VIEWS_SHEET, [VIEWS_HEADERS])
    except Exception as e:
        logger.warning(f"Could not ensure views sheet: {e}")


@app.post("/api/views/record")
def record_view(request: Request):
    """Record a dashboard page view."""
    from datetime import datetime as _dt
    import hashlib

    # Use IP + User-Agent hash as anonymous identifier
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")
    identifier = hashlib.md5(f"{ip}:{ua}".encode()).hexdigest()[:12]
    now = _dt.utcnow().strftime("%Y-%m-%d %H:%M:%S")

    try:
        ss_id = _get_views_spreadsheet_id()
        _ensure_views_sheet()
        append_rows(ss_id, VIEWS_SHEET, [[now, identifier, ua[:120]]])
    except Exception as e:
        logger.warning(f"Failed to record view: {e}")

    return {"recorded": True}


@app.get("/api/views/stats")
def get_view_stats():
    """Return dashboard view stats: today, yesterday, this week, last week, this/last month, this year, unique, total."""
    from datetime import datetime as _dt, timedelta

    try:
        ss_id = _get_views_spreadsheet_id()
        raw = read_range(ss_id, f"{VIEWS_SHEET}!A:C")
    except Exception:
        raw = []

    if len(raw) <= 1:
        return _empty_stats()

    rows = raw[1:]  # skip header
    now = _dt.utcnow()
    today = now.date()
    yesterday = today - timedelta(days=1)

    # Week boundaries (Monday-based)
    this_week_start = today - timedelta(days=today.weekday())
    last_week_start = this_week_start - timedelta(days=7)
    last_week_end = this_week_start - timedelta(days=1)

    # Month boundaries
    this_month = today.replace(day=1)
    if this_month.month == 1:
        last_month = this_month.replace(year=this_month.year - 1, month=12)
    else:
        last_month = this_month.replace(month=this_month.month - 1)

    counts = {
        "today": 0, "yesterday": 0,
        "thisWeek": 0, "lastWeek": 0,
        "thisMonth": 0, "lastMonth": 0,
        "thisYear": 0, "total": 0,
    }
    identifiers = set()

    from data_logic import _parse_date
    for row in rows:
        if not row:
            continue
        ts_str = str(row[0]).strip() if len(row) > 0 else ""
        identifier = str(row[1]).strip() if len(row) > 1 else ""

        # Parse timestamp
        try:
            ts = _dt.strptime(ts_str[:19], "%Y-%m-%d %H:%M:%S")
            d = ts.date()
        except Exception:
            continue

        counts["total"] += 1
        if identifier:
            identifiers.add(identifier)

        if d == today:
            counts["today"] += 1
        if d == yesterday:
            counts["yesterday"] += 1
        if this_week_start <= d <= today:
            counts["thisWeek"] += 1
        if last_week_start <= d <= last_week_end:
            counts["lastWeek"] += 1
        if d >= this_month:
            counts["thisMonth"] += 1
        if last_month <= d < this_month:
            counts["lastMonth"] += 1
        if d.year == today.year:
            counts["thisYear"] += 1

    counts["uniqueViews"] = len(identifiers)
    return counts


def _empty_stats():
    return {
        "today": 0, "yesterday": 0,
        "thisWeek": 0, "lastWeek": 0,
        "thisMonth": 0, "lastMonth": 0,
        "thisYear": 0,
        "uniqueViews": 0, "total": 0,
    }


# ── Cache control ─────────────────────────────────────────────────────────────
@app.post("/api/cache/refresh")
def refresh_cache():
    """Force-refresh the master report cache (useful for testing)."""
    try:
        result = load_master_report_cache(force=True)
        return {"message": "Cache refreshed", "rowCount": result["row_count"]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Serve React frontend (must be LAST — catch-all after all API routes) ──────
STATIC_DIR = Path(__file__).parent / "static"
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR / "static")), name="static")

    @app.get("/favicon.svg", include_in_schema=False)
    async def favicon():
        return FileResponse(str(STATIC_DIR / "favicon.svg"), media_type="image/svg+xml")

    @app.get("/", include_in_schema=False)
    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str = ""):
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index), headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
        raise HTTPException(status_code=404)


# ── Helpers ───────────────────────────────────────────────────────────────────
def _build_filters(advertiser, publisher, industry, segment, brand, offer, date_from, date_to) -> dict:
    f = {}
    if advertiser:
        f["advertiser"] = advertiser
    if publisher:
        f["publisher"] = publisher
    if industry:
        f["industry"] = industry
    if segment:
        f["segment"] = segment
    if brand:
        f["brand"] = brand
    if offer:
        f["offer"] = offer
    if date_from:
        f["dateFrom"] = date_from
    if date_to:
        f["dateTo"] = date_to
    return f
