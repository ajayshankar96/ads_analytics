"""
Generic ETL Worker — replaces 221 individual merge_row scripts.

Reads campaign config from Postgres, pulls advertiser + publisher data from
Google Sheets, merges on date, computes formulas, stores in rmn_campaign_metrics.
"""

import json
import logging
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from db import models

logger = logging.getLogger(__name__)

MONTH_MAP = {
    'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
    'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
    'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
}

PUBLISHER_METRIC_COLS = [
    "Impressions", "Distribution", "Clicks", "Orders", "Scratches",
    "Coins Burned", "Coins_Burned", "Redirections", "Spends",
]

METRIC_ALIASES = {
    "revenue": "Revenue",
    "orders": "Orders",
    "leads": "Leads",
    "sessions": "Sessions",
    "spends": "Advertiser_Spends",
}

SHEET_SPENDS_FLAG = "_has_sheet_spends"

# Remembers (formula, missing_variable) pairs already warned about so a config
# gap is logged once, not once per row. See _evaluate_formula.
_WARNED_FORMULA_VARS: set = set()


def _safe_float(value) -> float:
    if value is None or value == '':
        return 0.0
    try:
        if isinstance(value, str):
            value = value.replace(',', '').strip()
        return float(value)
    except (ValueError, TypeError):
        return 0.0


# How far in the future an ingested metric date may be before we treat it as
# garbage (mis-parsed / typo'd dates like 2028-09-24 were polluting the table).
_MAX_FUTURE_DAYS = 45
_MIN_METRIC_YEAR = 2024


def _validated_iso_date(y, m, d) -> Optional[str]:
    """Build YYYY-MM-DD, rejecting impossible dates and implausible ranges."""
    try:
        dt = date(int(y), int(m), int(d))
    except (ValueError, TypeError):
        return None
    if dt.year < _MIN_METRIC_YEAR or dt > date.today() + timedelta(days=_MAX_FUTURE_DAYS):
        logger.warning(f"Skipping implausible metric date {dt.isoformat()}")
        return None
    return dt.isoformat()


def _detect_slash_order(date_values) -> Optional[str]:
    """Decide whether a *column* of slash dates is DD/MM or MM/DD.

    Per-cell parsing can't tell "05/08" apart, but a whole column usually can:
    somewhere a day exceeds 12 (e.g. "05/31" ⇒ MM/DD, "31/05" ⇒ DD/MM). We scan
    every value, tally the unambiguous ones, and let the column vote. This makes
    every ambiguous cell in the column parse consistently instead of flipping
    orientation row by row (the bug that produced dates like 2028-09-24).

    Returns 'MDY', 'DMY', or None when there's no evidence either way.
    """
    dmy = mdy = 0
    for s in date_values:
        if not s:
            continue
        parts = str(s).strip().split('/')
        if len(parts) != 3:
            continue
        a, b = parts[0].strip(), parts[1].strip()
        if not (a.isdigit() and b.isdigit()):
            continue
        a_i, b_i = int(a), int(b)
        if a_i > 12 >= b_i:
            dmy += 1
        elif b_i > 12 >= a_i:
            mdy += 1
    if mdy > dmy:
        return 'MDY'
    if dmy > mdy:
        return 'DMY'
    return None


def _parse_date_from_row(date_str: str, year: Optional[str], month: Optional[str],
                         slash_order: Optional[str] = None) -> Optional[str]:
    """Parse a sheet cell into YYYY-MM-DD.

    ``year``/``month`` come from the tab name and are only needed for formats
    that don't carry their own ("25-Jan", bare day numbers). When they are None
    (tab month unparseable), those formats fail closed instead of guessing.

    Slash dates: an unambiguous value (a field > 12) always wins. For ambiguous
    values, ``slash_order`` ('MDY'/'DMY', from a column-level scan) decides;
    absent that, we fall back to DD/MM (Indian sheets).
    """
    if not date_str or not date_str.strip():
        return None
    date_str = date_str.strip()
    if date_str.upper() in ('TOTAL', 'GRAND TOTAL', ''):
        return None
    # Skip monthly summary rows like "Jan'26", "Feb'26", "June'26"
    for m_name in MONTH_MAP:
        if date_str.lower().startswith(m_name) and ("'" in date_str or "20" in date_str):
            return None
    try:
        # DD/MM/YYYY (Indian default) or MM/DD/YYYY when unambiguous
        if '/' in date_str:
            parts = date_str.split('/')
            if len(parts) == 3:
                a, b, y = (p.strip() for p in parts)
                if not (a.isdigit() and b.isdigit() and y.isdigit()):
                    return None
                if len(y) == 2:
                    y = '20' + y
                a_i, b_i = int(a), int(b)
                if a_i > 12 >= b_i:      # unambiguous DD/MM
                    d_i, m_i = a_i, b_i
                elif b_i > 12 >= a_i:    # unambiguous MM/DD
                    m_i, d_i = a_i, b_i
                elif a_i <= 12 and b_i <= 12:  # ambiguous → column vote, else DD/MM
                    if slash_order == 'MDY':
                        m_i, d_i = a_i, b_i
                    else:
                        d_i, m_i = a_i, b_i
                else:
                    return None
                return _validated_iso_date(y, m_i, d_i)
            return None
        if '-' in date_str:
            parts = date_str.split('-')
            # DD-Mon (e.g. "25-Jan", "1-Feb") — needs year from tab name
            if len(parts) == 2:
                day_part, mon_part = parts
                if day_part.isdigit() and mon_part.lower()[:3] in MONTH_MAP:
                    if year is None:
                        return None  # fail closed: no year context from tab
                    m_num = MONTH_MAP[mon_part.lower()[:3]]
                    return _validated_iso_date(year, m_num, day_part)
            if len(parts) == 3:
                d, m, y = parts
                # YYYY-MM-DD (ISO) or DD-MM-YYYY (all digits)
                if all(p.isdigit() for p in parts):
                    if len(d) == 4:  # ISO: first part is the year
                        return _validated_iso_date(d, m, y)
                    if len(y) == 2:
                        y = '20' + y
                    return _validated_iso_date(y, m, d)
                # DD-Mon-YYYY (e.g. 23-Jun-2026)
                if d.isdigit() and m.lower()[:3] in MONTH_MAP and y.isdigit():
                    if len(y) == 2:
                        y = '20' + y
                    m_num = MONTH_MAP[m.lower()[:3]]
                    return _validated_iso_date(y, m_num, d)
        # YYYYMMDD
        if len(date_str) == 8 and date_str.isdigit():
            return _validated_iso_date(date_str[:4], date_str[4:6], date_str[6:8])
        # "D Month YYYY" or "D Month" (e.g. "1 June 2026", "15 March 2026")
        parts = date_str.split()
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].lower()[:3] in MONTH_MAP:
            m_num = MONTH_MAP[parts[1].lower()[:3]]
            y = parts[2] if len(parts) >= 3 and parts[2].isdigit() else year
            if y is None:
                return None  # fail closed: no explicit year and no tab context
            if len(y) == 2:
                y = '20' + y
            return _validated_iso_date(y, m_num, parts[0])
        # Just a day number (legacy format — needs year+month from tab name)
        if parts and parts[0].isdigit() and 1 <= int(parts[0]) <= 31:
            if year is None or month is None:
                return None  # fail closed: tab gave us no month context
            return _validated_iso_date(year, month, parts[0])
    except Exception:
        pass
    return None


# Month token in a tab name: full names first so "june" wins over "jun";
# guarded by (?<![a-z]) / (?![a-z]) so brand substrings ("Maya" -> may,
# "Decathlon" -> dec) don't match. Digits/punctuation may touch the token
# ("Ctrl8June", "RZP-Jul") — that's fine.
_MONTH_TOKEN_RE = re.compile(
    r"(?<![a-z])(january|february|march|april|may|june|july|august|september|"
    r"october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec)(?![a-z])",
    re.IGNORECASE,
)
_MONTH_NUM = {
    'january': '01', 'february': '02', 'march': '03', 'april': '04', 'may': '05',
    'june': '06', 'july': '07', 'august': '08', 'september': '09', 'sept': '09',
    'october': '10', 'november': '11', 'december': '12',
    **MONTH_MAP,
}
# Numeric month-year forms: "06/2026", "06-2026", "2026/06", "2026-06"
_NUM_MONTH_YEAR_RE = re.compile(r"(?<!\d)(0?[1-9]|1[0-2])[/\-.](20\d{2})(?!\d)")
_NUM_YEAR_MONTH_RE = re.compile(r"(?<!\d)(20\d{2})[/\-.](0?[1-9]|1[0-2])(?!\d)")
_YEAR4_RE = re.compile(r"(?<!\d)(20\d{2})(?!\d)")
_YEAR_APOS_RE = re.compile(r"'(\d{2})(?!\d)")


