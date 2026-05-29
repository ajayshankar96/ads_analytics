"""
Data processing logic — port of Code.gs aggregation/filter functions.
All functions operate on raw sheet rows (list of lists).
"""

import logging
from collections import defaultdict
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# ── Column index constants (mirrors Code.gs COL object) ─────────────────────
COL = {
    "ADVERTISER": 0,
    "PUBLISHER": 1,
    "ADVERTISER_INDUSTRY": 2,
    "DATE": 3,
    "WEEK_START": 4,
    "MONTH_START": 5,
    "SEGMENT": 6,
    "ADVERTISER_SEGMENT": 7,
    "COHORT_NAME": 8,
    "BRAND": 9,
    "OFFER": 10,
    "IMPRESSIONS": 11,
    "DISTRIBUTION": 12,
    "CLICKS": 13,
    "CTR": 14,
    "ORDERS_PUB": 15,
    "SCRATCHES": 16,
    "COINS_BURNED": 17,
    "REDIRECTIONS": 18,
    "SPENDS": 19,
    "CPM": 20,
    "CPC": 21,
    "PUBLISHER_SPENDS": 22,
    "ADVERTISER_SPENDS": 23,
    "CPQL": 24,
    "LEADS": 25,
    "QL": 26,
    "QQG": 27,
    "COUPON_ORDERS": 28,
    "COUPON_REVENUE": 29,
    "LC_ORDERS": 30,
    "LC_REV": 31,
    "ORDERS": 32,
    "REVENUE": 33,
}


# ── Helpers ──────────────────────────────────────────────────────────────────

def _to_float(val) -> float:
    """Convert a cell value to float, treating '-', '', None as 0."""
    if val in ("-", "", None):
        return 0.0
    try:
        return float(str(val).replace(",", ""))
    except (ValueError, TypeError):
        return 0.0


def _parse_date(val) -> Optional[date]:
    """Parse various date formats to a date object."""
    if not val:
        return None
    if isinstance(val, (datetime, date)):
        return val.date() if isinstance(val, datetime) else val
    s = str(val).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%Y/%m/%d", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _safe_str(val) -> str:
    return str(val).strip() if val not in (None, "") else ""


def _get_col(headers: List[str], name: str) -> int:
    """Find column index by name (case-insensitive, -1 if not found)."""
    name_lower = name.lower()
    for i, h in enumerate(headers):
        if h.lower() == name_lower:
            return i
    return -1


# ── Filtering ────────────────────────────────────────────────────────────────

def apply_filters(rows: List, filters: dict) -> List:
    """
    Filter rows based on user-selected criteria.
    Mirrors applyFilters_() from Code.gs.
    """
    if not filters:
        return rows

    adv_set: Optional[Set] = set(filters["advertiser"]) if filters.get("advertiser") else None
    pub_set: Optional[Set] = set(filters["publisher"]) if filters.get("publisher") else None
    ind_set: Optional[Set] = set(filters.get("industry", [])) or None
    seg_set: Optional[Set] = set(filters.get("segment", [])) or None
    brand_set: Optional[Set] = set(filters.get("brand", [])) or None
    offer_set: Optional[Set] = set(filters.get("offer", [])) or None
    date_from = _parse_date(filters.get("dateFrom"))
    date_to = _parse_date(filters.get("dateTo"))

    result = []
    for row in rows:
        # Pad short rows
        while len(row) <= max(COL["OFFER"], COL["DATE"]):
            row = list(row) + [""]

        if adv_set and _safe_str(row[COL["ADVERTISER"]]) not in adv_set:
            continue
        if pub_set and _safe_str(row[COL["PUBLISHER"]]) not in pub_set:
            continue
        if ind_set and _safe_str(row[COL["ADVERTISER_INDUSTRY"]]) not in ind_set:
            continue
        if seg_set and _safe_str(row[COL["SEGMENT"]]) not in seg_set:
            continue
        if brand_set and _safe_str(row[COL["BRAND"]]) not in brand_set:
            continue
        if offer_set and _safe_str(row[COL["OFFER"]]) not in offer_set:
            continue
        if date_from or date_to:
            row_date = _parse_date(row[COL["DATE"]])
            if row_date is None:
                continue
            if date_from and row_date < date_from:
                continue
            if date_to and row_date > date_to:
                continue
        result.append(row)

    return result


# ── Filter options ────────────────────────────────────────────────────────────

