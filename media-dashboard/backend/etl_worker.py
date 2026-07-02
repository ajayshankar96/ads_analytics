"""
Generic ETL Worker — replaces 221 individual merge_row scripts.

Reads campaign config from Postgres, pulls advertiser + publisher data from
Google Sheets, merges on date, computes formulas, stores in rmn_campaign_metrics.
"""

import json
import logging
import re
import time
from datetime import datetime, timezone
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


def _safe_float(value) -> float:
    if value is None or value == '':
        return 0.0
    try:
        if isinstance(value, str):
            value = value.replace(',', '').strip()
        return float(value)
    except (ValueError, TypeError):
        return 0.0


def _parse_date_from_row(date_str: str, year: str, month: str) -> Optional[str]:
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
        # MM/DD/YYYY or M/D/YYYY
        if '/' in date_str:
            parts = date_str.split('/')
            if len(parts) == 3:
                m, d, y = parts
                if len(y) == 2:
                    y = '20' + y
                return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        # DD-Mon (e.g. "25-Jan", "1-Feb") — uses year from tab name
        if '-' in date_str:
            parts = date_str.split('-')
            if len(parts) == 2:
                day_part, mon_part = parts
                if day_part.isdigit() and mon_part.lower()[:3] in MONTH_MAP:
                    m_num = MONTH_MAP[mon_part.lower()[:3]]
                    return f"{year}-{m_num}-{day_part.zfill(2)}"
            if len(parts) == 3:
                d, m, y = parts
                # DD-MM-YYYY (all digits)
                if all(p.isdigit() for p in parts):
                    if len(y) == 2:
                        y = '20' + y
                    return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
                # DD-Mon-YYYY (e.g. 23-Jun-2026)
                if d.isdigit() and m.lower()[:3] in MONTH_MAP and y.isdigit():
                    if len(y) == 2:
                        y = '20' + y
                    m_num = MONTH_MAP[m.lower()[:3]]
                    return f"{y}-{m_num}-{d.zfill(2)}"
        # YYYYMMDD
        if len(date_str) == 8 and date_str.isdigit():
            return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
        # "D Month YYYY" or "D Month" (e.g. "1 June 2026", "15 March 2026")
        parts = date_str.split()
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].lower()[:3] in MONTH_MAP:
            day = parts[0].zfill(2)
            m_num = MONTH_MAP[parts[1].lower()[:3]]
            y = parts[2] if len(parts) >= 3 and parts[2].isdigit() else year
            if len(y) == 2:
                y = '20' + y
            return f"{y}-{m_num}-{day}"
        # Just a day number (legacy format — needs year/month from tab name)
        day = parts[0].zfill(2)
        if day.isdigit() and 1 <= int(day) <= 31:
            return f"{year}-{month}-{day}"
    except Exception:
        pass
    return None


def _get_year_month_from_tab(tab_name: str) -> tuple:
    year = "2026"
    if "'25" in tab_name or "2025" in tab_name:
        year = "2025"
    elif "'26" in tab_name or "2026" in tab_name:
        year = "2026"
    month = "01"
    for m_name, m_num in MONTH_MAP.items():
        if m_name in tab_name.lower():
            month = m_num
            break
    return year, month


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
        result = eval(formula, {"__builtins__": {}}, eval_context)
        return float(result) if result else 0.0
    except Exception as e:
        logger.warning(f"Formula eval error: {formula_str} — {e}")
        return 0.0