def _parse_tab_month(tab_name: str) -> Optional[tuple]:
    """Extract (year, month) as strings from a tab name; None if unparseable.

    Handles mixed formats: "RZP_Ctrl8 June", "Jun'26", "July 2026", "06/2026",
    "2026-07", "Ctrl8June26". FAIL CLOSED: if no month token is found, return
    None — callers must skip the tab (or drop tab-context-dependent rows)
    rather than guess (the old parser defaulted to Jan 2026, silently
    mis-dating everything).
    """
    if not tab_name:
        return None

    month = None
    year = None
    m = _MONTH_TOKEN_RE.search(tab_name)
    if m:
        month = _MONTH_NUM[m.group(1).lower()]
        # Year token near the month: "Jun'26", "Jun 26", "Jun-26", "June2026"
        tail = tab_name[m.end():]
        tail_year = re.match(r"[\s\-_.']*((?:20)?\d{2})(?!\d)", tail)
        if tail_year:
            y = tail_year.group(1)
            if len(y) == 2:
                y = '20' + y
            if 2020 <= int(y) <= 2039:
                year = y
    else:
        num = _NUM_MONTH_YEAR_RE.search(tab_name)
        if num:
            month, year = num.group(1).zfill(2), num.group(2)
        else:
            num = _NUM_YEAR_MONTH_RE.search(tab_name)
            if num:
                year, month = num.group(1), num.group(2).zfill(2)

    if month is None:
        return None

    if year is None:
        # Fall back to a 4-digit or 'YY year anywhere in the name
        y4 = _YEAR4_RE.search(tab_name)
        ya = _YEAR_APOS_RE.search(tab_name)
        if y4:
            year = y4.group(1)
        elif ya and 20 <= int(ya.group(1)) <= 39:
            year = '20' + ya.group(1)

    if year is None:
        # No explicit year: assume current year, unless that would put the tab
        # more than one month in the future (e.g. a "Dec" tab seen in January
        # is last year's, not eleven months from now).
        today = date.today()
        year_i = today.year
        if int(month) - today.month > 1:
            year_i -= 1
        year = str(year_i)

    return year, month


def _resolve_tabs(tabs: List[str], col_mapping: Optional[Dict],
                  sheet_url: str = "", allow_rzp_discovery: bool = False,
                  default_all_tabs: bool = False) -> List[tuple]:
    """Unified tab resolution for advertiser AND publisher extraction.

    Returns [(tab_name, year, month)] where year/month may be None (exact-name
    matches without a month token — row formats needing tab context then fail
    closed per-row in _parse_date_from_row).

    Modes:
      * tab_pattern set (rolling): every tab containing the pattern AND having
        a parseable month qualifies — new monthly tabs are picked up
        automatically; junk tabs ("<pattern> Summary") are excluded by the
        month requirement.
      * tab_name set (exact/legacy): case-insensitive substring match. NO
        fallback to other tabs — a rename now surfaces as an error instead of
        silently ingesting the whole spreadsheet.
      * neither: optionally discover legacy RZP tabs (publisher sheets). No
        first-N-tabs fallback.
    """
    cm = col_mapping or {}
    pattern = (cm.get("tab_pattern") or "").strip()
    tab_name_cfg = (cm.get("tab_name") or "").strip()

    if pattern:
        resolved, skipped = [], []
        for t in tabs:
            if pattern.lower() in t.lower():
                ym = _parse_tab_month(t)
                if ym:
                    resolved.append((t, ym[0], ym[1]))
                else:
                    skipped.append(t)
        if skipped:
            logger.warning(f"Tabs match pattern '{pattern}' but have no parseable "
                           f"month, skipped: {skipped} ({sheet_url})")
        if not resolved:
            logger.error(f"No tabs matching pattern '{pattern}' with a parseable "
                         f"month in {sheet_url} — nothing ingested")
        else:
            logger.info(f"Rolling tab match '{pattern}': "
                        f"{[(t, f'{y}-{m}') for t, y, m in resolved]}")
        return resolved

    if tab_name_cfg:
        matched = [t for t in tabs if tab_name_cfg.lower() in t.lower()]
        if not matched:
            logger.error(f"Configured tab '{tab_name_cfg}' not found in {sheet_url} "
                         f"(tabs: {tabs[:10]}) — nothing ingested, NO fallback")
            return []
        out = []
        for t in matched:
            ym = _parse_tab_month(t)
            out.append((t, ym[0] if ym else None, ym[1] if ym else None))
        return out

    if allow_rzp_discovery:
        rzp = [t for t in tabs if 'RZP' in t.upper()]
        if not rzp:
            logger.error(f"No configured tab and no RZP tabs in {sheet_url} — "
                         f"nothing ingested (removed first-tabs fallback)")
            return []
        out = []
        for t in rzp:
            ym = _parse_tab_month(t)
            out.append((t, ym[0] if ym else None, ym[1] if ym else None))
        return out

    if default_all_tabs:
        # Visual mappings saved without a tab selection historically read every
        # tab; keep that for backward compatibility (but say so loudly).
        logger.warning(f"No tab configured for visual mapping on {sheet_url} — "
                       f"reading ALL {len(tabs)} tabs")
        out = []
        for t in tabs:
            ym = _parse_tab_month(t)
            out.append((t, ym[0] if ym else None, ym[1] if ym else None))
        return out

    logger.error(f"No tab configuration for {sheet_url} — nothing ingested")
    return []


def _matches_segment(row_segment: str, target_segments: str) -> bool:
    if not target_segments or not target_segments.strip():
        return True
    segments_list = [s.strip() for s in target_segments.split(',') if s.strip()]
    row_clean = row_segment.strip().lower()
    for target in segments_list:
        if target.lower() in row_clean or row_clean in target.lower():
            return True
    return False


def _add_metric_alias(row_data: Dict[str, float], key: str, value) -> None:
    """Store advertiser metrics under both configured and formula-friendly names."""
    numeric_value = _safe_float(value)
    normalized_key = str(key).strip().lower()
    if normalized_key in {"spends", "advertiser_spends"}:
        row_data["Advertiser_Spends"] = numeric_value
        row_data["advertiser_spends"] = numeric_value
        return
    row_data[key] = numeric_value
    canonical = METRIC_ALIASES.get(normalized_key)
    if canonical:
        row_data[canonical] = numeric_value


def _has_metric(mapping: Dict[str, float], *names: str) -> bool:
    wanted = {name.strip().lower() for name in names}
    return any(str(key).strip().lower() in wanted for key in mapping.keys())


def _get_metric_value(row_data: Dict[str, float], *names: str) -> float:
    wanted = {name.strip().lower() for name in names}
    for key, value in row_data.items():
        if str(key).strip().lower() in wanted:
            return _safe_float(value)
    return 0.0


def _fallback_advertiser_spends(row_data: Dict[str, float]) -> float:
    return _get_metric_value(row_data, "Advertiser_Spends", "advertiser_spends")


