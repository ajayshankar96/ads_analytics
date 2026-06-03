"""
Reporting logic for Advertiser and Publisher Google Sheets reports.
Mirrors the Apps Script createAdvertiserReport / createPublisherReport functions.
"""

import logging
import uuid
from collections import defaultdict
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional, Tuple

from data_logic import _to_float, _parse_date, _safe_str, _get_col

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────
FORCED_COLS = ["Date", "Segment", "Offer"]

# Columns never offered as user-selectable
_INTERNAL_COLS = {
    "week start", "month start", "advertiser segment", "cohort name",
    "advertiser", "publisher",
}

# Publisher report: always-included fixed metrics
PUB_FIXED_METRICS = ["Impressions", "Distribution", "Clicks", "Redirections"]

PUBLISHER_SHORT_CODES = {
    "flipkart": "P1",
    "navi": "P2",
    "fampay": "P3",
    "truecaller": "P4",
    "amazon": "P5",
    "my11circle": "P6",
    "bhim": "P7",
}

REPORT_SHARE_EMAILS = [
    "adarsh.jain@razorpay.com",
    "ayush.ks@razorpay.com",
    "chithra.r@razorpay.com",
    "souradeep.pal@razorpay.com",
    "prabhneet.singhbawa@razorpay.com",
    "sarthak.agrawal@razorpay.com",
    "gala.smit@razorpay.com",
]

# Registry sheet definitions
ADVERTISER_REGISTRY_SHEET = "Advertiser_Reports_Registry"
PUBLISHER_REGISTRY_SHEET = "Publisher_Reports_Registry"

ADV_REG_HEADERS = [
    "ID", "Report_Name", "Advertiser", "Date_From", "Views",
    "Selected_Columns", "Spreadsheet_URL", "Spreadsheet_ID",
    "Created_By", "Created_Date", "Last_Refreshed",
]

PUB_REG_HEADERS = [
    "ID", "Report_Name", "Publisher", "Advertisers_JSON",
    "Date_From", "Date_To", "Reporting_Levels",
    "Spreadsheet_URL", "Spreadsheet_ID",
    "Created_By", "Created_Date", "Last_Refreshed",
]


# ── Column helpers ────────────────────────────────────────────────────────────

def get_available_columns(headers: List[str]) -> List[str]:
    """Columns available for advertiser reports (excludes FORCED_COLS + internal)."""
    result = []
    for h in headers:
        s = str(h).strip()
        if s and s.lower() not in _INTERNAL_COLS and s not in FORCED_COLS:
            result.append(s)
    return result


def get_publisher_extra_metrics(headers: List[str]) -> List[str]:
    """Extra metrics available for publisher reports (beyond fixed metrics)."""
    fixed_lower = {m.lower() for m in PUB_FIXED_METRICS}
    skip = _INTERNAL_COLS | fixed_lower | {
        "date", "segment", "offer", "brand",
        "advertiser industry", "advertiser segment", "cohort name",
    }
    result = []
    for h in headers:
        s = str(h).strip()
        if s and s.lower() not in skip:
            result.append(s)
    return result


# ── Row filtering ─────────────────────────────────────────────────────────────

def filter_by_advertiser(rows, headers, advertiser: str):
    adv_col = _get_col(headers, "Advertiser")
    if adv_col < 0:
        return rows
    return [r for r in rows if len(r) > adv_col and _safe_str(r[adv_col]).lower() == advertiser.lower()]


def filter_by_publisher(rows, headers, publisher: str):
    pub_col = _get_col(headers, "Publisher")
    if pub_col < 0:
        return rows
    return [r for r in rows if len(r) > pub_col and _safe_str(r[pub_col]).lower() == publisher.lower()]


def filter_by_date(rows, headers, date_from: Optional[str] = None, date_to: Optional[str] = None):
    if not date_from and not date_to:
        return rows
    date_col = _get_col(headers, "Date")
    if date_col < 0:
        return rows
    df = _parse_date(date_from) if date_from else None
    dt = _parse_date(date_to) if date_to else None
    result = []
    for row in rows:
        d = _parse_date(row[date_col]) if len(row) > date_col else None
        if not d:
            continue
        if df and d < df:
            continue
        if dt and d > dt:
            continue
        result.append(row)
    return result


# ── Advertiser view builders ──────────────────────────────────────────────────

def build_consolidated(rows, headers, selected_cols) -> List[List]:
    """All rows with FORCED_COLS + selected_cols."""
    all_cols = FORCED_COLS + [c for c in selected_cols if c not in FORCED_COLS]
    col_idxs = [_get_col(headers, c) for c in all_cols]
    out = [all_cols]
    for row in rows:
        out.append([row[i] if 0 <= i < len(row) else "" for i in col_idxs])
    return out