def get_filter_options(cached_data: dict, filters: dict = None) -> dict:
    """
    Return unique values for each filter dimension.
    Mirrors getFilterOptions() from Code.gs.
    """
    rows = cached_data["rows"]
    all_rows = rows  # for date range we always use full dataset

    if filters:
        rows = apply_filters(rows, filters)

    def unique_sorted(col_idx):
        vals = set()
        for row in all_rows:
            if len(row) > col_idx:
                v = _safe_str(row[col_idx])
                if v:
                    vals.add(v)
        return sorted(vals)

    dates = []
    for row in all_rows:
        if len(row) > COL["DATE"]:
            d = _parse_date(row[COL["DATE"]])
            if d:
                dates.append(d)

    return {
        "advertisers": unique_sorted(COL["ADVERTISER"]),
        "publishers": unique_sorted(COL["PUBLISHER"]),
        "industries": unique_sorted(COL["ADVERTISER_INDUSTRY"]),
        "segments": unique_sorted(COL["SEGMENT"]),
        "brands": unique_sorted(COL["BRAND"]),
        "offers": unique_sorted(COL["OFFER"]),
        "dateRange": {
            "min": min(dates).isoformat() if dates else "",
            "max": max(dates).isoformat() if dates else "",
        },
    }


def get_filter_relationships(cached_data: dict) -> dict:
    """
    Build advertiser → {publishers, segments} map.
    Mirrors getFilterRelationships() from Code.gs.
    """
    rows = cached_data["rows"]
    rel: Dict[str, dict] = {}

    for row in rows:
        if len(row) <= COL["SEGMENT"]:
            continue
        adv = _safe_str(row[COL["ADVERTISER"]])
        pub = _safe_str(row[COL["PUBLISHER"]])
        seg = _safe_str(row[COL["SEGMENT"]])

        if not adv or not pub:
            continue

        if adv not in rel:
            rel[adv] = {"publishers": set(), "segments": set(), "publisherSegments": {}}

        rel[adv]["publishers"].add(pub)
        if seg:
            rel[adv]["segments"].add(seg)
            if pub not in rel[adv]["publisherSegments"]:
                rel[adv]["publisherSegments"][pub] = set()
            rel[adv]["publisherSegments"][pub].add(seg)

    # Convert sets to sorted lists
    return {
        adv: {
            "publishers": sorted(d["publishers"]),
            "segments": sorted(d["segments"]),
            "publisherSegments": {
                p: sorted(s) for p, s in d["publisherSegments"].items()
            },
        }
        for adv, d in rel.items()
    }


# ── Aggregates ────────────────────────────────────────────────────────────────

def calculate_aggregates(rows: List, headers: List[str]) -> dict:
    """
    Compute KPI totals and derived metrics.
    Mirrors calculateAggregates() from Code.gs.
    """
    # Use header names for dynamic columns (sheets may differ)
    def hcol(name):
        return _get_col(headers, name)

    imp_idx = hcol("Impressions") if hcol("Impressions") >= 0 else COL["IMPRESSIONS"]
    clk_idx = hcol("Clicks") if hcol("Clicks") >= 0 else COL["CLICKS"]
    spd_idx = hcol("Publisher_Spends") if hcol("Publisher_Spends") >= 0 else COL["PUBLISHER_SPENDS"]
    dist_idx = hcol("Distribution") if hcol("Distribution") >= 0 else COL["DISTRIBUTION"]
    ql_idx = hcol("QL") if hcol("QL") >= 0 else COL["QL"]
    qqg_idx = hcol("QQG") if hcol("QQG") >= 0 else COL["QQG"]
    coupon_idx = hcol("Coupon_Orders") if hcol("Coupon_Orders") >= 0 else COL["COUPON_ORDERS"]
    redir_idx = hcol("Redirections") if hcol("Redirections") >= 0 else COL["REDIRECTIONS"]
    adv_spd_idx = hcol("Advertiser_Spends") if hcol("Advertiser_Spends") >= 0 else COL["ADVERTISER_SPENDS"]
    leads_idx = hcol("Leads") if hcol("Leads") >= 0 else COL["LEADS"]
    orders_idx = hcol("Orders") if hcol("Orders") >= 0 else COL["ORDERS"]
    rev_idx = hcol("Revenue") if hcol("Revenue") >= 0 else COL["REVENUE"]

    def safe_get(row, idx):
        return _to_float(row[idx]) if len(row) > idx >= 0 else 0.0

    total_imp = total_clk = total_spd = total_dist = 0.0
    total_ql = total_qqg = total_coupon = total_redir = 0.0
    total_adv_spd = total_leads = total_orders = total_rev = 0.0

    for row in rows:
        total_imp += safe_get(row, imp_idx)
        total_clk += safe_get(row, clk_idx)
        total_spd += safe_get(row, spd_idx)
        total_dist += safe_get(row, dist_idx)
        total_ql += safe_get(row, ql_idx)
        total_qqg += safe_get(row, qqg_idx)
        total_coupon += safe_get(row, coupon_idx)
        total_redir += safe_get(row, redir_idx)
        total_adv_spd += safe_get(row, adv_spd_idx)
        total_leads += safe_get(row, leads_idx)
        total_orders += safe_get(row, orders_idx)
        total_rev += safe_get(row, rev_idx)

    total_reach = total_imp + total_dist
    avg_ctr = (total_clk / total_reach * 100) if total_reach > 0 else 0
    avg_cpm = (total_spd / (total_imp / 1000)) if total_imp > 0 else 0
    avg_cpc = (total_spd / total_clk) if total_clk > 0 else 0
    avg_cpql = (total_spd / total_ql) if total_ql > 0 else None
    avg_cpqqg = (total_spd / total_qqg) if total_qqg > 0 else None

    return {
        "totalRows": len(rows),
        "impressions": round(total_imp),
        "distribution": round(total_dist),
        "clicks": round(total_clk),
        "spends": round(total_spd),
        "advertiserSpends": round(total_adv_spd),
        "ql": round(total_ql),
        "qqg": round(total_qqg),
        "couponOrders": round(total_coupon),
        "redirections": round(total_redir),
        "leads": round(total_leads),
        "orders": round(total_orders),
        "revenue": round(total_rev),
        "ctr": round(avg_ctr, 2),
        "cpm": round(avg_cpm, 2),
        "cpc": round(avg_cpc, 2),
        "cpql": round(avg_cpql, 2) if avg_cpql is not None else "N/A",
        "cpqqg": round(avg_cpqqg, 2) if avg_cpqqg is not None else "N/A",
        "hasQL": total_ql > 0,
        "hasQQG": total_qqg > 0,
        "hasCouponOrders": total_coupon > 0,
    }