def _evaluate_formula(formula_str: str, row_data: Dict[str, float], goals: Optional[Dict] = None) -> float:
    if not formula_str or not formula_str.strip():
        return 0.0
    try:
        eval_context = {}
        text_columns = {'Advertiser', 'Publisher', 'Date', 'Segment', 'Brand', 'Offer'}
        for key, value in row_data.items():
            if key in text_columns:
                continue
            safe_key = key.replace(' ', '_').replace('-', '_')
            try:
                eval_context[safe_key] = float(value) if value else 0.0
            except (ValueError, TypeError):
                continue

        if goals:
            for period in ['daily', 'monthly', 'date_agnostic']:
                period_goals = goals.get('goals', {}).get(period, {})
                for goal_name, goal_value in period_goals.items():
                    if goal_name in formula_str:
                        try:
                            eval_context[goal_name] = float(goal_value)
                        except (ValueError, TypeError):
                            pass

        formula = formula_str
        for key in row_data.keys():
            if key in text_columns:
                continue
            safe_key = key.replace(' ', '_').replace('-', '_')
            formula = formula.replace(key, safe_key)
        # Any identifier the formula references that isn't in the data (e.g. a
        # ROAS formula wanting "Revenue" when the advertiser sheet couldn't be
        # read) is treated as 0 so we degrade gracefully instead of raising per
        # row. We warn once per (formula, variable) so a config gap is visible
        # without spamming the log for every date.
        missing = [n for n in set(re.findall(r'[A-Za-z_][A-Za-z0-9_]*', formula))
                   if n not in eval_context]
        for name in missing:
            eval_context[name] = 0.0
            warn_key = (formula_str, name)
            if warn_key not in _WARNED_FORMULA_VARS:
                _WARNED_FORMULA_VARS.add(warn_key)
                logger.warning(
                    f"Formula '{formula_str}' references '{name}' which is not in the "
                    f"available data; treating as 0. Check the column mapping / that the "
                    f"source sheet is readable.")
        result = eval(formula, {"__builtins__": {}}, eval_context)
        return float(result) if result else 0.0
    except Exception as e:
        logger.warning(f"Formula eval error: {formula_str} — {e}")
        return 0.0


def _publisher_formula_from_terms(model: str, rate: float) -> str:
    if not model or not rate:
        return ''
    billing_model = str(model).strip().lower()
    rate_str = str(rate)
    if billing_model == 'cpc':
        return f'Clicks * {rate_str}'
    if billing_model == 'cpm':
        return f'Impressions * {rate_str} / 1000'
    return ''


def _advertiser_formula_from_terms(model: str, rate: float) -> str:
    if not model or not rate:
        return ''
    billing_model = str(model).strip().lower().replace('_commit', '')
    rate_str = str(rate)
    if billing_model == 'cpc':
        return f'Clicks * {rate_str}'
    if billing_model == 'roas':
        return f'Revenue / {rate_str}'
    return ''


def _resolve_spend_formulas(buy_type: str, rate: float) -> tuple:
    """Legacy formula resolver retained for old campaigns without billing rows."""
    model = str(buy_type or "").strip().lower().replace("_commit", "")
    return _publisher_formula_from_terms(model, rate), _advertiser_formula_from_terms(model, rate)


async def _load_billing_configs(db: AsyncSession, campaign_id: str) -> List[Dict[str, Any]]:
    """Load billing configs newest-first so date matching can pick the latest active row."""
    result = await db.execute(text("""
        SELECT side, billing_model, rate, start_date, end_date
        FROM rmn_billing_config
        WHERE campaign_id = :campaign_id
        ORDER BY side, start_date DESC
    """), {"campaign_id": campaign_id})
    return [
        {
            "side": row[0],
            "billing_model": row[1],
            "rate": row[2],
            "start_date": row[3],
            "end_date": row[4],
        }
        for row in result.fetchall()
    ]


def _active_billing_config(configs: List[Dict[str, Any]], side: str, date_obj) -> Optional[Dict[str, Any]]:
    for cfg in configs:
        if cfg.get("side") != side:
            continue
        start_date = cfg.get("start_date")
        end_date = cfg.get("end_date")
        if start_date and start_date <= date_obj and (end_date is None or end_date >= date_obj):
            return cfg
    return None


def _billing_spend_from_config(config: Dict[str, Any], row_data: Dict[str, float]) -> float:
    model = str(config.get("billing_model") or "").strip().lower()
    rate = _safe_float(config.get("rate", 0))
    if model == "cpc":
        return _get_metric_value(row_data, "Clicks") * rate
    if model == "cpd":
        return rate
    if model == "cpm":
        return _get_metric_value(row_data, "Impressions") * rate / 1000.0
    if model == "cpa":
        return _get_metric_value(row_data, "Orders_pub", "Orders") * rate
    if model == "roas":
        revenue = _get_metric_value(row_data, "Revenue")
        return revenue / rate if rate else 0.0
    return 0.0


def _has_sheet_spends(record: Dict[str, Any]) -> bool:
    return bool(record.get(SHEET_SPENDS_FLAG))


def _mapping_has_publisher_spends(col_mapping: Optional[Dict]) -> bool:
    if not col_mapping:
        return False
    mapping = col_mapping.get("mapping") or {}
    if col_mapping.get("format_type") == "visual":
        return "spends" in (mapping.get("metrics") or {})
    return bool(mapping.get("spends"))


def _choose_publisher_spends(
    row_data: Dict[str, float],
    pub_row: Dict[str, Any],
    billing_config: Optional[Dict[str, Any]],
    fallback_formula: str,
) -> tuple:
    if _has_sheet_spends(pub_row):
        return row_data['Spends'], 'sheet'
    if billing_config:
        return _billing_spend_from_config(billing_config, row_data), 'calculated'
    if fallback_formula:
        return _evaluate_formula(fallback_formula, row_data), 'calculated'
    return row_data['Spends'], ('sheet' if row_data['Spends'] else None)


def _choose_advertiser_spends(
    row_data: Dict[str, float],
    adv_metrics: Dict[str, Any],
    billing_config: Optional[Dict[str, Any]],
    fallback_formula: str,
) -> tuple:
    if _has_metric(adv_metrics, "Spends", "spends", "Advertiser_Spends", "advertiser_spends"):
        return _get_metric_value(row_data, "Advertiser_Spends", "advertiser_spends"), 'sheet'
    if billing_config:
        return _billing_spend_from_config(billing_config, row_data), 'calculated'
    if fallback_formula:
        return _evaluate_formula(fallback_formula, row_data), 'calculated'
    fallback = _fallback_advertiser_spends(row_data)
    return fallback, ('calculated' if fallback else None)


def _compute_advertiser_metrics(adv_metric_names: List[str], row_data: Dict[str, float]) -> Dict[str, float]:
    """Auto-derive standard computed metrics based on which advertiser metrics are selected."""
    computed = {}
    pub_spends = row_data.get('Publisher_Spends', row_data.get('Spends', 0))
    selected_metrics = {str(name).strip().lower() for name in adv_metric_names}

    if pub_spends > 0:
        if 'leads' in selected_metrics or _get_metric_value(row_data, 'Leads') > 0:
            leads = _get_metric_value(row_data, 'Leads')
            if leads > 0:
                computed['CPL'] = round(pub_spends / leads, 2)
        if 'orders' in selected_metrics or _get_metric_value(row_data, 'Orders') > 0:
            orders = _get_metric_value(row_data, 'Orders')
            if orders > 0:
                computed['CPA'] = round(pub_spends / orders, 2)
        if 'sessions' in selected_metrics or _get_metric_value(row_data, 'Sessions') > 0:
            sessions = _get_metric_value(row_data, 'Sessions')
            if sessions > 0:
                computed['CPS'] = round(pub_spends / sessions, 2)

    if 'revenue' in selected_metrics or _get_metric_value(row_data, 'Revenue') > 0:
        revenue = _get_metric_value(row_data, 'Revenue')
        if revenue > 0 and pub_spends > 0:
            computed['ROAS'] = round(revenue / pub_spends, 2)

    return computed


async def _load_column_mapping(
    db: AsyncSession,
    name: str,
    map_type: str,
    sheet_url: Optional[str] = None,
    campaign_id: Optional[str] = None,
) -> Optional[Dict]:
    """Load the best saved column mapping from DB.

    Prefer campaign-scoped mappings, then mappings saved for the same sheet URL,
    then legacy name/type mappings.
    """
    params = {"type": map_type}
    clauses = ["type = :type"]
    scope_clauses = []
    order_parts = []
    if campaign_id:
        params["campaign_id"] = campaign_id
        scope_clauses.append("campaign_id = :campaign_id")
        order_parts.append("WHEN campaign_id = :campaign_id THEN 0")
    if sheet_url:
        params["sheet_url"] = sheet_url
        scope_clauses.append("(campaign_id IS NULL AND sheet_url = :sheet_url)")
        order_parts.append("WHEN campaign_id IS NULL AND sheet_url = :sheet_url THEN 1")
    if name:
        params["name"] = name
        scope_clauses.append("(campaign_id IS NULL AND name = :name)")
    if not scope_clauses:
        return None
    clauses.append("(" + " OR ".join(scope_clauses) + ")")
    order_sql = "CASE " + " ".join(order_parts + ["ELSE 2"]) + " END, updated_at DESC"
    result = await db.execute(text(
        "SELECT campaign_id, sheet_url, tab_name, header_row, data_start_row, mapping, format_type, "
        "tab_pattern, tab_match_mode "
        f"FROM rmn_column_mappings WHERE {' AND '.join(clauses)} ORDER BY {order_sql} LIMIT 1"
    ), params)
    row = result.fetchone()
    if not row:
        return None
    return {
        "campaign_id": row[0],
        "sheet_url": row[1],
        "tab_name": row[2],
        "header_row": row[3],
        "data_start_row": row[4],
        "mapping": json.loads(row[5]) if row[5] else {},
        "format_type": row[6],
        "tab_pattern": row[7],
        "tab_match_mode": row[8],
    }