def build_monthly(rows, headers, selected_cols) -> List[List]:
    """Aggregate by Month x Segment x Offer."""
    month_col = _get_col(headers, "Month Start")
    date_col = _get_col(headers, "Date")
    seg_col = _get_col(headers, "Segment")
    offer_col = _get_col(headers, "Offer")
    num_cols = [c for c in selected_cols if c not in FORCED_COLS]
    num_idxs = [_get_col(headers, c) for c in num_cols]

    groups: Dict[Tuple, Dict[str, float]] = {}
    order = []

    for row in rows:
        # Determine month
        raw = row[month_col] if 0 <= month_col < len(row) else (row[date_col] if 0 <= date_col < len(row) else "")
        d = _parse_date(raw)
        month_val = d.strftime("%Y-%m-01") if d else ""
        seg_val = _safe_str(row[seg_col]) if 0 <= seg_col < len(row) else ""
        offer_val = _safe_str(row[offer_col]) if 0 <= offer_col < len(row) else ""

        key = (month_val, seg_val, offer_val)
        if key not in groups:
            groups[key] = {c: 0.0 for c in num_cols}
            order.append(key)
        for c, idx in zip(num_cols, num_idxs):
            groups[key][c] += _to_float(row[idx]) if 0 <= idx < len(row) else 0.0

    hdr = ["Month", "Segment", "Offer"] + num_cols
    out = [hdr]
    for key in order:
        out.append(list(key) + [groups[key][c] for c in num_cols])
    return out


def build_weekly(rows, headers, selected_cols) -> List[List]:
    """Aggregate by Week x Segment x Offer."""
    week_col = _get_col(headers, "Week Start")
    date_col = _get_col(headers, "Date")
    seg_col = _get_col(headers, "Segment")
    offer_col = _get_col(headers, "Offer")
    num_cols = [c for c in selected_cols if c not in FORCED_COLS]
    num_idxs = [_get_col(headers, c) for c in num_cols]

    groups: Dict[Tuple, Dict[str, float]] = {}
    order = []

    for row in rows:
        raw = row[week_col] if 0 <= week_col < len(row) else (row[date_col] if 0 <= date_col < len(row) else "")
        d = _parse_date(raw)
        if d:
            ws = d - timedelta(days=d.weekday())
            week_val = ws.strftime("%Y-%m-%d")
        else:
            week_val = ""
        seg_val = _safe_str(row[seg_col]) if 0 <= seg_col < len(row) else ""
        offer_val = _safe_str(row[offer_col]) if 0 <= offer_col < len(row) else ""

        key = (week_val, seg_val, offer_val)
        if key not in groups:
            groups[key] = {c: 0.0 for c in num_cols}
            order.append(key)
        for c, idx in zip(num_cols, num_idxs):
            groups[key][c] += _to_float(row[idx]) if 0 <= idx < len(row) else 0.0

    hdr = ["Week Start", "Segment", "Offer"] + num_cols
    out = [hdr]
    for key in order:
        out.append(list(key) + [groups[key][c] for c in num_cols])
    return out


def build_segment_weekly(rows, headers, selected_cols) -> List[List]:
    """Aggregate by Segment x Week (no Offer grouping)."""
    week_col = _get_col(headers, "Week Start")
    date_col = _get_col(headers, "Date")
    seg_col = _get_col(headers, "Segment")
    num_cols = [c for c in selected_cols if c not in FORCED_COLS]
    num_idxs = [_get_col(headers, c) for c in num_cols]

    groups: Dict[Tuple, Dict[str, float]] = {}
    order = []

    for row in rows:
        raw = row[week_col] if 0 <= week_col < len(row) else (row[date_col] if 0 <= date_col < len(row) else "")
        d = _parse_date(raw)
        if d:
            ws = d - timedelta(days=d.weekday())
            week_val = ws.strftime("%Y-%m-%d")
        else:
            week_val = ""
        seg_val = _safe_str(row[seg_col]) if 0 <= seg_col < len(row) else ""

        key = (seg_val, week_val)
        if key not in groups:
            groups[key] = {c: 0.0 for c in num_cols}
            order.append(key)
        for c, idx in zip(num_cols, num_idxs):
            groups[key][c] += _to_float(row[idx]) if 0 <= idx < len(row) else 0.0

    hdr = ["Segment", "Week Start"] + num_cols
    out = [hdr]
    for key in order:
        out.append(list(key) + [groups[key][c] for c in num_cols])
    return out