# ── Time Series ───────────────────────────────────────────────────────────────

def get_time_series(rows: List, headers: List[str], group_by: str = "day") -> List[dict]:
    """
    Build date-bucketed time series for charts.
    Mirrors getTimeSeries() from Code.gs.
    """
    grouped: Dict[str, dict] = defaultdict(
        lambda: {"impressions": 0.0, "clicks": 0.0, "spends": 0.0, "distribution": 0.0,
                 "ql": 0.0, "qqg": 0.0, "orders": 0.0, "revenue": 0.0}
    )

    def hcol(name):
        c = _get_col(headers, name)
        return c if c >= 0 else None

    spd_idx = hcol("Publisher_Spends") or COL["PUBLISHER_SPENDS"]

    for row in rows:
        if len(row) <= COL["DATE"]:
            continue

        # Pick date key based on group_by
        if group_by == "week":
            key_val = row[COL["WEEK_START"]] if len(row) > COL["WEEK_START"] else row[COL["DATE"]]
        elif group_by == "month":
            key_val = row[COL["MONTH_START"]] if len(row) > COL["MONTH_START"] else row[COL["DATE"]]
        else:
            key_val = row[COL["DATE"]]

        d = _parse_date(key_val)
        if d is None:
            continue
        key = d.isoformat()

        g = grouped[key]
        g["impressions"] += _to_float(row[COL["IMPRESSIONS"]]) if len(row) > COL["IMPRESSIONS"] else 0
        g["distribution"] += _to_float(row[COL["DISTRIBUTION"]]) if len(row) > COL["DISTRIBUTION"] else 0
        g["clicks"] += _to_float(row[COL["CLICKS"]]) if len(row) > COL["CLICKS"] else 0
        g["spends"] += _to_float(row[spd_idx]) if len(row) > spd_idx else 0
        g["ql"] += _to_float(row[COL["QL"]]) if len(row) > COL["QL"] else 0
        g["qqg"] += _to_float(row[COL["QQG"]]) if len(row) > COL["QQG"] else 0
        g["orders"] += _to_float(row[COL["ORDERS"]]) if len(row) > COL["ORDERS"] else 0
        g["revenue"] += _to_float(row[COL["REVENUE"]]) if len(row) > COL["REVENUE"] else 0

    series = []
    for key in sorted(grouped.keys()):
        g = grouped[key]
        imp = g["impressions"]
        clk = g["clicks"]
        spd = g["spends"]
        dist = g["distribution"]
        total_reach = imp + dist
        ctr = (clk / total_reach * 100) if total_reach > 0 else 0
        cpc = (spd / clk) if clk > 0 else 0
        cpm = (spd / (imp / 1000)) if imp > 0 else 0

        series.append({
            "date": key,
            "impressions": round(imp),
            "distribution": round(dist),
            "clicks": round(clk),
            "spends": round(spd),
            "ql": round(g["ql"]),
            "qqg": round(g["qqg"]),
            "orders": round(g["orders"]),
            "revenue": round(g["revenue"]),
            "ctr": round(ctr, 2),
            "cpc": round(cpc, 2),
            "cpm": round(cpm, 2),
        })
    return series


# ── Breakdowns ────────────────────────────────────────────────────────────────