def _open_spreadsheet_meta(service, sheet_id: str):
    """Return (meta, effective_sheet_id, converted_id).

    Uploaded Office files (.xlsx/.xls) live in Drive but the Sheets API refuses
    to read them ("The document must not be an Office file."). When we hit that,
    copy the file into a temporary native Google Sheet and read the copy. The
    caller MUST pass converted_id to _delete_converted() when done.
    """
    try:
        return service.spreadsheets().get(spreadsheetId=sheet_id).execute(), sheet_id, None
    except Exception as e:
        if "office file" in str(e).lower() or "not supported" in str(e).lower():
            from sheets_client import _get_credentials
            from googleapiclient.discovery import build as _build
            creds = _get_credentials()
            drive = _build("drive", "v3", credentials=creds)
            copy = drive.files().copy(
                fileId=sheet_id,
                body={"name": "_tmp_etl_conversion", "mimeType": "application/vnd.google-apps.spreadsheet"},
            ).execute()
            converted_id = copy["id"]
            meta = service.spreadsheets().get(spreadsheetId=converted_id).execute()
            logger.info(f"  Converted Office file to Google Sheet for ETL: {converted_id}")
            return meta, converted_id, converted_id
        raise


def _delete_converted(converted_id: Optional[str]) -> None:
    """Best-effort delete of a temporary sheet created by _open_spreadsheet_meta."""
    if not converted_id:
        return
    try:
        from sheets_client import _get_credentials
        from googleapiclient.discovery import build as _build
        creds = _get_credentials()
        drive = _build("drive", "v3", credentials=creds)
        drive.files().delete(fileId=converted_id).execute()
        logger.info(f"  Deleted temporary converted sheet: {converted_id}")
    except Exception as ex:
        logger.warning(f"  Failed to delete temp converted sheet {converted_id}: {ex}")


def _extract_visual_format(service, sheet_url: str, sheet_id: str,
                           col_mapping: Dict, segment_filter: str,
                           is_publisher: bool, metric_names: List[str]) -> List[Dict]:
    """Extract using visual format — direct column indices from the UI picker."""
    records = []
    mapping = col_mapping.get("mapping", {})
    date_col = int(mapping.get("date_col_index", 0))
    data_start = int(mapping.get("data_start_row", 1))
    seg_col = mapping.get("segment_col_index")
    if seg_col is not None:
        seg_col = int(seg_col)
    metrics_cfg = mapping.get("metrics", {})

    converted_id = None
    try:
        meta, sheet_id, converted_id = _open_spreadsheet_meta(service, sheet_id)
        tabs = [s['properties']['title'] for s in meta.get('sheets', [])]

        target_tabs = _resolve_tabs(tabs, col_mapping, sheet_url=sheet_url,
                                    default_all_tabs=True)

        for tab_name, year, month in target_tabs:
            try:
                result = service.spreadsheets().values().get(
                    spreadsheetId=sheet_id, range=f"'{tab_name}'!A1:ZZ"
                ).execute()
            except Exception as e:
                if '429' in str(e):
                    logger.warning("Rate limited, waiting 60s...")
                    time.sleep(60)
                    result = service.spreadsheets().values().get(
                        spreadsheetId=sheet_id, range=f"'{tab_name}'!A1:ZZ"
                    ).execute()
                else:
                    logger.error(f"Error reading tab {tab_name}: {e}")
                    continue

            rows = result.get('values', [])
            if len(rows) < data_start:
                continue

            data_rows = rows[data_start - 1:]
            slash_order = _detect_slash_order(
                row[date_col].strip() for row in data_rows if len(row) > date_col and row[date_col])
            logger.info(f"  Visual format: tab={tab_name}, date_col={date_col}, data_start={data_start}, metrics={list(metrics_cfg.keys())}, rows={len(data_rows)}, slash_order={slash_order}")

            for row in data_rows:
                if len(row) <= date_col or not row[date_col]:
                    continue

                # Segment filter
                if seg_col is not None and segment_filter:
                    seg_val = row[seg_col].strip() if len(row) > seg_col else ""
                    if not _matches_segment(seg_val, segment_filter):
                        continue

                date_str = _parse_date_from_row(row[date_col].strip(), year, month, slash_order)
                if not date_str:
                    continue

                record = {'Date': date_str}

                if is_publisher:
                    record[SHEET_SPENDS_FLAG] = 'spends' in metrics_cfg
                    # Map metric keys to standard publisher field names
                    pub_metric_map = {
                        'impressions': 'Impressions', 'distribution': 'Distribution',
                        'clicks': 'Clicks', 'orders': 'Orders_pub', 'spends': 'Spends',
                        'scratches': 'Scratches', 'coins_burned': 'Coins_Burned',
                        'redirections': 'Redirections',
                    }
                    for metric_key, cfg in metrics_cfg.items():
                        col_idx = int(cfg['col']) if isinstance(cfg, dict) else int(cfg)
                        std_name = pub_metric_map.get(metric_key, metric_key.capitalize())
                        record[std_name] = _safe_float(row[col_idx]) if len(row) > col_idx else 0
                    # Ensure all standard publisher fields have a value
                    for std in ['Impressions', 'Distribution', 'Clicks', 'Orders_pub', 'Spends', 'Scratches', 'Coins_Burned', 'Redirections']:
                        if std not in record:
                            record[std] = 0
                else:
                    for metric_key, cfg in metrics_cfg.items():
                        col_idx = int(cfg['col']) if isinstance(cfg, dict) else int(cfg)
                        record[metric_key.capitalize()] = _safe_float(row[col_idx]) if len(row) > col_idx else 0

                records.append(record)

    except Exception as e:
        logger.error(f"Error extracting visual format from {sheet_url}: {e}")
    finally:
        _delete_converted(converted_id)

    return records


