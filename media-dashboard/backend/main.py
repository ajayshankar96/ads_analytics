"""
Razorpay Media Dashboard — FastAPI backend.

Run locally:
    cd backend
    uvicorn main:app --reload --port 8000
"""

import json
import logging
import os
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from cache import cache, load_master_report_cache, start_background_refresh, MASTER_CACHE_KEY
from data_logic import (
    apply_filters,
    calculate_aggregates,
    compute_data_freshness,
    get_advertiser_health,
    get_advertiser_performance,
    get_breakdowns,
    get_budget_data,
    get_filter_options,
    get_filter_relationships,
    get_monthly_spend_analysis,
    get_publisher_performance,
    get_time_series,
    prepare_table_data,
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

def load_from_postgres():
    """Load campaign metrics from Postgres in the same format as load_master_report_cache()."""
    import time
    now = time.time()
    if _pg_cache["data"] and (now - _pg_cache["ts"]) < 60:
        return _pg_cache["data"]

    from sqlalchemy import create_engine
    db_url = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql+pg8000://").replace("postgresql://", "postgresql+pg8000://")
    if not db_url:
        return load_master_report_cache()
    try:
        eng = create_engine(db_url, pool_pre_ping=True)
        with eng.connect() as conn:
            rows_raw = conn.execute(text("SELECT advertiser, publisher, '' as industry, date::text, '' as week, '' as month_start, segment, '' as adv_segment, '' as cohort, advertiser as brand, '' as offer, impressions, distribution, clicks, CASE WHEN impressions > 0 THEN clicks::float/impressions*100 ELSE 0 END as ctr, orders_pub, scratches, coins_burned, redirections, spends, CASE WHEN impressions > 0 THEN spends/impressions*1000 ELSE 0 END as cpm, CASE WHEN clicks > 0 THEN spends/clicks ELSE 0 END as cpc, publisher_spends, advertiser_spends, advertiser_metrics FROM rmn_campaign_metrics ORDER BY date")).fetchall()

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

        adv_metric_cols = sorted(all_adv_metrics)
        full_headers = headers + adv_metric_cols

        full_rows = []
        for row, metrics in parsed_rows:
            try:
                current_adv_spend = float(str(row[23]).replace(",", "").strip() or 0)
            except (ValueError, TypeError):
                current_adv_spend = 0.0
            if current_adv_spend == 0:
                row[23] = metrics.get("Revenue", metrics.get("revenue", row[23]))
            for col in adv_metric_cols:
                row.append(str(metrics.get(col, "-")))
            full_rows.append([str(v) for v in row])

        result = {"headers": full_headers, "rows": full_rows, "cache_age": 0}
        _pg_cache["data"] = result
        _pg_cache["ts"] = now
        return result
    except Exception as e:
        logger.warning(f"Postgres load failed, falling back to sheet: {e}")
        return load_master_report_cache()


_active_source = {"value": "postgres"}  # default to postgres

def load_data(source: str = None):
    """Load data from either Sheet cache or Postgres."""
    src = source or _active_source["value"]
    if src == "postgres":
        return load_from_postgres()
    return load_master_report_cache()


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
        target_tab = tab or tabs[0]
        result = service.spreadsheets().values().get(
            spreadsheetId=file_id, range=f"'{target_tab}'!A1:Z20"
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
async def get_column_mappings(name: Optional[str] = None, type: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Get saved column mappings."""
    sql = "SELECT id, name, type, sheet_url, tab_name, header_row, data_start_row, mapping, format_type, created_at FROM rmn_column_mappings"
    params = {}
    clauses = []
    if name:
        clauses.append("name = :name"); params["name"] = name
    if type:
        clauses.append("type = :type"); params["type"] = type
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY updated_at DESC"
    result = await db.execute(text(sql), params)
    rows = result.fetchall()
    return {"mappings": [
        {"id": r[0], "name": r[1], "type": r[2], "sheet_url": r[3], "tab_name": r[4],
         "header_row": r[5], "data_start_row": r[6], "mapping": json.loads(r[7]) if r[7] else {},
         "format_type": r[8], "created_at": r[9].isoformat() if r[9] else None}
        for r in rows
    ]}


@app.post("/api/column-mappings")
async def save_column_mapping(request: Request, db: AsyncSession = Depends(get_db)):
    """Save or update a column mapping."""
    body = await request.json()
    name = body.get("name", "")
    map_type = body.get("type", "")
    if not name or not map_type:
        raise HTTPException(status_code=400, detail="name and type are required")

    mapping_json = json.dumps(body.get("mapping", {}))

    # Upsert: delete existing for this name+type, insert new
    await db.execute(text("DELETE FROM rmn_column_mappings WHERE name = :name AND type = :type"),
                     {"name": name, "type": map_type})
    await db.execute(text("""
        INSERT INTO rmn_column_mappings (name, type, sheet_url, tab_name, header_row, data_start_row, mapping, format_type, updated_at)
        VALUES (:name, :type, :sheet_url, :tab_name, :header_row, :data_start_row, :mapping, :format_type, NOW())
    """), {
        "name": name, "type": map_type,
        "sheet_url": body.get("sheet_url", ""),
        "tab_name": body.get("tab_name", ""),
        "header_row": body.get("header_row", 1),
        "data_start_row": body.get("data_start_row", 2),
        "mapping": mapping_json,
        "format_type": body.get("format_type", "vertical"),
    })
    await db.commit()
    return {"success": True}


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
    result = get_advertiser_performance(data["rows"], data["headers"], filters, view_mode=viewMode)
    result["cacheAge"] = data.get("cache_age", 0)
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
    result = get_publisher_performance(data["rows"], data["headers"], filters, view_mode=viewMode)
    result["cacheAge"] = data.get("cache_age", 0)
    return result


# ── Advertiser Health ─────────────────────────────────────────────────────────
@app.get("/api/advertiser-health")
def advertiser_health(viewMode: str = "weekly"):
    data = load_data()
    result = get_advertiser_health(data["rows"], data["headers"], view_mode=viewMode)
    result["cacheAge"] = data.get("cache_age", 0)
    return result


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


# ── Campaign Onboarding ───────────────────────────────────────────────────────
ONBOARDING_SHEET = "Sheet1"

class OnboardingSubmitRequest(BaseModel):
    campaign_type: str
    advertiser: str
    publisher: str
    advertiser_industry: str
    brand: str
    offer: str
    advertiser_data_url: str
    publisher_data_url: str
    goals_json: str
    metrics_json: str
    segment_pub: str
    segment_adv: str
    additional_context: str
    campaign_details_json: str


@app.post("/api/onboarding/submit")
def onboarding_submit(req: OnboardingSubmitRequest):
    """Append a new campaign onboarding row to Sheet1 of the KPI spreadsheet."""
    import json as _json_mod
    from datetime import datetime

    # Validate JSON fields
    for field_name, value in [
        ("goals_json", req.goals_json),
        ("metrics_json", req.metrics_json),
        ("campaign_details_json", req.campaign_details_json),
    ]:
        try:
            _json_mod.loads(value)
        except Exception:
            raise HTTPException(status_code=400, detail=f"{field_name} is not valid JSON")

    # Build row matching Apps Script 17-column layout (A-Q)
    row = [
        req.campaign_type,           # A: Campaign Type
        req.advertiser,              # B: Advertiser
        req.publisher,               # C: Publisher
        req.advertiser_industry,     # D: Advertiser Industry
        req.brand,                   # E: Brand
        req.offer,                   # F: Offer
        req.advertiser_data_url,     # G: Advertiser Data URL
        req.publisher_data_url,      # H: Publisher Data URL
        "",                          # I: Merged Sheet URL (empty — filled later)
        req.goals_json,              # J: Goals JSON
        req.metrics_json,            # K: Metrics JSON
        req.segment_pub,             # L: Segment Pub
        req.segment_adv,             # M: Segment Adv
        req.additional_context,      # N: Additional Context
        req.campaign_details_json,   # O: Campaign Details JSON
        "",                          # P: Changes (empty)
        "Pending",                   # Q: Status
    ]

    try:
        append_rows(KPI_SPREADSHEET_ID, ONBOARDING_SHEET, [row])
        return {"success": True, "message": "Campaign submitted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class SendCampaignEmailRequest(BaseModel):
    recipients: List[str]
    subject: str = ""
    body: str = ""           # final (user-edited) body to send
    is_html: bool = False    # True when body is rich-text HTML from the editor
    cc: Optional[List[str]] = None


@app.post("/api/onboarding/send-email")
def onboarding_send_email(req: SendCampaignEmailRequest):
    """Send the user-reviewed campaign email (subject + body) to the recipients."""
    from sheets_client import send_email

    recips = [r.strip() for r in req.recipients if r and r.strip()]
    if not recips:
        raise HTTPException(status_code=400, detail="At least one recipient email is required")
    if not req.body.strip():
        raise HTTPException(status_code=400, detail="Email body is empty")

    subject = req.subject.strip() or "Campaign Details"
    cc = [c.strip() for c in (req.cc or []) if c and c.strip()] or None
    subtype = "html" if req.is_html else "plain"

    try:
        send_email(recips, subject, req.body, subtype=subtype, cc=cc)
        return {"success": True, "sent_to": recips}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {e}")


@app.get("/api/onboarding/campaigns")
def onboarding_campaigns():
    """Read all campaign onboarding rows from Sheet1."""
    try:
        rows = read_kpi_sheet(ONBOARDING_SHEET)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    if not rows:
        return {"campaigns": [], "total": 0}

    # Skip header row — actual sheet header starts with "Campaign type" (lowercase t)
    if rows and rows[0] and rows[0][0].lower().startswith("campaign"):
        data_rows = rows[1:]
    else:
        data_rows = rows

    campaigns = []
    for i, row in enumerate(data_rows):
        # Pad row to 19 columns (sheet has Status Date + Code Based Campaign beyond the 17 written by the form)
        padded = row + [""] * (19 - len(row))
        campaigns.append({
            "index": i,
            "campaign_type":         padded[0],
            "advertiser":            padded[1],
            "publisher":             padded[2],
            "advertiser_industry":   padded[3],
            "brand":                 padded[4],
            "offer":                 padded[5],
            "advertiser_data_url":   padded[6],
            "publisher_data_url":    padded[7],
            "merged_sheet_url":      padded[8],
            "goals_json":            padded[9],
            "metrics_json":          padded[10],
            "segment_pub":           padded[11],
            "segment_adv":           padded[12],
            "additional_context":    padded[13],
            "campaign_details_json": padded[14],
            "changes":               padded[15],
            "status":                padded[16],
            "status_date":           padded[17],
            "code_based_campaign":   padded[18],
        })

    return {"campaigns": campaigns, "total": len(campaigns)}


@app.get("/api/onboarding/templates")
def onboarding_templates():
    """Return JSON template strings matching the Apps Script getGoalsTemplate /
    getMetricsTemplate / getCampaignDetailsTemplate functions exactly."""
    import json as _json_mod

    goals_template = {
        "goals": {
            "daily": {
                "leads": 0
            },
            "weekly": {},
            "monthly": {},
            "date_agnostic": {
                "CPQQG": 0,
                "CPQL": 0
            }
        }
    }

    metrics_template = {
        "metrics_library": {
            "metric_1": {
                "display_name": "Leads",
                "definition": "Column Present in the sheet",
                "calculation": ""
            },
            "metric_2": {
                "display_name": "QL",
                "definition": "Column Present in advertiser Sheet",
                "calculation": ""
            }
        }
    }

    campaign_details_template = {
        "campaign_details": {
            "brand_name": "",
            "offer_title": "",
            "tc": "",
            "how_to_redeem": "",
            "tracking": {
                "landing_link": "",
                "utm_redirection_link": ""
            },
            "incentives": {
                "codes": [],
                "codes_validity": {
                    "start_date": "",
                    "expiry_date": ""
                }
            },
            "assets": {
                "creative_url": "",
                "logo_url": ""
            },
            "targeting": {
                "Segment_link": "",
                "Segment Description": "",
                "Size": "",
                "Cohort Name": ""
            },
            "budget_and_metrics": {
                "total_budget": 0,
                "cpc": 0,
                "cpm": 0,
                "publisher_spends_calc": "Spends",
                "advertiser_spends_calc": "Spends",
                "committed_kpi": "NO",
                "committed_kpi_config": {
                    "metric": "",
                    "operation": "",
                    "goal": "",
                    "formula": ""
                }
            },
            "Rzp_cut": 0
        }
    }

    return {
        "goals": _json_mod.dumps(goals_template, indent=2),
        "metrics": _json_mod.dumps(metrics_template, indent=2),
        "campaign_details": _json_mod.dumps(campaign_details_template, indent=2),
    }


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
# A SELECT-only SQL console for admins (ADMIN_EMAILS). Enforced read-only at the
# DB level (READ ONLY transaction) + single-statement SELECT/WITH guard, capped
# rows and a statement timeout.

def _require_admin(request: Request):
    email = getattr(request.state, "user_email", None)
    if auth_enabled() and not is_admin(email):
        raise HTTPException(status_code=403, detail="Admin access required")


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
async def console_access(request: Request):
    email = getattr(request.state, "user_email", None)
    return {"is_admin": (not auth_enabled()) or is_admin(email)}


@app.get("/api/admin/tables")
async def admin_tables(request: Request):
    _require_admin(request)
    async with engine.connect() as conn:
        res = await conn.execute(text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' ORDER BY table_name"
        ))
        return {"tables": [r[0] for r in res.fetchall()]}


@app.post("/api/admin/query")
async def admin_query(req: QueryRequest, request: Request):
    _require_admin(request)
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
    adv = await repo.create_advertiser(db, payload)
    return {"success": True, "advertiser": repo.advertiser_dict(adv)}


@app.patch("/api/advertisers/{adv_id}")
async def update_advertiser(adv_id: str, payload: dict, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    adv = await repo.update_advertiser(db, adv, payload)
    return {"success": True, "advertiser": repo.advertiser_dict(adv)}


@app.post("/api/advertisers/{adv_id}/submit")
async def submit_advertiser(adv_id: str, payload: dict = None, db: AsyncSession = Depends(get_db)):
    adv = await repo.get_advertiser(db, adv_id)
    if not adv:
        raise HTTPException(status_code=404, detail=f"advertiser {adv_id} not found")
    merged = dict(payload or {})
    merged["status"] = "ONBOARDED"
    adv = await repo.update_advertiser(db, adv, merged)
    return {"success": True, "advertiser": repo.advertiser_dict(adv)}


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


@app.post("/api/workflow/campaigns/{campaign_id}/clone")
async def clone_campaign(campaign_id: str, db: AsyncSession = Depends(get_db)):
    source = await repo.get_campaign(db, campaign_id)
    if not source:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    new_camp = await repo.clone_campaign(db, source)
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


@app.get("/api/roles")
async def list_roles(db: AsyncSession = Depends(get_db)):
    roles = await repo.list_user_roles(db)
    return {"roles": roles}


class SetRoleRequest(BaseModel):
    email: str
    role: str
    name: Optional[str] = None


@app.post("/api/roles")
async def set_role(req: SetRoleRequest, db: AsyncSession = Depends(get_db)):
    if req.role not in repo.VALID_ROLES:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(repo.VALID_ROLES)}")
    result = await repo.set_user_role(db, email=req.email, role=req.role, name=req.name)
    return {"success": True, "user": result}


@app.delete("/api/roles/{email}")
async def delete_role(email: str, db: AsyncSession = Depends(get_db)):
    await repo.delete_user_role(db, email)
    return {"success": True}


# ── Publishers & Budget Allocation ────────────────────────────────────────────

@app.get("/api/publishers")
async def list_publishers(db: AsyncSession = Depends(get_db)):
    pubs = await repo.list_publishers(db)
    return {"publishers": pubs}


class CreatePublisherRequest(BaseModel):
    name: str
    code: str


@app.post("/api/publishers")
async def create_publisher(req: CreatePublisherRequest, db: AsyncSession = Depends(get_db)):
    pub = await repo.create_publisher(db, name=req.name, code=req.code)
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

def _pg_where(params, advertiser, publisher, dateFrom, dateTo):
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
    if dateFrom:
        clauses.append("date >= :dateFrom")
        try: params["dateFrom"] = _dt.strptime(dateFrom, "%Y-%m-%d").date()
        except Exception: params["dateFrom"] = dateFrom
    if dateTo:
        clauses.append("date <= :dateTo")
        try: params["dateTo"] = _dt.strptime(dateTo, "%Y-%m-%d").date()
        except Exception: params["dateTo"] = dateTo
    return (" WHERE " + " AND ".join(clauses)) if clauses else ""


@app.get("/api/dashboard/pg/aggregates")
async def pg_aggregates(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    params = {}
    where = _pg_where(params, advertiser, publisher, dateFrom, dateTo)
    revenue_expr = "COALESCE((advertiser_metrics::jsonb->>'Revenue')::float, (advertiser_metrics::jsonb->>'revenue')::float, 0)"
    adv_spends_expr = f"CASE WHEN COALESCE(advertiser_spends, 0) != 0 THEN advertiser_spends ELSE {revenue_expr} END"
    sql = f"SELECT COALESCE(SUM(impressions),0) as impressions, COALESCE(SUM(clicks),0) as clicks, COALESCE(SUM(spends),0) as spends, COALESCE(SUM(orders_pub),0) as orders, COALESCE(SUM(publisher_spends),0) as pub_spends, COALESCE(SUM({adv_spends_expr}),0) as adv_spends, COALESCE(SUM({revenue_expr}),0) as adv_revenue, COUNT(DISTINCT date) as days FROM rmn_campaign_metrics{where}"
    row = (await db.execute(text(sql), params)).one()
    imp, clicks, spends, orders = int(row.impressions), int(row.clicks), float(row.spends), int(row.orders)
    # Count distinct advertisers/publishers
    count_sql = f"SELECT COUNT(DISTINCT advertiser) as adv_count, COUNT(DISTINCT publisher) as pub_count, COALESCE(SUM(distribution),0) as distribution, COALESCE(SUM(redirections),0) as redirections, COUNT(*) as total_rows FROM rmn_campaign_metrics{where}"
    counts = (await db.execute(text(count_sql), params)).one()
    dist = int(counts.distribution)
    return {
        "impressions": imp, "distribution": dist, "impressionsAndDistribution": imp + dist,
        "clicks": clicks, "spends": round(spends, 2), "orders": orders,
        "ctr": round((clicks / imp * 100) if imp > 0 else 0, 2),
        "cpm": round((spends / imp * 1000) if imp > 0 else 0, 2),
        "cpc": round((spends / clicks) if clicks > 0 else 0, 2),
        "publisher_spends": round(float(row.pub_spends), 2),
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
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    params = {}
    where = _pg_where(params, advertiser, publisher, dateFrom, dateTo)
    sql = f"SELECT date, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spends) as spends, SUM(orders_pub) as orders FROM rmn_campaign_metrics{where} GROUP BY date ORDER BY date"
    rows = (await db.execute(text(sql), params)).all()
    return {
        "timeSeries": [{"date": r.date.isoformat(), "impressions": int(r.impressions or 0), "clicks": int(r.clicks or 0), "spends": round(float(r.spends or 0), 2), "orders": int(r.orders or 0)} for r in rows],
        "source": "postgres",
    }


@app.get("/api/dashboard/pg/breakdowns")
async def pg_breakdowns(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    params_adv = {}
    where_adv = _pg_where(params_adv, advertiser, publisher, dateFrom, dateTo)
    sql_adv = f"SELECT advertiser as name, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spends) as spends FROM rmn_campaign_metrics{where_adv} GROUP BY advertiser ORDER BY spends DESC"
    adv_rows = (await db.execute(text(sql_adv), params_adv)).all()

    params_pub = {}
    where_pub = _pg_where(params_pub, advertiser, publisher, dateFrom, dateTo)
    sql_pub = f"SELECT publisher as name, SUM(impressions) as impressions, SUM(clicks) as clicks, SUM(spends) as spends FROM rmn_campaign_metrics{where_pub} GROUP BY publisher ORDER BY spends DESC"
    pub_rows = (await db.execute(text(sql_pub), params_pub)).all()

    return {
        "breakdowns": {
            "by_advertiser": [{"name": r.name, "impressions": int(r.impressions or 0), "clicks": int(r.clicks or 0), "spends": round(float(r.spends or 0), 2)} for r in adv_rows],
            "by_publisher": [{"name": r.name, "impressions": int(r.impressions or 0), "clicks": int(r.clicks or 0), "spends": round(float(r.spends or 0), 2)} for r in pub_rows],
        },
        "source": "postgres",
    }


@app.get("/api/dashboard/pg/table")
async def pg_table(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    offset: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    params = {}
    where = _pg_where(params, advertiser, publisher, dateFrom, dateTo)
    count_sql = f"SELECT COUNT(*) as cnt FROM rmn_campaign_metrics{where}"
    total = (await db.execute(text(count_sql), params)).scalar() or 0

    params2 = dict(params)
    params2["lim"] = limit
    params2["off"] = offset
    sql = f"SELECT date, advertiser, publisher, segment, impressions, clicks, spends, orders_pub, publisher_spends, advertiser_spends, advertiser_metrics FROM rmn_campaign_metrics{where} ORDER BY date DESC LIMIT :lim OFFSET :off"
    rows = (await db.execute(text(sql), params2)).all()
    return {
        "rows": [{"date": r.date.isoformat(), "advertiser": r.advertiser, "publisher": r.publisher, "segment": r.segment, "impressions": r.impressions, "clicks": r.clicks, "spends": r.spends, "orders_pub": r.orders_pub, "publisher_spends": r.publisher_spends, "advertiser_spends": r.advertiser_spends, "advertiser_metrics": json.loads(r.advertiser_metrics) if r.advertiser_metrics else {}} for r in rows],
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
    Derives formulas from Agreement buy_type + Campaign cpc_cpd (sales/ops pipeline)."""
    import etl_worker
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")

    # Derive formulas from sales/ops pipeline data
    buy_type = ''
    rate = 0.0
    if campaign.agreement_id:
        ag_result = await db.execute(
            select(models.Agreement.buy_type).where(models.Agreement.id == campaign.agreement_id)
        )
        ag_row = ag_result.scalar()
        if ag_row:
            buy_type = ag_row
    if campaign.cpc_cpd:
        try:
            rate = float(str(campaign.cpc_cpd).replace(',', '').strip())
        except (ValueError, TypeError):
            pass

    pub_formula, adv_formula = etl_worker._resolve_spend_formulas(buy_type, rate)
    metrics_config = json.loads(campaign.metrics_json or '{}')
    adv_metric_names = metrics_config.get('advertiser_metrics', [])

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

        new_pub = etl_worker._evaluate_formula(pub_formula, row_data) if pub_formula else row_data['Spends']
        if adv_formula:
            new_adv = etl_worker._evaluate_formula(adv_formula, row_data)
        else:
            new_adv = etl_worker._fallback_advertiser_spends(row_data)
        row_data['Publisher_Spends'] = new_pub
        row_data['Advertiser_Spends'] = new_adv
        computed = etl_worker._compute_advertiser_metrics(adv_metric_names, row_data)
        adv_metrics.update(computed)

        m.publisher_spends = new_pub
        m.advertiser_spends = new_adv
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

    pub_total = 0.0
    adv_total = 0.0
    for m in metric_rows:
        for cfg in configs:
            if cfg.side == "publisher" and cfg.start_date <= m.date and (cfg.end_date is None or cfg.end_date >= m.date):
                if cfg.billing_model == "cpc":
                    pub_total += cfg.rate * (m.clicks or 0)
                elif cfg.billing_model == "cpd":
                    pub_total += cfg.rate
                elif cfg.billing_model == "cpm":
                    pub_total += cfg.rate * (m.impressions or 0) / 1000.0
                elif cfg.billing_model == "roas":
                    adv_metrics = json.loads(m.advertiser_metrics) if m.advertiser_metrics else {}
                    revenue = float(adv_metrics.get("revenue", adv_metrics.get("Revenue", 0)))
                    pub_total += revenue / cfg.rate if cfg.rate else 0
                break
        for cfg in configs:
            if cfg.side == "advertiser" and cfg.start_date <= m.date and (cfg.end_date is None or cfg.end_date >= m.date):
                if cfg.billing_model == "cpc":
                    adv_total += cfg.rate * (m.clicks or 0)
                elif cfg.billing_model == "cpd":
                    adv_total += cfg.rate
                elif cfg.billing_model == "cpm":
                    adv_total += cfg.rate * (m.impressions or 0) / 1000.0
                elif cfg.billing_model == "roas":
                    adv_metrics = json.loads(m.advertiser_metrics) if m.advertiser_metrics else {}
                    revenue = float(adv_metrics.get("revenue", adv_metrics.get("Revenue", 0)))
                    adv_total += revenue / cfg.rate if cfg.rate else 0
                break

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


@app.post("/api/workflow/campaigns/{campaign_id}/billing")
async def add_billing_config(campaign_id: str, req: BillingConfigRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Add or change billing config for a campaign side."""
    from datetime import date as dt_date, timedelta
    new_start = dt_date.fromisoformat(req.start_date)
    user_email = getattr(request.state, "user_email", None)

    # Close any open config for this side that starts before the new one
    result = await db.execute(
        select(models.BillingConfig)
        .where(models.BillingConfig.campaign_id == campaign_id)
        .where(models.BillingConfig.side == req.side)
        .where(models.BillingConfig.end_date.is_(None))
    )
    open_configs = result.scalars().all()
    for oc in open_configs:
        if oc.start_date < new_start:
            oc.end_date = new_start - timedelta(days=1)

    new_config = models.BillingConfig(
        campaign_id=campaign_id,
        side=req.side,
        billing_model=req.billing_model,
        rate=req.rate,
        start_date=new_start,
        created_by=user_email,
    )
    db.add(new_config)
    await db.commit()
    return {"success": True}


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
                "buy_type": buy_type_str,
                "rate": campaign.cpc_cpd or "",
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
async def workflow_transition(campaign_id: str, req: TransitionRequest, db: AsyncSession = Depends(get_db)):
    campaign = await repo.get_campaign(db, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail=f"campaign {campaign_id} not found")
    from_stage = campaign.current_stage
    try:
        campaign = await repo.transition_campaign(
            db, campaign, to_stage=req.to_stage, actor_email=req.actor_email,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

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
    data = load_data()
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

    data = load_data()
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

    data = load_data()
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
    data = load_data()
    from reporting_logic import PUB_FIXED_METRICS
    extra = get_publisher_extra_metrics(data["headers"])
    return {"fixedMetrics": PUB_FIXED_METRICS, "extraMetrics": extra}


@app.get("/api/reporting/publisher/advertisers")
def get_pub_advertisers(
    publisher: str,
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
):
    data = load_data()
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

    data = load_data()
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

    data = load_data()
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