def get_breakdowns(rows: List, headers: List[str]) -> dict:
    """
    Breakdown totals by advertiser, publisher, segment.
    Mirrors getBreakdowns() from Code.gs.
    """
    def group_sum(dim_col: int) -> List[dict]:
        agg: Dict[str, dict] = defaultdict(
            lambda: {"impressions": 0.0, "clicks": 0.0, "spends": 0.0}
        )
        for row in rows:
            if len(row) <= dim_col:
                continue
            key = _safe_str(row[dim_col]) or "Unknown"
            agg[key]["impressions"] += _to_float(row[COL["IMPRESSIONS"]]) if len(row) > COL["IMPRESSIONS"] else 0
            agg[key]["clicks"] += _to_float(row[COL["CLICKS"]]) if len(row) > COL["CLICKS"] else 0
            spd_idx = _get_col(headers, "Publisher_Spends")
            spd_idx = spd_idx if spd_idx >= 0 else COL["PUBLISHER_SPENDS"]
            agg[key]["spends"] += _to_float(row[spd_idx]) if len(row) > spd_idx else 0

        return sorted(
            [{"name": k, "impressions": round(v["impressions"]),
              "clicks": round(v["clicks"]), "spends": round(v["spends"])}
             for k, v in agg.items()],
            key=lambda x: x["spends"], reverse=True
        )

    return {
        "byAdvertiser": group_sum(COL["ADVERTISER"]),
        "byPublisher": group_sum(COL["PUBLISHER"]),
        "bySegment": group_sum(COL["SEGMENT"]),
    }


# ── Table data ────────────────────────────────────────────────────────────────

def prepare_table_data(rows: List, headers: List[str], offset: int = 0, limit: int = 100) -> List[dict]:
    """Convert raw rows to list-of-dicts for the data table (paginated)."""
    page = rows[offset: offset + limit]
    result = []
    for row in page:
        obj = {}
        for i, h in enumerate(headers):
            obj[h] = row[i] if i < len(row) else ""
        result.append(obj)
    return result


# ── Advertiser Performance ────────────────────────────────────────────────────

def get_advertiser_performance(rows: List, headers: List[str], filters: dict, view_mode: str = "weekly") -> dict:
    """
    Hierarchical advertiser performance: Advertiser → Publisher → Segment.
    Mirrors getAdvertiserPerformanceDataSimple() from Code.gs.
    """
    adv_filter = set(filters.get("advertisers", []))
    date_from = _parse_date(filters.get("dateFrom"))
    date_to = _parse_date(filters.get("dateTo"))

    spd_idx = _get_col(headers, "Publisher_Spends")
    if spd_idx < 0:
        spd_idx = COL["PUBLISHER_SPENDS"]

    agg: Dict[str, Dict[str, Dict[str, dict]]] = {}  # adv → pub → seg → metrics

    for row in rows:
        if len(row) <= COL["SEGMENT"]:
            continue

        adv = _safe_str(row[COL["ADVERTISER"]])
        pub = _safe_str(row[COL["PUBLISHER"]])
        seg = _safe_str(row[COL["SEGMENT"]]) or "Unknown"

        if adv_filter and adv not in adv_filter:
            continue

        if date_from or date_to:
            d = _parse_date(row[COL["DATE"]])
            if d is None:
                continue
            if date_from and d < date_from:
                continue
            if date_to and d > date_to:
                continue

        if adv not in agg:
            agg[adv] = {}
        if pub not in agg[adv]:
            agg[adv][pub] = {}
        if seg not in agg[adv][pub]:
            agg[adv][pub][seg] = {"impressions": 0, "clicks": 0, "spends": 0,
                                   "ql": 0, "qqg": 0, "orders": 0, "revenue": 0}

        m = agg[adv][pub][seg]
        m["impressions"] += _to_float(row[COL["IMPRESSIONS"]]) if len(row) > COL["IMPRESSIONS"] else 0
        m["clicks"] += _to_float(row[COL["CLICKS"]]) if len(row) > COL["CLICKS"] else 0
        m["spends"] += _to_float(row[spd_idx]) if len(row) > spd_idx else 0
        m["ql"] += _to_float(row[COL["QL"]]) if len(row) > COL["QL"] else 0
        m["qqg"] += _to_float(row[COL["QQG"]]) if len(row) > COL["QQG"] else 0
        m["orders"] += _to_float(row[COL["ORDERS"]]) if len(row) > COL["ORDERS"] else 0
        m["revenue"] += _to_float(row[COL["REVENUE"]]) if len(row) > COL["REVENUE"] else 0

    # Build nested output
    advertisers = []
    for adv, pubs in sorted(agg.items()):
        adv_totals = {"impressions": 0, "clicks": 0, "spends": 0, "ql": 0, "qqg": 0, "orders": 0, "revenue": 0}
        pub_list = []
        for pub, segs in sorted(pubs.items()):
            pub_totals = {"impressions": 0, "clicks": 0, "spends": 0, "ql": 0, "qqg": 0, "orders": 0, "revenue": 0}
            seg_list = []
            for seg, m in sorted(segs.items()):
                rm = {k: round(v) for k, v in m.items()}
                rm["name"] = seg
                rm["ctr"] = round(rm["clicks"] / rm["impressions"] * 100, 2) if rm["impressions"] > 0 else 0
                rm["cpm"] = round(rm["spends"] / (rm["impressions"] / 1000), 2) if rm["impressions"] > 0 else 0
                rm["cpql"] = round(rm["spends"] / rm["ql"], 2) if rm["ql"] > 0 else None
                seg_list.append(rm)
                for k in pub_totals:
                    pub_totals[k] += m[k]

            pub_entry = {k: round(v) for k, v in pub_totals.items()}
            pub_entry["name"] = pub
            pub_entry["ctr"] = round(pub_entry["clicks"] / pub_entry["impressions"] * 100, 2) if pub_entry["impressions"] > 0 else 0
            pub_entry["cpm"] = round(pub_entry["spends"] / (pub_entry["impressions"] / 1000), 2) if pub_entry["impressions"] > 0 else 0
            pub_entry["cpql"] = round(pub_entry["spends"] / pub_entry["ql"], 2) if pub_entry["ql"] > 0 else None
            pub_entry["segments"] = seg_list
            pub_list.append(pub_entry)
            for k in adv_totals:
                adv_totals[k] += pub_totals[k]

        adv_entry = {k: round(v) for k, v in adv_totals.items()}
        adv_entry["name"] = adv
        adv_entry["ctr"] = round(adv_entry["clicks"] / adv_entry["impressions"] * 100, 2) if adv_entry["impressions"] > 0 else 0
        adv_entry["cpm"] = round(adv_entry["spends"] / (adv_entry["impressions"] / 1000), 2) if adv_entry["impressions"] > 0 else 0
        adv_entry["cpql"] = round(adv_entry["spends"] / adv_entry["ql"], 2) if adv_entry["ql"] > 0 else None
        adv_entry["publishers"] = pub_list
        advertisers.append(adv_entry)

    return {"advertisers": advertisers, "viewMode": view_mode}