def _extract_from_sheet(service, sheet_url: str, segment_filter: str,
                        offer_filter: str, metric_names: List[str],
                        is_publisher: bool, col_mapping: Optional[Dict] = None) -> List[Dict]:
    """Extract records from a Google Sheet. Uses col_mapping if provided,
    otherwise falls back to legacy RZP-tab segment-block format."""
    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', sheet_url)
    if not match:
        logger.error(f"Invalid sheet URL: {sheet_url}")
        return []

    sheet_id = match.group(1)
    records = []

    # Handle "visual" format — direct column indices from visual picker
    if col_mapping and col_mapping.get("format_type") == "visual":
        return _extract_visual_format(service, sheet_url, sheet_id, col_mapping,
                                      segment_filter, is_publisher, metric_names)

    converted_id = None
    try:
        meta, sheet_id, converted_id = _open_spreadsheet_meta(service, sheet_id)
        tabs = [s['properties']['title'] for s in meta.get('sheets', [])]

        # Determine tabs to process (unified resolver; no all-tabs fallback)
        target_tabs = _resolve_tabs(tabs, col_mapping, sheet_url=sheet_url,
                                    allow_rzp_discovery=True)

        cfg_header_row = (col_mapping.get("header_row", 3) if col_mapping else None)
        cfg_data_start = (col_mapping.get("data_start_row", cfg_header_row + 1) if col_mapping else None)
        field_map = col_mapping.get("mapping", {}) if col_mapping else {}

        for tab_name, year, month in target_tabs:
            try:
                result = service.spreadsheets().values().get(
                    spreadsheetId=sheet_id, range=f"'{tab_name}'!A1:ZZ"
                ).execute()
            except Exception as e:
                if '429' in str(e):
                    logger.warning("Rate limited, waiting 60s...")
                    time.sleep(60)
                    result = service.spreadsheets().values().get(
                        spreadsheetId=sheet_id, range=f"'{tab_name}'!A1:ZZ"
                    ).execute()
                else:
                    logger.error(f"Error reading tab {tab_name}: {e}")
                    continue

            rows = result.get('values', [])
            if len(rows) < 2:
                continue

            # Auto-detect header row for publishers if not explicitly configured
            actual_header_row = cfg_header_row
            actual_data_start = cfg_data_start
            if actual_header_row is None:
                # Check Row 1 for standard publisher columns (Date, Clicks, Impressions, etc.)
                if rows and any(h.strip() in ('Date', 'Clicks', 'Impressions', 'Spends') for h in (rows[0] if rows else []) if h):
                    actual_header_row = 1
                    actual_data_start = 2
                elif len(rows) >= 3 and any(h.strip() in ('Date', 'Clicks', 'Impressions', 'Spends') for h in (rows[2] if len(rows) > 2 else []) if h):
                    actual_header_row = 3
                    actual_data_start = 4
                else:
                    actual_header_row = 1
                    actual_data_start = 2

            if len(rows) < actual_data_start:
                continue

            header_row = rows[actual_header_row - 1]
            data_rows = rows[actual_data_start - 1:]

            # Build col_map: header_name → column_index
            col_map = {}
            for i, h in enumerate(header_row):
                if h and h.strip():
                    col_map[h.strip()] = i
            # Case-insensitive view so lowercase metric names ("revenue") match
            # capitalized sheet headers ("Revenue"). First occurrence wins.
            col_map_lower = {}
            for name, i in col_map.items():
                col_map_lower.setdefault(name.lower(), i)

            # If we have a configured field_map, use it to resolve standard keys
            if col_mapping and field_map:
                # field_map: { "date": "Date", "clicks": "Clicks", ... }
                resolved = {}
                for std_key, sheet_col_name in field_map.items():
                    if sheet_col_name and sheet_col_name in col_map:
                        resolved[std_key] = col_map[sheet_col_name]
                # Use resolved mapping
                date_idx = resolved.get("date")
                seg_idx = col_map.get("Segment", col_map.get("segment"))
            else:
                # Legacy: use header names directly
                date_idx = col_map.get("Date")
                seg_idx = col_map.get("Segment")
                resolved = None

            if date_idx is None:
                logger.warning(f"No Date column found in tab {tab_name}")
                continue

            slash_order = _detect_slash_order(
                row[date_idx].strip() for row in data_rows if len(row) > date_idx and row[date_idx])

            for row in data_rows:
                if len(row) <= date_idx:
                    continue

                # Segment filter
                if seg_idx is not None and segment_filter:
                    seg_val = row[seg_idx].strip() if len(row) > seg_idx else ""
                    if not _matches_segment(seg_val, segment_filter):
                        continue

                date_str = _parse_date_from_row(row[date_idx], year, month, slash_order)
                if not date_str:
                    continue

                record = {'Date': date_str}

                if is_publisher:
                    if resolved:
                        record[SHEET_SPENDS_FLAG] = 'spends' in resolved
                        record['Impressions'] = _safe_float(row[resolved['impressions']]) if 'impressions' in resolved and len(row) > resolved['impressions'] else 0
                        record['Distribution'] = _safe_float(row[resolved['distribution']]) if 'distribution' in resolved and len(row) > resolved['distribution'] else 0
                        record['Clicks'] = _safe_float(row[resolved['clicks']]) if 'clicks' in resolved and len(row) > resolved['clicks'] else 0
                        record['Orders_pub'] = _safe_float(row[resolved['orders']]) if 'orders' in resolved and len(row) > resolved['orders'] else 0
                        record['Scratches'] = _safe_float(row[resolved['scratches']]) if 'scratches' in resolved and len(row) > resolved['scratches'] else 0
                        record['Coins_Burned'] = _safe_float(row[resolved.get('coins_burned', -1)]) if 'coins_burned' in resolved and len(row) > resolved.get('coins_burned', 999) else 0
                        record['Redirections'] = _safe_float(row[resolved['redirections']]) if 'redirections' in resolved and len(row) > resolved['redirections'] else 0
                        record['Spends'] = _safe_float(row[resolved['spends']]) if 'spends' in resolved and len(row) > resolved['spends'] else 0
                    else:
                        record[SHEET_SPENDS_FLAG] = 'Spends' in col_map
                        record['Impressions'] = _safe_float(row[col_map['Impressions']]) if 'Impressions' in col_map and len(row) > col_map['Impressions'] else 0
                        record['Distribution'] = _safe_float(row[col_map['Distribution']]) if 'Distribution' in col_map and len(row) > col_map['Distribution'] else 0
                        record['Clicks'] = _safe_float(row[col_map['Clicks']]) if 'Clicks' in col_map and len(row) > col_map['Clicks'] else 0
                        record['Orders_pub'] = _safe_float(row[col_map['Orders']]) if 'Orders' in col_map and len(row) > col_map['Orders'] else 0
                        record['Scratches'] = _safe_float(row[col_map['Scratches']]) if 'Scratches' in col_map and len(row) > col_map['Scratches'] else 0
                        record['Coins_Burned'] = _safe_float(row[col_map.get('Coins Burned', col_map.get('Coins_Burned', -1))]) if ('Coins Burned' in col_map or 'Coins_Burned' in col_map) else 0
                        record['Redirections'] = _safe_float(row[col_map['Redirections']]) if 'Redirections' in col_map and len(row) > col_map['Redirections'] else 0
                        record['Spends'] = _safe_float(row[col_map['Spends']]) if 'Spends' in col_map and len(row) > col_map['Spends'] else 0
                else:
                    for metric_name in metric_names:
                        if resolved:
                            mk = metric_name.lower().replace(' ', '_')
                            if mk in resolved and len(row) > resolved[mk]:
                                record[metric_name] = _safe_float(row[resolved[mk]])
                            else:
                                record[metric_name] = 0.0
                        else:
                            idx = col_map.get(metric_name, col_map_lower.get(metric_name.strip().lower()))
                            if idx is not None and len(row) > idx:
                                record[metric_name] = _safe_float(row[idx])
                            else:
                                record[metric_name] = 0.0

                records.append(record)

    except Exception as e:
        logger.error(f"Error extracting from {sheet_url}: {e}")
    finally:
        _delete_converted(converted_id)

    return records


def _extract_promo_code_sheet(service, sheet_url: str, promo_code: str,
                              code_row: int = 3, data_start_row: int = 10,
                              date_col: int = 0,
                              metric_columns: Optional[Dict[str, int]] = None) -> List[Dict]:
    """Extract advertiser data from a sheet using configured column positions.

    Supports two modes:
    1. Single promo_code: finds the code in code_row, reads that column
    2. Multi-metric (metric_columns): reads from specific column indices
       metric_columns = {"orders": 5, "revenue": 6}
    """
    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', sheet_url)
    if not match:
        return []

    sheet_id = match.group(1)
    records = []

    converted_id = None
    try:
        meta, sheet_id, converted_id = _open_spreadsheet_meta(service, sheet_id)
        tabs = [s['properties']['title'] for s in meta.get('sheets', [])]
        target_tabs = [t for t in tabs if 'RZP' in t.upper()] or tabs[:1]

        for tab_name in target_tabs:
            ym = _parse_tab_month(tab_name)
            year, month = ym if ym else (None, None)

            try:
                result = service.spreadsheets().values().get(
                    spreadsheetId=sheet_id, range=f"'{tab_name}'!A1:ZZ"
                ).execute()
            except Exception as e:
                if '429' in str(e):
                    time.sleep(60)
                    result = service.spreadsheets().values().get(
                        spreadsheetId=sheet_id, range=f"'{tab_name}'!A1:ZZ"
                    ).execute()
                else:
                    logger.error(f"Error reading tab {tab_name}: {e}")
                    continue

            rows = result.get('values', [])

            # Determine which columns to read
            cols_to_read = {}
            if metric_columns:
                cols_to_read = metric_columns
            elif promo_code and len(rows) >= code_row:
                codes_row = rows[code_row - 1]
                promo_col = None
                for i, cell in enumerate(codes_row):
                    if cell and cell.strip().upper() == promo_code.strip().upper():
                        promo_col = i
                        break
                if promo_col is None:
                    logger.warning(f"Promo code '{promo_code}' not found in row {code_row} of {tab_name}")
                    continue
                cols_to_read = {"orders": promo_col}
                logger.info(f"  Found promo '{promo_code}' at column {promo_col} in {tab_name}")

            if not cols_to_read:
                continue

            # Extract daily data from data_start_row onward
            _promo_rows = rows[data_start_row - 1:]
            slash_order = _detect_slash_order(
                row[date_col].strip() for row in _promo_rows if row and len(row) > date_col and row[date_col])
            for row in _promo_rows:
                if not row or len(row) <= date_col or not row[date_col]:
                    continue
                date_str = _parse_date_from_row(row[date_col].strip(), year, month, slash_order)
                if not date_str:
                    continue
                record = {'Date': date_str}
                for metric_key, col_idx in cols_to_read.items():
                    record[metric_key.capitalize()] = _safe_float(row[col_idx]) if len(row) > col_idx else 0
                records.append(record)

    except Exception as e:
        logger.error(f"Error extracting promo code sheet: {e}")
    finally:
        _delete_converted(converted_id)

    return records


