"""
Razorpay Media Dashboard — FastAPI backend.

Run locally:
    cd backend
    uvicorn main:app --reload --port 8000
"""

import logging
import os
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

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
    update_range,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Razorpay Media Dashboard API", version="1.0.0")

# ── CORS ─────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


# ── Health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    age = cache.age(MASTER_CACHE_KEY)
    return {
        "status": "ok",
        "cache": "warm" if age is not None else "cold",
        "cacheAgeSecs": age,
    }


# ── Filters ───────────────────────────────────────────────────────────────────
@app.get("/api/filters")
def get_filters(
    advertiser: Optional[List[str]] = Query(None),
    publisher: Optional[List[str]] = Query(None),
):
    data = load_master_report_cache()
    filters = {}
    if advertiser:
        filters["advertiser"] = advertiser
    if publisher:
        filters["publisher"] = publisher
    return get_filter_options(data, filters)


@app.get("/api/filter-relationships")
def filter_relationships():
    data = load_master_report_cache()
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
    data = load_master_report_cache()
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
    data = load_master_report_cache()
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
    data = load_master_report_cache()
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
    data = load_master_report_cache()
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
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    viewMode: str = "weekly",
):
    data = load_master_report_cache()
    filters = {"advertisers": advertisers or [], "dateFrom": dateFrom, "dateTo": dateTo}
    result = get_advertiser_performance(data["rows"], data["headers"], filters, view_mode=viewMode)
    result["cacheAge"] = data.get("cache_age", 0)
    return result


@app.get("/api/publisher-performance")
def publisher_performance(
    publishers: Optional[List[str]] = Query(None),
    segments: Optional[List[str]] = Query(None),
    dateFrom: Optional[str] = None,
    dateTo: Optional[str] = None,
    viewMode: str = "weekly",
):
    data = load_master_report_cache()
    filters = {
        "publishers": publishers or [],
        "segments": segments or [],
        "dateFrom": dateFrom,
        "dateTo": dateTo,
    }
    result = get_publisher_performance(data["rows"], data["headers"], filters, view_mode=viewMode)
    result["cacheAge"] = data.get("cache_age", 0)
    return result


# ── Advertiser Health ─────────────────────────────────────────────────────────
@app.get("/api/advertiser-health")
def advertiser_health(viewMode: str = "weekly"):
    data = load_master_report_cache()
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

    data = load_master_report_cache()
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

    data = load_master_report_cache()
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
    data = load_master_report_cache()
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
    data = load_master_report_cache()
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
            return FileResponse(str(index))
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
