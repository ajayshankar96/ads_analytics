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
    try:
        # MM/DD/YYYY or M/D/YYYY
        if '/' in date_str:
            parts = date_str.split('/')
            if len(parts) == 3:
                m, d, y = parts
                if len(y) == 2:
                    y = '20' + y
                return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        # DD-MM-YYYY
        if '-' in date_str and len(date_str) >= 8:
            parts = date_str.split('-')
            if len(parts) == 3 and all(p.isdigit() for p in parts):
                d, m, y = parts
                if len(y) == 2:
                    y = '20' + y
                return f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        # YYYYMMDD
        if len(date_str) == 8 and date_str.isdigit():
            return f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
        # Just a day number (legacy format — needs year/month from tab name)
        parts = date_str.split()
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


def _evaluate_formula(formula_str: str, row_data: Dict[str, float]) -> float:
    if not formula_str or not formula_str.strip():
        return 0.0
    try:
        eval_context = {}
        for key, value in row_data.items():
            safe_key = key.replace(' ', '_').replace('-', '_')
            try:
                eval_context[safe_key] = float(value) if value else 0.0
            except (ValueError, TypeError):
                continue
        formula = formula_str
        for key in row_data.keys():
            safe_key = key.replace(' ', '_').replace('-', '_')
            formula = formula.replace(key, safe_key)
        result = eval(formula, {"__builtins__": {}}, eval_context)
        return float(result) if result else 0.0
    except Exception as e:
        logger.warning(f"Formula eval error: {formula_str} — {e}")
        return 0.0


async def _load_column_mapping(db: AsyncSession, name: str, map_type: str) -> Optional[Dict]:
    """Load a saved column mapping from DB."""
    result = await db.execute(text(
        "SELECT tab_name, header_row, data_start_row, mapping, format_type "
        "FROM rmn_column_mappings WHERE name = :name AND type = :type ORDER BY updated_at DESC LIMIT 1"
    ), {"name": name, "type": map_type})
    row = result.fetchone()
    if not row:
        return None
    return {
        "tab_name": row[0],
        "header_row": row[1],
        "data_start_row": row[2],
        "mapping": json.loads(row[3]) if row[3] else {},
        "format_type": row[4],
    }


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

        cfg_header_row = (col_mapping.get("header_row", 3) if col_mapping else 3)
        cfg_data_start = (col_mapping.get("data_start_row", cfg_header_row + 1) if col_mapping else 4)
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
            if len(rows) < cfg_data_start:
                continue

            header_row = rows[cfg_header_row - 1]
            data_rows = rows[cfg_data_start - 1:]

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
                        record['Impressions'] = _safe_float(row[resolved['impressions']]) if 'impressions' in resolved and len(row) > resolved['impressions'] else 0
                        record['Distribution'] = _safe_float(row[resolved['distribution']]) if 'distribution' in resolved and len(row) > resolved['distribution'] else 0
                        record['Clicks'] = _safe_float(row[resolved['clicks']]) if 'clicks' in resolved and len(row) > resolved['clicks'] else 0
                        record['Orders_pub'] = _safe_float(row[resolved['orders']]) if 'orders' in resolved and len(row) > resolved['orders'] else 0
                        record['Scratches'] = _safe_float(row[resolved['scratches']]) if 'scratches' in resolved and len(row) > resolved['scratches'] else 0
                        record['Coins_Burned'] = _safe_float(row[resolved.get('coins_burned', -1)]) if 'coins_burned' in resolved and len(row) > resolved.get('coins_burned', 999) else 0
                        record['Redirections'] = _safe_float(row[resolved['redirections']]) if 'redirections' in resolved and len(row) > resolved['redirections'] else 0
                        record['Spends'] = _safe_float(row[resolved['spends']]) if 'spends' in resolved and len(row) > resolved['spends'] else 0
                    else:
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

    metrics_lib = metrics_config.get('metrics_library', {})
    direct_metrics = []
    computed_metrics = []
    for _, mdef in sorted(metrics_lib.items()):
        if mdef.get('calculation'):
            computed_metrics.append(mdef)
        else:
            direct_metrics.append(mdef['display_name'])

    service = _get_service()

    # Load configurable column mappings from DB (if saved via Column Mapper UI)
    pub_col_mapping = await _load_column_mapping(db, campaign.publisher_name or "", "publisher")
    adv_col_mapping = await _load_column_mapping(db, campaign.advertiser_name or "", "advertiser")
    if pub_col_mapping:
        logger.info(f"  Using saved column mapping for publisher '{campaign.publisher_name}'")
    if adv_col_mapping:
        logger.info(f"  Using saved column mapping for advertiser '{campaign.advertiser_name}'")

    # Extract advertiser data
    logger.info(f"Syncing {campaign.id}: pulling advertiser data...")
    adv_records = _extract_from_sheet(
        service, campaign.advertiser_data_url,
        segment_filter=campaign.segment_adv,
        offer_filter=campaign.offer_title or "",
        metric_names=direct_metrics,
        is_publisher=False,
        col_mapping=adv_col_mapping,
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

    # Merge on Date (full outer join)
    adv_by_date = {r['Date']: r for r in adv_records}
    pub_by_date = {r['Date']: r for r in pub_records}
    all_dates = sorted(set(list(adv_by_date.keys()) + list(pub_by_date.keys())))

    # Parse formula configs
    budget_metrics = {}
    try:
        cd = json.loads(campaign.details_tc or '{}') if campaign.details_tc and campaign.details_tc.startswith('{') else {}
        budget_metrics = cd.get('campaign_details', {}).get('budget_and_metrics', {})
    except Exception:
        pass
    pub_formula = budget_metrics.get('publisher_spends_calc', 'Spends')
    adv_formula = budget_metrics.get('advertiser_spends_calc', 'Spends')

    rows_synced = 0
    now = datetime.now(timezone.utc)

    for date_str in all_dates:
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
        except Exception:
            continue

        adv_row = adv_by_date.get(date_str, {})
        pub_row = pub_by_date.get(date_str, {})

        # Merge data for formula evaluation
        merged = {**pub_row, **adv_row}
        merged.pop('Date', None)

        # Compute publisher/advertiser spends
        pub_spends = _evaluate_formula(pub_formula, merged)
        adv_spends = _evaluate_formula(adv_formula, merged)

        # Compute derived metrics
        adv_metrics_dict = {}
        for metric_name in direct_metrics:
            adv_metrics_dict[metric_name] = adv_row.get(metric_name, 0)
        for cdef in computed_metrics:
            val = _evaluate_formula(cdef['calculation'], merged)
            adv_metrics_dict[cdef['display_name']] = round(val, 4)

        # Upsert to DB
        await db.execute(text("""
            INSERT INTO rmn_campaign_metrics
                (campaign_id, date, advertiser, publisher, segment,
                 impressions, distribution, clicks, orders_pub, scratches,
                 coins_burned, redirections, spends, publisher_spends,
                 advertiser_spends, advertiser_metrics, synced_at)
            VALUES
                (:campaign_id, :date, :advertiser, :publisher, :segment,
                 :impressions, :distribution, :clicks, :orders_pub, :scratches,
                 :coins_burned, :redirections, :spends, :publisher_spends,
                 :advertiser_spends, :advertiser_metrics, :synced_at)
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