def preview_mapping(service, sheet_url: str, col_mapping: Dict,
                    is_publisher: bool = False) -> Dict[str, Any]:
    """Read-only dry run of a column mapping. Writes NOTHING to Postgres.

    Resolves tabs exactly the way ingest does (rolling when tab_pattern is set,
    else exact tab_name), detects each tab's month, and counts how much data is
    actually fillable. Every matched tab is classified so the operator can tell
    a real config bug from "the advertiser just hasn't filled it yet":

      * ready         — dates parse AND at least one mapped metric has a value.
      * awaiting_data — tab matched and month parsed, but it's blank (no rows),
                        or dates exist yet every mapped metric cell is still
                        empty. This is NOT an error. We don't own the data —
                        advertisers/publishers fill it — and the next sync will
                        capture it automatically the moment they do.
      * check_config  — the date column has non-empty cells but none parse as a
                        date (likely the wrong column or an unreadable format),
                        or the tab could not be read at all.

    Uses the same primitives as the extractors (_resolve_tabs' matching rules,
    _parse_tab_month, _detect_slash_order, _parse_date_from_row) so the preview
    can't disagree with what a real sync would ingest.
    """
    pattern = (col_mapping.get("tab_pattern") or "").strip()
    tab_name_cfg = (col_mapping.get("tab_name") or "").strip()
    report: Dict[str, Any] = {
        "match_mode": "rolling" if pattern else "exact",
        "pattern": pattern,
        "tab_name": tab_name_cfg,
        "all_tab_count": 0,
        "matched": [],
        "skipped": [],       # matched the pattern but no parseable month
        "unmatched_count": 0,
        "converted_office_file": False,
        "error": None,
    }

    match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', sheet_url)
    if not match:
        report["error"] = "Invalid sheet URL"
        return report
    sheet_id = match.group(1)

    mapping = col_mapping.get("mapping", {}) or {}
    date_col = int(mapping.get("date_col_index", 0))
    data_start = int(mapping.get("data_start_row",
                                 mapping.get("date_start_row", 1)) or 1)
    metrics_cfg = mapping.get("metrics", {}) or {}
    metric_cols: Dict[str, int] = {}
    for k, v in metrics_cfg.items():
        try:
            metric_cols[k] = int(v["col"]) if isinstance(v, dict) else int(v)
        except (TypeError, ValueError, KeyError):
            continue

    converted_id = None
    try:
        meta, sheet_id, converted_id = _open_spreadsheet_meta(service, sheet_id)
        report["converted_office_file"] = converted_id is not None
        tabs = [s['properties']['title'] for s in meta.get('sheets', [])]
        report["all_tab_count"] = len(tabs)

        # Mirror _resolve_tabs matching so preview == ingest, while also
        # surfacing the tabs that were skipped/unmatched (which _resolve_tabs
        # only logs).
        resolved = []  # (tab, year, month)
        if pattern:
            for t in tabs:
                if pattern.lower() in t.lower():
                    ym = _parse_tab_month(t)
                    if ym:
                        resolved.append((t, ym[0], ym[1]))
                    else:
                        report["skipped"].append(
                            {"tab": t, "reason": "matches pattern but has no month token"})
                else:
                    report["unmatched_count"] += 1
        elif tab_name_cfg:
            for t in tabs:
                if tab_name_cfg.lower() in t.lower():
                    ym = _parse_tab_month(t)
                    resolved.append((t, ym[0] if ym else None, ym[1] if ym else None))
                else:
                    report["unmatched_count"] += 1
            if not resolved:
                report["error"] = f"Configured tab '{tab_name_cfg}' not found in this sheet"
        else:
            report["error"] = "No tab pattern or tab name configured"

        for tab_name, year, month in resolved:
            entry = {
                "tab": tab_name,
                "month": f"{year}-{month}" if year and month else None,
                "data_rows": 0,
                "dated_rows": 0,
                "rows_with_data": 0,
                "date_min": None,
                "date_max": None,
                "status": "awaiting_data",
                "note": "",
            }
            try:
                vals = service.spreadsheets().values().get(
                    spreadsheetId=sheet_id, range=f"'{tab_name}'!A1:ZZ").execute()
                rows = vals.get('values', [])
            except Exception as e:
                entry["status"] = "check_config"
                entry["note"] = f"could not read tab ({e})"
                report["matched"].append(entry)
                continue

            data_rows = rows[data_start - 1:] if len(rows) >= data_start else []
            filled = [r for r in data_rows
                      if len(r) > date_col and str(r[date_col]).strip()]
            entry["data_rows"] = len(filled)

            slash_order = _detect_slash_order(
                str(r[date_col]).strip() for r in filled)
            parsed_dates = []
            rows_with_data = 0
            for r in filled:
                ds = _parse_date_from_row(str(r[date_col]).strip(), year, month, slash_order)
                if not ds:
                    continue
                parsed_dates.append(ds)
                for col in metric_cols.values():
                    if len(r) > col and str(r[col]).strip() and _safe_float(r[col]) != 0:
                        rows_with_data += 1
                        break
            entry["dated_rows"] = len(parsed_dates)
            entry["rows_with_data"] = rows_with_data
            if parsed_dates:
                entry["date_min"] = min(parsed_dates)
                entry["date_max"] = max(parsed_dates)

            if len(filled) == 0:
                entry["status"] = "awaiting_data"
                entry["note"] = "no rows filled yet"
            elif len(parsed_dates) == 0:
                entry["status"] = "check_config"
                entry["note"] = ("date column has values but none parse as dates "
                                 "— wrong column or unrecognised format?")
            elif metric_cols and rows_with_data == 0:
                entry["status"] = "awaiting_data"
                entry["note"] = "dates present but every mapped metric cell is still blank"
            else:
                entry["status"] = "ready"
            report["matched"].append(entry)

    except Exception as e:
        report["error"] = str(e)
        logger.error(f"preview_mapping error for {sheet_url}: {e}")
    finally:
        _delete_converted(converted_id)

    return report