# ── Publisher Performance ──────────────────────────────────────────────────────

def get_publisher_performance(rows: List, headers: List[str], filters: dict, view_mode: str = "weekly") -> dict:
    """
    Publisher → Advertiser → Segment hierarchy.
    Mirrors getPublisherPerformanceData() from Code.gs.
    """
    pub_filter = set(filters.get("publishers", []))
    seg_filter = set(filters.get("segments", []))
    date_from = _parse_date(filters.get("dateFrom"))
    date_to = _parse_date(filters.get("dateTo"))

    spd_idx = _get_col(headers, "Publisher_Spends")
    if spd_idx < 0:
        spd_idx = COL["PUBLISHER_SPENDS"]

    agg: Dict[str, Dict[str, Dict[str, dict]]] = {}  # pub → adv → seg → metrics

    for row in rows:
        if len(row) <= COL["SEGMENT"]:
            continue

        pub = _safe_str(row[COL["PUBLISHER"]])
        adv = _safe_str(row[COL["ADVERTISER"]])
        seg = _safe_str(row[COL["SEGMENT"]]) or "Unknown"

        if pub_filter and pub not in pub_filter:
            continue
        if seg_filter and seg not in seg_filter:
            continue

        if date_from or date_to:
            d = _parse_date(row[COL["DATE"]])
            if d is None:
                continue
            if date_from and d < date_from:
                continue
            if date_to and d > date_to:
                continue

        if pub not in agg:
            agg[pub] = {}
        if adv not in agg[pub]:
            agg[pub][adv] = {}
        if seg not in agg[pub][adv]:
            agg[pub][adv][seg] = {"impressions": 0, "clicks": 0, "spends": 0, "ql": 0, "qqg": 0}

        m = agg[pub][adv][seg]
        m["impressions"] += _to_float(row[COL["IMPRESSIONS"]]) if len(row) > COL["IMPRESSIONS"] else 0
        m["clicks"] += _to_float(row[COL["CLICKS"]]) if len(row) > COL["CLICKS"] else 0
        m["spends"] += _to_float(row[spd_idx]) if len(row) > spd_idx else 0
        m["ql"] += _to_float(row[COL["QL"]]) if len(row) > COL["QL"] else 0
        m["qqg"] += _to_float(row[COL["QQG"]]) if len(row) > COL["QQG"] else 0

    publishers = []
    for pub, advs in sorted(agg.items()):
        pub_totals = {"impressions": 0, "clicks": 0, "spends": 0, "ql": 0, "qqg": 0}
        adv_list = []
        for adv, segs in sorted(advs.items()):
            adv_totals = {"impressions": 0, "clicks": 0, "spends": 0, "ql": 0, "qqg": 0}
            seg_list = []
            for seg, m in sorted(segs.items()):
                rm = {k: round(v) for k, v in m.items()}
                rm["name"] = seg
                rm["ctr"] = round(rm["clicks"] / rm["impressions"] * 100, 2) if rm["impressions"] > 0 else 0
                rm["cpm"] = round(rm["spends"] / (rm["impressions"] / 1000), 2) if rm["impressions"] > 0 else 0
                seg_list.append(rm)
                for k in adv_totals:
                    adv_totals[k] += m[k]
            adv_entry = {k: round(v) for k, v in adv_totals.items()}
            adv_entry["name"] = adv
            adv_entry["ctr"] = round(adv_entry["clicks"] / adv_entry["impressions"] * 100, 2) if adv_entry["impressions"] > 0 else 0
            adv_entry["cpm"] = round(adv_entry["spends"] / (adv_entry["impressions"] / 1000), 2) if adv_entry["impressions"] > 0 else 0
            adv_entry["segments"] = seg_list
            adv_list.append(adv_entry)
            for k in pub_totals:
                pub_totals[k] += adv_totals[k]

        pub_entry = {k: round(v) for k, v in pub_totals.items()}
        pub_entry["name"] = pub
        pub_entry["ctr"] = round(pub_entry["clicks"] / pub_entry["impressions"] * 100, 2) if pub_entry["impressions"] > 0 else 0
        pub_entry["cpm"] = round(pub_entry["spends"] / (pub_entry["impressions"] / 1000), 2) if pub_entry["impressions"] > 0 else 0
        pub_entry["advertisers"] = adv_list
        publishers.append(pub_entry)

    return {"publishers": publishers, "viewMode": view_mode}