# ── Publisher view builders ───────────────────────────────────────────────────

def _get_pub_metrics_indices(headers, all_metrics):
    return [(m, _get_col(headers, m)) for m in all_metrics]


def build_pub_daily(rows, headers, all_metrics) -> List[List]:
    """Publisher daily view: Date x Advertiser x (metrics)."""
    date_col = _get_col(headers, "Date")
    adv_col = _get_col(headers, "Advertiser")
    seg_col = _get_col(headers, "Segment")
    m_idxs = _get_pub_metrics_indices(headers, all_metrics)

    groups: Dict[Tuple, Dict[str, float]] = {}
    order = []

    for row in rows:
        date_val = _safe_str(row[date_col]) if 0 <= date_col < len(row) else ""
        adv_val = _safe_str(row[adv_col]) if 0 <= adv_col < len(row) else ""
        seg_val = _safe_str(row[seg_col]) if 0 <= seg_col < len(row) else ""

        key = (date_val, adv_val, seg_val)
        if key not in groups:
            groups[key] = {m: 0.0 for m, _ in m_idxs}
            order.append(key)
        for m, idx in m_idxs:
            groups[key][m] += _to_float(row[idx]) if 0 <= idx < len(row) else 0.0

    hdr = ["Date", "Advertiser", "Segment"] + all_metrics
    out = [hdr]
    for key in order:
        out.append(list(key) + [groups[key][m] for m, _ in m_idxs])
    return out


def build_pub_weekly(rows, headers, all_metrics) -> List[List]:
    """Publisher weekly view: Week x Advertiser x (metrics)."""
    week_col = _get_col(headers, "Week Start")
    date_col = _get_col(headers, "Date")
    adv_col = _get_col(headers, "Advertiser")
    seg_col = _get_col(headers, "Segment")
    m_idxs = _get_pub_metrics_indices(headers, all_metrics)

    groups: Dict[Tuple, Dict[str, float]] = {}
    order = []

    for row in rows:
        raw = row[week_col] if 0 <= week_col < len(row) else (row[date_col] if 0 <= date_col < len(row) else "")
        d = _parse_date(raw)
        week_val = (d - timedelta(days=d.weekday())).strftime("%Y-%m-%d") if d else ""
        adv_val = _safe_str(row[adv_col]) if 0 <= adv_col < len(row) else ""
        seg_val = _safe_str(row[seg_col]) if 0 <= seg_col < len(row) else ""

        key = (week_val, adv_val, seg_val)
        if key not in groups:
            groups[key] = {m: 0.0 for m, _ in m_idxs}
            order.append(key)
        for m, idx in m_idxs:
            groups[key][m] += _to_float(row[idx]) if 0 <= idx < len(row) else 0.0

    hdr = ["Week Start", "Advertiser", "Segment"] + all_metrics
    out = [hdr]
    for key in order:
        out.append(list(key) + [groups[key][m] for m, _ in m_idxs])
    return out


def build_pub_mtd(rows, headers, all_metrics) -> List[List]:
    """Publisher MTD view: Month x Advertiser x (metrics)."""
    month_col = _get_col(headers, "Month Start")
    date_col = _get_col(headers, "Date")
    adv_col = _get_col(headers, "Advertiser")
    seg_col = _get_col(headers, "Segment")
    m_idxs = _get_pub_metrics_indices(headers, all_metrics)

    groups: Dict[Tuple, Dict[str, float]] = {}
    order = []

    for row in rows:
        raw = row[month_col] if 0 <= month_col < len(row) else (row[date_col] if 0 <= date_col < len(row) else "")
        d = _parse_date(raw)
        month_val = d.strftime("%Y-%m-01") if d else ""
        adv_val = _safe_str(row[adv_col]) if 0 <= adv_col < len(row) else ""
        seg_val = _safe_str(row[seg_col]) if 0 <= seg_col < len(row) else ""

        key = (month_val, adv_val, seg_val)
        if key not in groups:
            groups[key] = {m: 0.0 for m, _ in m_idxs}
            order.append(key)
        for m, idx in m_idxs:
            groups[key][m] += _to_float(row[idx]) if 0 <= idx < len(row) else 0.0

    hdr = ["Month", "Advertiser", "Segment"] + all_metrics
    out = [hdr]
    for key in order:
        out.append(list(key) + [groups[key][m] for m, _ in m_idxs])
    return out


# ── Registry helpers ──────────────────────────────────────────────────────────