async def sync_campaign(db: AsyncSession, campaign: models.Campaign) -> Dict[str, Any]:
    """Sync one campaign: pull sheets → merge → store in Postgres."""
    from sheets_client import _get_service

    if not campaign.advertiser_data_url or not campaign.publisher_data_url:
        return {"error": "Missing data sheet URLs", "rows": 0}
    if not campaign.segment_pub or not campaign.segment_adv:
        return {"error": "Missing segment names", "rows": 0}

    # Parse metrics config
    metrics_config = {}
    try:
        metrics_config = json.loads(campaign.metrics_json or '{}')
    except Exception:
        pass

    adv_metric_names = metrics_config.get('advertiser_metrics', [])
    direct_metrics = adv_metric_names

    service = _get_service()

    # Load configurable column mappings from DB (if saved via Column Mapper UI)
    pub_col_mapping = await _load_column_mapping(
        db, campaign.publisher_name or "", "publisher",
        sheet_url=campaign.publisher_data_url, campaign_id=campaign.id,
    )
    adv_col_mapping = await _load_column_mapping(
        db, campaign.advertiser_name or "", "advertiser",
        sheet_url=campaign.advertiser_data_url, campaign_id=campaign.id,
    )
    if pub_col_mapping:
        logger.info(f"  Using saved column mapping for publisher '{campaign.publisher_name}'")
    if adv_col_mapping:
        logger.info(f"  Using saved column mapping for advertiser '{campaign.advertiser_name}'")

    # Extract advertiser data
    logger.info(f"Syncing {campaign.id}: pulling advertiser data...")
    if adv_col_mapping and adv_col_mapping.get("format_type") == "promo_pivot":
        mapping_data = adv_col_mapping.get("mapping", {})
        code_row = adv_col_mapping.get("header_row", 3)
        date_col = int(mapping_data.get("date_col_index", 0))
        data_start = int(mapping_data.get("date_start_row", adv_col_mapping.get("data_start_row", 10)))
        # Check for multi-metric config (new visual picker format)
        metrics_cfg = mapping_data.get("metrics")
        if metrics_cfg and isinstance(metrics_cfg, dict):
            metric_columns = {k: int(v["col"]) for k, v in metrics_cfg.items() if isinstance(v, dict) and "col" in v}
            logger.info(f"  Using multi-metric mapping: {list(metric_columns.keys())}, date_col={date_col}, data_start={data_start}")
            adv_records = _extract_promo_code_sheet(
                service, campaign.advertiser_data_url,
                promo_code="", code_row=code_row, data_start_row=data_start,
                date_col=date_col, metric_columns=metric_columns,
            )
        else:
            # Legacy single-value mode
            promo_code = mapping_data.get("orders") or campaign.segment_adv
            logger.info(f"  Using promo_pivot mapping: code='{promo_code}', code_row={code_row}, data_start={data_start}")
            adv_records = _extract_promo_code_sheet(
                service, campaign.advertiser_data_url,
                promo_code=promo_code, code_row=code_row, data_start_row=data_start,
                date_col=date_col,
            )
    else:
        adv_records = _extract_from_sheet(
            service, campaign.advertiser_data_url,
            segment_filter=campaign.segment_adv,
            offer_filter=campaign.offer_title or "",
            metric_names=direct_metrics,
            is_publisher=False,
            col_mapping=adv_col_mapping,
        )
        # If standard extraction returned nothing, try promo-code pivoted format
        if not adv_records and campaign.segment_adv:
            logger.info(f"  Standard extraction empty, trying promo-code format for '{campaign.segment_adv}'...")
            adv_records = _extract_promo_code_sheet(
                service, campaign.advertiser_data_url,
                promo_code=campaign.segment_adv,
            )
    logger.info(f"  Advertiser records: {len(adv_records)}")

    # Extract publisher data
    logger.info(f"  Pulling publisher data...")
    pub_records = _extract_from_sheet(
        service, campaign.publisher_data_url,
        segment_filter=campaign.segment_pub,
        offer_filter=campaign.offer_title or "",
        metric_names=[],
        is_publisher=True,
        col_mapping=pub_col_mapping,
    )
    logger.info(f"  Publisher records: {len(pub_records)}")

    pub_model = getattr(campaign, "publisher_billing_model", None) or ("cpc" if campaign.cpc_cpd else "")
    pub_rate = _safe_float(getattr(campaign, "publisher_billing_rate", None) or campaign.cpc_cpd)
    pub_formula = _publisher_formula_from_terms(pub_model, pub_rate)
    adv_model = ''
    adv_rate = 0.0
    if campaign.advertiser_ref_id:
        adv_result = await db.execute(
            text("SELECT buy_type, roas_multiplier, cpc_rate FROM rmn_advertisers WHERE id = :id"),
            {"id": campaign.advertiser_ref_id}
        )
        adv = adv_result.fetchone()
        if adv:
            adv_model = (adv[0] or '').lower()
            adv_rate = _safe_float(adv[1] if adv_model == 'roas' else adv[2])
    adv_formula = _advertiser_formula_from_terms(adv_model, adv_rate)
    billing_configs = await _load_billing_configs(db, campaign.id)
    has_pub_billing = any(cfg.get("side") == "publisher" for cfg in billing_configs)
    has_adv_billing = any(cfg.get("side") == "advertiser" for cfg in billing_configs)
    if has_pub_billing:
        logger.info("  Publisher billing config found; it will override sales-pipeline spend formula when active")
    if has_adv_billing:
        logger.info("  Advertiser billing config found; it will be used when direct advertiser spend is absent")
    if pub_formula:
        logger.info(f"  Publisher spends formula: {pub_formula} (billing_model={pub_model}, rate={pub_rate})")
    if adv_formula:
        logger.info(f"  Advertiser spends formula: {adv_formula} (billing_model={adv_model}, rate={adv_rate})")

    # Merge on Date (full outer join)
    adv_by_date = {r['Date']: r for r in adv_records}
    pub_by_date = {r['Date']: r for r in pub_records}
    all_dates = sorted(set(list(adv_by_date.keys()) + list(pub_by_date.keys())))

    rows_synced = 0
    now = datetime.now(timezone.utc)

    for date_str in all_dates:
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
        except Exception:
            continue

        adv_row = adv_by_date.get(date_str, {})
        pub_row = pub_by_date.get(date_str, {})

        # Build merged row_data for formula evaluation (all numeric values)
        row_data = {}
        row_data['Impressions'] = _safe_float(pub_row.get('Impressions', 0))
        row_data['Distribution'] = _safe_float(pub_row.get('Distribution', 0))
        row_data['Clicks'] = _safe_float(pub_row.get('Clicks', 0))
        row_data['Orders_pub'] = _safe_float(pub_row.get('Orders_pub', 0))
        row_data['Scratches'] = _safe_float(pub_row.get('Scratches', 0))
        row_data['Coins_Burned'] = _safe_float(pub_row.get('Coins_Burned', 0))
        row_data['Redirections'] = _safe_float(pub_row.get('Redirections', 0))
        row_data['Spends'] = _safe_float(pub_row.get('Spends', 0))
        # Standard computed publisher metrics
        clicks = row_data['Clicks']
        spends = row_data['Spends']
        distribution = row_data['Distribution']
        row_data['CTR'] = (clicks / distribution * 100) if distribution > 0 else 0
        row_data['CPM'] = (spends / distribution * 1000) if distribution > 0 else 0
        row_data['CPC'] = (spends / clicks) if clicks > 0 else 0
        # Advertiser raw metrics
        for k, v in adv_row.items():
            if k != 'Date':
                _add_metric_alias(row_data, k, v)

        pub_billing_config = _active_billing_config(billing_configs, "publisher", date_obj)
        adv_billing_config = _active_billing_config(billing_configs, "advertiser", date_obj)
        pub_spends, pub_spends_source = _choose_publisher_spends(row_data, pub_row, pub_billing_config, pub_formula)
        adv_spends, adv_spends_source = _choose_advertiser_spends(row_data, adv_row, adv_billing_config, adv_formula)

        # Auto-compute standard metrics (CPL, CPA, ROAS etc.) based on selected advertiser metrics
        adv_metrics_dict = {k: v for k, v in adv_row.items() if k != 'Date'}
        row_data['Publisher_Spends'] = pub_spends
        row_data['Advertiser_Spends'] = adv_spends
        computed = _compute_advertiser_metrics(adv_metric_names, row_data)
        adv_metrics_dict.update(computed)

        # Upsert to DB
        await db.execute(text("""
            INSERT INTO rmn_campaign_metrics
                (campaign_id, date, advertiser, publisher, segment,
                 impressions, distribution, clicks, orders_pub, scratches,
                 coins_burned, redirections, spends, publisher_spends,
                 advertiser_spends, publisher_spends_source, advertiser_spends_source,
                 advertiser_metrics, synced_at)
            VALUES
                (:campaign_id, :date, :advertiser, :publisher, :segment,
                 :impressions, :distribution, :clicks, :orders_pub, :scratches,
                 :coins_burned, :redirections, :spends, :publisher_spends,
                 :advertiser_spends, :publisher_spends_source, :advertiser_spends_source,
                 :advertiser_metrics, :synced_at)
            ON CONFLICT (campaign_id, date) DO UPDATE SET
                impressions = EXCLUDED.impressions,
                distribution = EXCLUDED.distribution,
                clicks = EXCLUDED.clicks,
                orders_pub = EXCLUDED.orders_pub,
                scratches = EXCLUDED.scratches,
                coins_burned = EXCLUDED.coins_burned,
                redirections = EXCLUDED.redirections,
                spends = EXCLUDED.spends,
                publisher_spends = EXCLUDED.publisher_spends,
                advertiser_spends = EXCLUDED.advertiser_spends,
                publisher_spends_source = EXCLUDED.publisher_spends_source,
                advertiser_spends_source = EXCLUDED.advertiser_spends_source,
                advertiser_metrics = EXCLUDED.advertiser_metrics,
                synced_at = EXCLUDED.synced_at
        """), {
            "campaign_id": campaign.id,
            "date": date_obj,
            "advertiser": campaign.advertiser_name,
            "publisher": campaign.publisher_name,
            "segment": campaign.segment_pub,
            "impressions": int(pub_row.get('Impressions', 0)),
            "distribution": int(pub_row.get('Distribution', 0)),
            "clicks": int(pub_row.get('Clicks', 0)),
            "orders_pub": int(pub_row.get('Orders_pub', 0)),
            "scratches": int(pub_row.get('Scratches', 0)),
            "coins_burned": int(pub_row.get('Coins_Burned', 0)),
            "redirections": int(pub_row.get('Redirections', 0)),
            "spends": float(pub_row.get('Spends', 0)),
            "publisher_spends": pub_spends,
            "advertiser_spends": adv_spends,
            "publisher_spends_source": pub_spends_source,
            "advertiser_spends_source": adv_spends_source,
            "advertiser_metrics": json.dumps(adv_metrics_dict),
            "synced_at": now,
        })
        rows_synced += 1

    await db.commit()
    logger.info(f"  Synced {rows_synced} rows for {campaign.id}")
    return {"rows": rows_synced, "campaign_id": campaign.id}