# ── Advertiser Health ─────────────────────────────────────────────────────────

def _get_date_ranges(view_mode: str = "weekly") -> dict:
    """
    Compute current and prior period date ranges.
    """
    today = date.today()

    if view_mode == "weekly":
        # Current week: Mon–Sun
        days_since_mon = today.weekday()
        week_start = today - timedelta(days=days_since_mon)
        week_end = week_start + timedelta(days=6)
        prev_start = week_start - timedelta(days=7)
        prev_end = week_start - timedelta(days=1)
        return {
            "current": {"start": week_start.isoformat(), "end": min(today, week_end).isoformat()},
            "previous": {"start": prev_start.isoformat(), "end": prev_end.isoformat()},
        }
    elif view_mode == "monthly":
        # Current month
        month_start = today.replace(day=1)
        if month_start.month == 1:
            prev_start = month_start.replace(year=month_start.year - 1, month=12)
        else:
            prev_start = month_start.replace(month=month_start.month - 1)
        prev_end = month_start - timedelta(days=1)
        return {
            "current": {"start": month_start.isoformat(), "end": today.isoformat()},
            "previous": {"start": prev_start.isoformat(), "end": prev_end.isoformat()},
        }
    else:
        # MTD
        month_start = today.replace(day=1)
        return {
            "current": {"start": month_start.isoformat(), "end": today.isoformat()},
            "previous": None,
        }


def get_advertiser_health(rows: List, headers: List[str], view_mode: str = "weekly") -> dict:
    """
    Summarise each advertiser's current-period vs prior-period performance.
    Mirrors getAdvertiserHealthData() from Code.gs.
    """
    ranges = _get_date_ranges(view_mode)
    curr_start = _parse_date(ranges["current"]["start"])
    curr_end = _parse_date(ranges["current"]["end"])
    prev = ranges.get("previous")
    prev_start = _parse_date(prev["start"]) if prev else None
    prev_end = _parse_date(prev["end"]) if prev else None

    spd_idx = _get_col(headers, "Publisher_Spends")
    if spd_idx < 0:
        spd_idx = COL["PUBLISHER_SPENDS"]

    curr_agg: Dict[str, dict] = defaultdict(lambda: {"impressions": 0, "clicks": 0, "spends": 0, "ql": 0, "qqg": 0})
    prev_agg: Dict[str, dict] = defaultdict(lambda: {"impressions": 0, "clicks": 0, "spends": 0, "ql": 0, "qqg": 0})

    for row in rows:
        if len(row) <= COL["ADVERTISER"]:
            continue
        adv = _safe_str(row[COL["ADVERTISER"]])
        d = _parse_date(row[COL["DATE"]])
        if d is None or not adv:
            continue

        def add_to(bucket):
            bucket["impressions"] += _to_float(row[COL["IMPRESSIONS"]]) if len(row) > COL["IMPRESSIONS"] else 0
            bucket["clicks"] += _to_float(row[COL["CLICKS"]]) if len(row) > COL["CLICKS"] else 0
            bucket["spends"] += _to_float(row[spd_idx]) if len(row) > spd_idx else 0
            bucket["ql"] += _to_float(row[COL["QL"]]) if len(row) > COL["QL"] else 0
            bucket["qqg"] += _to_float(row[COL["QQG"]]) if len(row) > COL["QQG"] else 0

        if curr_start <= d <= curr_end:
            add_to(curr_agg[adv])
        elif prev_start and prev_end and prev_start <= d <= prev_end:
            add_to(prev_agg[adv])

    all_advs = set(curr_agg.keys()) | set(prev_agg.keys())
    result = []
    for adv in sorted(all_advs):
        curr = curr_agg[adv]
        prev_m = prev_agg[adv]

        def pct_change(curr_val, prev_val):
            if prev_val == 0:
                return None
            return round((curr_val - prev_val) / prev_val * 100, 1)

        entry = {
            "advertiser": adv,
            "current": {k: round(v) for k, v in curr.items()},
            "previous": {k: round(v) for k, v in prev_m.items()},
            "change": {
                "impressions": pct_change(curr["impressions"], prev_m["impressions"]),
                "clicks": pct_change(curr["clicks"], prev_m["clicks"]),
                "spends": pct_change(curr["spends"], prev_m["spends"]),
                "ql": pct_change(curr["ql"], prev_m["ql"]),
                "qqg": pct_change(curr["qqg"], prev_m["qqg"]),
            },
            "status": "active" if curr["impressions"] > 0 else "inactive",
        }
        result.append(entry)

    return {"advertisers": result, "dateRanges": ranges, "viewMode": view_mode}