def parse_adv_registry(raw_rows: List[List]) -> List[dict]:
    """Parse raw registry sheet rows into report dicts."""
    if not raw_rows:
        return []
    hdr = [str(h).strip() for h in raw_rows[0]]

    def fi(name):
        try:
            return hdr.index(name)
        except ValueError:
            return -1

    id_i = fi("ID")
    name_i = fi("Report_Name")
    adv_i = fi("Advertiser")
    from_i = fi("Date_From")
    views_i = fi("Views")
    cols_i = fi("Selected_Columns")
    url_i = fi("Spreadsheet_URL")
    ssid_i = fi("Spreadsheet_ID")
    cb_i = fi("Created_By")
    cd_i = fi("Created_Date")
    lr_i = fi("Last_Refreshed")

    result = []
    for row in raw_rows[1:]:
        def g(i):
            return str(row[i]).strip() if i >= 0 and i < len(row) else ""

        rep_id = g(id_i)
        if not rep_id:
            continue
        result.append({
            "id": rep_id,
            "reportName": g(name_i),
            "advertiser": g(adv_i),
            "dateFrom": g(from_i),
            "views": [v.strip() for v in g(views_i).split(",") if v.strip()],
            "selectedColumns": [v.strip() for v in g(cols_i).split(",") if v.strip()],
            "spreadsheetUrl": g(url_i),
            "spreadsheetId": g(ssid_i),
            "createdBy": g(cb_i),
            "createdDate": g(cd_i),
            "lastRefreshed": g(lr_i),
        })
    return result


def parse_pub_registry(raw_rows: List[List]) -> List[dict]:
    """Parse raw publisher registry rows into report dicts."""
    if not raw_rows:
        return []
    hdr = [str(h).strip() for h in raw_rows[0]]

    def fi(name):
        try:
            return hdr.index(name)
        except ValueError:
            return -1

    import json as _json

    id_i = fi("ID")
    name_i = fi("Report_Name")
    pub_i = fi("Publisher")
    advs_i = fi("Advertisers_JSON")
    from_i = fi("Date_From")
    to_i = fi("Date_To")
    levels_i = fi("Reporting_Levels")
    url_i = fi("Spreadsheet_URL")
    ssid_i = fi("Spreadsheet_ID")
    cb_i = fi("Created_By")
    cd_i = fi("Created_Date")
    lr_i = fi("Last_Refreshed")

    result = []
    for row in raw_rows[1:]:
        def g(i):
            return str(row[i]).strip() if i >= 0 and i < len(row) else ""

        rep_id = g(id_i)
        if not rep_id:
            continue
        try:
            advertisers = _json.loads(g(advs_i)) if g(advs_i) else []
        except Exception:
            advertisers = []
        result.append({
            "id": rep_id,
            "reportName": g(name_i),
            "publisher": g(pub_i),
            "advertisers": advertisers,
            "dateFrom": g(from_i),
            "dateTo": g(to_i),
            "reportingLevels": [v.strip() for v in g(levels_i).split(",") if v.strip()],
            "spreadsheetUrl": g(url_i),
            "spreadsheetId": g(ssid_i),
            "createdBy": g(cb_i),
            "createdDate": g(cd_i),
            "lastRefreshed": g(lr_i),
        })
    return result


def get_publisher_advertisers(rows, headers, publisher: str, date_from=None, date_to=None) -> List[dict]:
    """Get advertisers active for a publisher with their segments and offers."""
    pub_rows = filter_by_publisher(rows, headers, publisher)
    pub_rows = filter_by_date(pub_rows, headers, date_from, date_to)

    adv_col = _get_col(headers, "Advertiser")
    seg_col = _get_col(headers, "Segment")
    offer_col = _get_col(headers, "Offer")

    adv_data: Dict[str, Dict] = {}
    for row in pub_rows:
        adv = _safe_str(row[adv_col]) if 0 <= adv_col < len(row) else ""
        if not adv:
            continue
        seg = _safe_str(row[seg_col]) if 0 <= seg_col < len(row) else ""
        offer = _safe_str(row[offer_col]) if 0 <= offer_col < len(row) else ""
        if adv not in adv_data:
            adv_data[adv] = {"name": adv, "segments": set(), "offers": set()}
        if seg:
            adv_data[adv]["segments"].add(seg)
        if offer:
            adv_data[adv]["offers"].add(offer)

    result = []
    for adv, d in sorted(adv_data.items()):
        segs = sorted(d["segments"])
        offers = sorted(d["offers"])
        result.append({
            "name": adv,
            "segments": segs,
            "offers": offers,
            "comboCount": len(segs) * max(len(offers), 1),
        })
    return result