async def sync_all_campaigns(db: AsyncSession) -> List[Dict[str, Any]]:
    """Sync all LIVE campaigns with tracking submitted."""
    from sqlalchemy import select
    result = await db.execute(
        select(models.Campaign).where(
            models.Campaign.tracking_submitted == True,
            models.Campaign.advertiser_data_url.isnot(None),
            models.Campaign.publisher_data_url.isnot(None),
        )
    )
    campaigns = result.scalars().all()
    results = []
    for camp in campaigns:
        try:
            r = await sync_campaign(db, camp)
            results.append(r)
        except Exception as e:
            logger.error(f"Sync failed for {camp.id}: {e}")
            results.append({"campaign_id": camp.id, "error": str(e), "rows": 0})
    return results


# ── BHIM Gmail Sync ───────────────────────────────────────────────────────────

async def sync_bhim_from_gmail(db: AsyncSession) -> Dict[str, Any]:
    """Fetch latest BHIM campaign report from Gmail and import into Postgres."""
    import base64
    from html.parser import HTMLParser
    from datetime import date as date_type

    try:
        from sheets_client import _get_credentials
        from googleapiclient.discovery import build

        creds = _get_credentials()
        gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)

        # Search for BHIM campaign emails
        results = gmail.users().messages().list(
            userId="me",
            q='subject:"Razorpay<>BHIM" OR subject:"Razorpay BHIM Campaign"',
            maxResults=10
        ).execute()
        messages = results.get("messages", [])

        if not messages:
            return {"error": "No BHIM emails found", "rows": 0}

        # Find the one with actual data table
        table_html = None
        email_date = None
        for m in messages:
            msg = gmail.users().messages().get(userId="me", id=m["id"], format="raw").execute()
            raw = base64.urlsafe_b64decode(msg["raw"]).decode("utf-8", errors="ignore")

            if "Impression" in raw and "Spend" in raw and "MTD" in raw:
                # Extract date from headers
                for line in raw.split("\n")[:30]:
                    if line.startswith("Date:"):
                        email_date = line.replace("Date:", "").strip()
                        break

                # Extract HTML table
                html_start = raw.find("<table")
                if html_start > 0:
                    html_end = raw.find("</table>", html_start)
                    table_html = raw[html_start:html_end + 8]
                    break

        if not table_html:
            return {"error": "No BHIM email with data table found", "rows": 0}

        logger.info(f"Found BHIM email dated: {email_date}")

        # Parse HTML table
        class TableParser(HTMLParser):
            def __init__(self):
                super().__init__()
                self.rows = []
                self.current_row = []
                self.current_cell = ""
                self.in_td = False

            def handle_starttag(self, tag, attrs):
                if tag in ("td", "th"):
                    self.in_td = True
                    self.current_cell = ""

            def handle_endtag(self, tag):
                if tag in ("td", "th"):
                    self.in_td = False
                    self.current_row.append(self.current_cell.strip())
                elif tag == "tr":
                    if self.current_row:
                        self.rows.append(self.current_row)
                    self.current_row = []

            def handle_data(self, data):
                if self.in_td:
                    self.current_cell += data

        parser = TableParser()
        parser.feed(table_html)

        # Find brands (row 0) and MTD values (row 2)
        if len(parser.rows) < 3:
            return {"error": "Table too small to parse", "rows": 0}

        brands_row = parser.rows[0]  # Brand names
        mtd_row = None
        for row in parser.rows:
            if row and row[0] == "MTD":
                mtd_row = row
                break

        if not mtd_row:
            return {"error": "No MTD row found in table", "rows": 0}

        # Extract brand names (skip first cell which is empty/header)
        brands = [b.strip() for b in brands_row[1:] if b.strip() and b.strip() != "=C2=A0"]

        # Extract MTD values (groups of 3: Impression, Clicks, Spend)
        mtd_values = mtd_row[1:]  # skip "MTD" label

        records = []
        for i, brand in enumerate(brands):
            idx = i * 3
            if idx + 2 >= len(mtd_values):
                break

            def parse_num(val):
                clean = val.replace(",", "").replace("=C2=A0", "0").replace("\xa0", "0").strip()
                try:
                    return float(clean)
                except:
                    return 0

            impressions = int(parse_num(mtd_values[idx]))
            clicks = int(parse_num(mtd_values[idx + 1]))
            spends = parse_num(mtd_values[idx + 2])

            if spends > 0 or impressions > 0:
                records.append({
                    "advertiser": brand,
                    "impressions": impressions,
                    "clicks": clicks,
                    "spends": spends,
                })

        if not records:
            return {"error": "No data parsed from table", "rows": 0}

        # Import to Postgres
        from sqlalchemy import text as sa_text
        await db.execute(sa_text("DELETE FROM rmn_campaign_metrics WHERE publisher = 'BHIM' AND date >= '2026-06-01'"))

        today = date_type.today()
        batch = []
        used_ids = set()
        for r in records:
            # Campaign id must be unique per brand: a 3-letter prefix collides
            # (e.g. "Ariesone Sunglass" and "Ariesone Trimmer" both -> ARI,
            # violating the (campaign_id, date) unique index). Use the full
            # cleaned brand name, truncated to fit the String(32) column
            # (3 "BF-" + 25 + 4 "-BHI" = 32), with a numeric suffix as a
            # last-resort tiebreaker.
            adv_code = re.sub(r"[^A-Za-z]", "", r["advertiser"]).upper() or "UNK"
            campaign_id = f"BF-{adv_code[:25]}-BHI"
            n = 2
            while campaign_id in used_ids:
                campaign_id = f"BF-{adv_code[:23]}{n}-BHI"
                n += 1
            used_ids.add(campaign_id)
            batch.append({
                "campaign_id": campaign_id,
                "date": today,
                "advertiser": r["advertiser"],
                "publisher": "BHIM",
                "segment": "",
                "impressions": r["impressions"],
                "distribution": 0,
                "clicks": r["clicks"],
                "orders_pub": 0,
                "scratches": 0,
                "coins_burned": 0,
                "redirections": 0,
                "spends": r["spends"],
                "publisher_spends": r["spends"],
                "advertiser_spends": r["spends"] / 0.75,
                "advertiser_metrics": None,
                "synced_at": datetime.now(timezone.utc),
            })

        if batch:
            await db.execute(sa_text("""
                INSERT INTO rmn_campaign_metrics (campaign_id, date, advertiser, publisher, segment, impressions, distribution, clicks, orders_pub, scratches, coins_burned, redirections, spends, publisher_spends, advertiser_spends, advertiser_metrics, synced_at)
                VALUES (:campaign_id, :date, :advertiser, :publisher, :segment, :impressions, :distribution, :clicks, :orders_pub, :scratches, :coins_burned, :redirections, :spends, :publisher_spends, :advertiser_spends, :advertiser_metrics, :synced_at)
            """), batch)
            await db.commit()

        total_spends = sum(r["spends"] for r in records)
        logger.info(f"BHIM sync: {len(batch)} brands, total spends: {total_spends:,.0f}")
        return {"rows": len(batch), "total_spends": total_spends, "source": "gmail"}

    except Exception as e:
        logger.error(f"BHIM Gmail sync failed: {e}")
        return {"error": str(e), "rows": 0}