# ── Data Freshness ────────────────────────────────────────────────────────────

def compute_data_freshness(rows: List, headers: List[str]) -> dict:
    """
    For each advertiser track publisher vs advertiser data freshness separately.
    Status: up_to_date / publisher_outdated / advertiser_outdated / both_outdated
    """
    today = date.today()
    STALE_DAYS = 1  # data older than 1 day is considered outdated

    pub_spd_idx = _get_col(headers, "Publisher_Spends")
    if pub_spd_idx < 0:
        pub_spd_idx = COL["PUBLISHER_SPENDS"]
    adv_spd_idx = _get_col(headers, "Advertiser_Spends")
    if adv_spd_idx < 0:
        adv_spd_idx = COL["ADVERTISER_SPENDS"]

    pub_latest: Dict[str, date] = {}   # latest date where publisher_spends > 0
    adv_latest: Dict[str, date] = {}   # latest date where advertiser_spends > 0

    for row in rows:
        if len(row) <= COL["DATE"]:
            continue
        adv = _safe_str(row[COL["ADVERTISER"]])
        d = _parse_date(row[COL["DATE"]])
        if not adv or d is None:
            continue
        pub_spd = _safe_float(row[pub_spd_idx]) if len(row) > pub_spd_idx else 0.0
        adv_spd = _safe_float(row[adv_spd_idx]) if len(row) > adv_spd_idx else 0.0
        if pub_spd > 0:
            if adv not in pub_latest or d > pub_latest[adv]:
                pub_latest[adv] = d
        if adv_spd > 0:
            if adv not in adv_latest or d > adv_latest[adv]:
                adv_latest[adv] = d

    all_advertisers = sorted(set(pub_latest.keys()) | set(adv_latest.keys()))

    result = []
    by_date: Dict[str, list] = defaultdict(list)

    for adv in all_advertisers:
        pd = pub_latest.get(adv)
        ad = adv_latest.get(adv)
        pub_stale = pd is None or (today - pd).days > STALE_DAYS
        adv_stale = ad is None or (today - ad).days > STALE_DAYS

        if not pub_stale and not adv_stale:
            status = "up_to_date"
        elif pub_stale and not adv_stale:
            status = "publisher_outdated"
        elif not pub_stale and adv_stale:
            status = "advertiser_outdated"
        else:
            status = "both_outdated"

        last_date = max(d for d in [pd, ad] if d) if (pd or ad) else None
        last_date_str = last_date.isoformat() if last_date else "—"

        entry = {
            "advertiser": adv,
            "lastDate": last_date_str,
            "pubLastDate": pd.isoformat() if pd else "—",
            "advLastDate": ad.isoformat() if ad else "—",
            "status": status,
        }
        result.append(entry)
        by_date[last_date_str].append(entry)

    by_date_sorted = [
        {"date": d, "advertisers": sorted(advs, key=lambda x: x["advertiser"])}
        for d, advs in sorted(by_date.items(), reverse=True)
    ]

    return {
        "advertisers": result,
        "byDate": by_date_sorted,
        "computedAt": datetime.utcnow().isoformat(),
        "totalAdvertisers": len(result),
        "upToDateCount": sum(1 for a in result if a["status"] == "up_to_date"),
        "publisherOutdatedCount": sum(1 for a in result if a["status"] == "publisher_outdated"),
        "advertiserOutdatedCount": sum(1 for a in result if a["status"] == "advertiser_outdated"),
        "bothOutdatedCount": sum(1 for a in result if a["status"] == "both_outdated"),
    }


# ── Monthly Spend Analysis ────────────────────────────────────────────────────