def _resolve_spend_formulas(buy_type: str, rate: float) -> tuple:
    """Derive (publisher_formula, advertiser_formula) from Agreement buy_type + campaign rate.
    buy_type comes from sales pipeline (Agreement), rate from campaign ops (Campaign.cpc_cpd)."""
    if not buy_type or not rate:
        return '', ''

    buy = buy_type.upper().replace(' ', '_')
    rate_str = str(rate)

    if buy in ('CPC', 'CPC_COMMIT'):
        pub_formula = f'Clicks * {rate_str}'
        adv_formula = f'Clicks * {rate_str}'
    elif buy in ('CPM', 'CPM_COMMIT'):
        pub_formula = f'Impressions * {rate_str} / 1000'
        adv_formula = f'Impressions * {rate_str} / 1000'
    elif buy in ('CPD', 'CPD_COMMIT'):
        pub_formula = rate_str
        adv_formula = rate_str
    elif buy in ('CPA', 'CPA_COMMIT'):
        pub_formula = f'Orders_pub * {rate_str}'
        adv_formula = f'Orders_pub * {rate_str}'
    elif buy in ('ROAS', 'ROAS_COMMIT'):
        pub_formula = f'Revenue / {rate_str}'
        adv_formula = f'Revenue / {rate_str}'
    else:
        pub_formula = 'Spends'
        adv_formula = ''

    return pub_formula, adv_formula


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
        "SELECT campaign_id, sheet_url, tab_name, header_row, data_start_row, mapping, format_type "
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
    }


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

    tab_filter = col_mapping.get("tab_name", "")

    converted_id = None
    try:
        try:
            meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        except Exception as e:
            if "office file" in str(e).lower() or "not supported" in str(e).lower():
                from sheets_client import _get_credentials
                from googleapiclient.discovery import build as _build
                creds = _get_credentials()
                drive = _build("drive", "v3", credentials=creds)
                copy = drive.files().copy(
                    fileId=sheet_id,
                    body={"name": "_tmp_etl_conversion", "mimeType": "application/vnd.google-apps.spreadsheet"}
                ).execute()
                converted_id = copy["id"]
                sheet_id = converted_id
                meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
                logger.info(f"  Converted Office file to Google Sheet for ETL: {converted_id}")
            else:
                raise
        tabs = [s['properties']['title'] for s in meta.get('sheets', [])]

        if tab_filter:
            target_tabs = [t for t in tabs if tab_filter.lower() in t.lower()]
            if not target_tabs:
                target_tabs = tabs
                logger.warning(f"Visual format: no matching tabs for '{tab_filter}', using all tabs")
        else:
            target_tabs = tabs

        for tab_name in target_tabs:
            year, month = _get_year_month_from_tab(tab_name)

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
            logger.info(f"  Visual format: tab={tab_name}, date_col={date_col}, data_start={data_start}, metrics={list(metrics_cfg.keys())}, rows={len(data_rows)}")

            for row in data_rows:
                if len(row) <= date_col or not row[date_col]:
                    continue

                # Segment filter
                if seg_col is not None and segment_filter:
                    seg_val = row[seg_col].strip() if len(row) > seg_col else ""
                    if not _matches_segment(seg_val, segment_filter):
                        continue

                date_str = _parse_date_from_row(row[date_col].strip(), year, month)
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
        if converted_id:
            try:
                from sheets_client import _get_credentials
                from googleapiclient.discovery import build as _build
                creds = _get_credentials()
                drive = _build("drive", "v3", credentials=creds)
                drive.files().delete(fileId=converted_id).execute()
                logger.info(f"  Deleted temporary converted sheet: {converted_id}")
            except Exception:
                pass

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

    try:
        meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        tabs = [s['properties']['title'] for s in meta.get('sheets', [])]

        # Determine tabs to process
        if col_mapping and col_mapping.get("tab_name"):
            target_tabs = [t for t in tabs if col_mapping["tab_name"] in t]
            if not target_tabs:
                target_tabs = [t for t in tabs if 'RZP' in t.upper()]
        else:
            target_tabs = [t for t in tabs if 'RZP' in t.upper()]

        if not target_tabs:
            # Last resort: use all tabs
            target_tabs = tabs[:5]
            logger.warning(f"No RZP tabs found in {sheet_url}, trying first tabs: {target_tabs}")

        cfg_header_row = (col_mapping.get("header_row", 3) if col_mapping else None)
        cfg_data_start = (col_mapping.get("data_start_row", cfg_header_row + 1) if col_mapping else None)
        field_map = col_mapping.get("mapping", {}) if col_mapping else {}

        for tab_name in target_tabs:
            year, month = _get_year_month_from_tab(tab_name)

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

            for row in data_rows:
                if len(row) <= date_idx:
                    continue

                # Segment filter
                if seg_idx is not None and segment_filter:
                    seg_val = row[seg_idx].strip() if len(row) > seg_idx else ""
                    if not _matches_segment(seg_val, segment_filter):
                        continue

                date_str = _parse_date_from_row(row[date_idx], year, month)
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
                            if metric_name in col_map and len(row) > col_map[metric_name]:
                                record[metric_name] = _safe_float(row[col_map[metric_name]])
                            else:
                                record[metric_name] = 0.0

                records.append(record)

    except Exception as e:
        logger.error(f"Error extracting from {sheet_url}: {e}")

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

    try:
        meta = service.spreadsheets().get(spreadsheetId=sheet_id).execute()
        tabs = [s['properties']['title'] for s in meta.get('sheets', [])]
        target_tabs = [t for t in tabs if 'RZP' in t.upper()] or tabs[:1]

        for tab_name in target_tabs:
            year, month = _get_year_month_from_tab(tab_name)

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
            for row in rows[data_start_row - 1:]:
                if not row or len(row) <= date_col or not row[date_col]:
                    continue
                date_str = _parse_date_from_row(row[date_col].strip(), year, month)
                if not date_str:
                    continue
                record = {'Date': date_str}
                for metric_key, col_idx in cols_to_read.items():
                    record[metric_key.capitalize()] = _safe_float(row[col_idx]) if len(row) > col_idx else 0
                records.append(record)

    except Exception as e:
        logger.error(f"Error extracting promo code sheet: {e}")

    return records


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

    # Derive spend formulas from Agreement buy_type + Campaign rate (from sales/ops pipeline)
    buy_type = ''
    rate = 0.0
    if campaign.agreement_id:
        agreement_row = await db.execute(
            text("SELECT buy_type FROM rmn_agreements WHERE id = :id"),
            {"id": campaign.agreement_id}
        )
        ag = agreement_row.fetchone()
        if ag:
            buy_type = ag[0] or ''
    if campaign.cpc_cpd:
        try:
            rate = float(str(campaign.cpc_cpd).replace(',', '').strip())
        except (ValueError, TypeError):
            pass

    pub_formula, adv_formula = _resolve_spend_formulas(buy_type, rate)
    billing_configs = await _load_billing_configs(db, campaign.id)
    has_pub_billing = any(cfg.get("side") == "publisher" for cfg in billing_configs)
    has_adv_billing = any(cfg.get("side") == "advertiser" for cfg in billing_configs)
    if has_pub_billing:
        logger.info("  Publisher billing config found; it will override sales-pipeline spend formula when active")
    if has_adv_billing:
        logger.info("  Advertiser billing config found; it will be used when direct advertiser spend is absent")
    if pub_formula:
        logger.info(f"  Publisher spends formula: {pub_formula} (buy_type={buy_type}, rate={rate})")
    if adv_formula:
        logger.info(f"  Advertiser spends formula: {adv_formula}")

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
        for r in records:
            adv_code = re.sub(r"[^A-Za-z]", "", r["advertiser"])[:3].upper() or "UNK"
            batch.append({
                "campaign_id": f"BF-{adv_code}-BHI",
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