def get_monthly_spend_analysis(rows: List, headers: List[str]) -> dict:
    """
    Month-over-month spends by advertiser.
    Mirrors getMonthlySpendAnalysisData() from Code.gs.
    """
    today = date.today()
    spd_idx = _get_col(headers, "Publisher_Spends")
    if spd_idx < 0:
        spd_idx = COL["PUBLISHER_SPENDS"]

    # Collect last 4 months
    months = []
    for i in range(3, -1, -1):
        month_date = today.replace(day=1)
        for _ in range(i):
            if month_date.month == 1:
                month_date = month_date.replace(year=month_date.year - 1, month=12)
            else:
                month_date = month_date.replace(month=month_date.month - 1)
        months.append(month_date.strftime("%Y-%m"))

    agg: Dict[str, Dict[str, float]] = defaultdict(lambda: {m: 0.0 for m in months})

    for row in rows:
        if len(row) <= COL["MONTH_START"]:
            continue
        adv = _safe_str(row[COL["ADVERTISER"]])
        month_val = row[COL["MONTH_START"]]
        d = _parse_date(month_val)
        if not adv or d is None:
            continue
        month_key = d.strftime("%Y-%m")
        if month_key not in months:
            continue
        spd = _to_float(row[spd_idx]) if len(row) > spd_idx else 0
        agg[adv][month_key] += spd

    result = []
    for adv in sorted(agg.keys()):
        entry = {"advertiser": adv}
        for m in months:
            entry[m] = round(agg[adv][m])
        result.append(entry)

    return {"data": result, "months": months}


# ── Budget ────────────────────────────────────────────────────────────────────

def get_budget_data(rows: List, headers: List[str], filters: dict = None) -> dict:
    """
    MTD spends vs total budget by advertiser/publisher.
    Mirrors getBudgetData() from Code.gs.
    """
    filters = filters or {}
    today = date.today()
    current_month = today.strftime("%Y-%m")
    selected_month = filters.get("month", current_month)

    def hcol(name):
        c = _get_col(headers, name)
        return c if c >= 0 else -1

    mtd_adv_idx = hcol("MTD_Adv_Spends")
    mtd_pub_idx = hcol("MTD_Pub_Level_Spends")
    bud_rem_idx = hcol("Budget_Remaining")
    tot_bud_idx = hcol("Total_Budget")
    month_idx = hcol("Month_Start_Date") if hcol("Month_Start_Date") >= 0 else COL["MONTH_START"]
    adv_spd_idx = hcol("Publisher_Spends") if hcol("Publisher_Spends") >= 0 else COL["PUBLISHER_SPENDS"]

    adv_months: Set[str] = set()
    adv_agg: Dict[str, dict] = {}
    pub_agg: Dict[str, dict] = {}

    for row in rows:
        if len(row) <= month_idx:
            continue
        adv = _safe_str(row[COL["ADVERTISER"]])
        pub = _safe_str(row[COL["PUBLISHER"]])
        d = _parse_date(row[month_idx])
        if not adv or d is None:
            continue
        month_key = d.strftime("%Y-%m")
        if "2024" <= month_key <= "2027":
            adv_months.add(month_key)
        if month_key != selected_month:
            continue

        adv_filter = filters.get("advertiser", [])
        pub_filter = filters.get("publisher", [])
        if adv_filter and adv not in adv_filter:
            continue
        if pub_filter and pub not in pub_filter:
            continue

        spd = _to_float(row[adv_spd_idx]) if len(row) > adv_spd_idx else 0
        mtd_adv = _to_float(row[mtd_adv_idx]) if mtd_adv_idx >= 0 and len(row) > mtd_adv_idx else 0
        tot_bud = _to_float(row[tot_bud_idx]) if tot_bud_idx >= 0 and len(row) > tot_bud_idx else 0
        bud_rem = _to_float(row[bud_rem_idx]) if bud_rem_idx >= 0 and len(row) > bud_rem_idx else 0

        if adv not in adv_agg:
            adv_agg[adv] = {"spends": 0, "mtdSpends": 0, "totalBudget": 0, "budgetRemaining": 0}
        adv_agg[adv]["spends"] += spd
        adv_agg[adv]["mtdSpends"] += mtd_adv
        if tot_bud:
            adv_agg[adv]["totalBudget"] = tot_bud  # take last non-zero value
        if bud_rem:
            adv_agg[adv]["budgetRemaining"] = bud_rem

        if pub not in pub_agg:
            pub_agg[pub] = {"advertiser": adv, "spends": 0}
        pub_agg[pub]["spends"] += spd

    def pct(spent, total):
        return round(spent / total * 100, 1) if total > 0 else 0

    adv_list = [
        {
            "advertiser": adv,
            "spends": round(d["spends"]),
            "mtdSpends": round(d["mtdSpends"]),
            "totalBudget": round(d["totalBudget"]),
            "budgetRemaining": round(d["budgetRemaining"]),
            "budgetUtilization": pct(d["mtdSpends"] or d["spends"], d["totalBudget"]),
        }
        for adv, d in sorted(adv_agg.items())
    ]

    pub_list = [
        {"publisher": pub, "advertiser": d["advertiser"], "spends": round(d["spends"])}
        for pub, d in sorted(pub_agg.items(), key=lambda x: x[1]["spends"], reverse=True)
    ]

    return {
        "advertiserLevel": adv_list,
        "publisherLevel": pub_list,
        "selectedMonth": selected_month,
        "availableMonths": sorted(adv_months, reverse=True),
    }
