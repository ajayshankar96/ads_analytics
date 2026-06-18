"""
Revenue Attribution Worker

Matches coupon codes from a redemption file against per-publisher code lists
stored in Google Drive. Each sub-folder in the Drive folder = one publisher,
each CSV file inside = one offer's codes.

Structure:
  Drive Folder (advertiser/campaign level)
  ├── Publisher1/
  │   ├── OfferA.csv  (one code per line)
  │   └── OfferB.csv
  ├── Publisher2/
  │   └── OfferC.csv
  └── ...
"""

import base64
import csv
import io
import json
import logging
import re
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _extract_folder_id(url: str) -> Optional[str]:
    match = re.search(r'/folders/([a-zA-Z0-9_-]+)', url)
    return match.group(1) if match else None


def _parse_revenue_file(file_bytes: bytes, filename: str) -> List[Dict[str, Any]]:
    """Parse revenue/redemption file (CSV or Excel). Returns list of transactions."""
    transactions = []

    if filename.endswith('.csv'):
        text = file_bytes.decode('utf-8', errors='ignore')
        reader = csv.reader(io.StringIO(text))
        headers = None
        for row in reader:
            if not headers:
                headers = [h.strip().lower() for h in row]
                continue
            if len(row) < 3:
                continue
            # Find columns by name
            code_idx = next((i for i, h in enumerate(headers) if 'code' in h and 'coupon' not in h), None)
            if code_idx is None:
                code_idx = next((i for i, h in enumerate(headers) if 'coupon' in h or 'code' in h), 1)
            value_idx = next((i for i, h in enumerate(headers) if 'value' in h or 'amount' in h or 'revenue' in h), None)
            if value_idx is None:
                value_idx = len(headers) - 1
            date_idx = next((i for i, h in enumerate(headers) if 'date' in h), None)
            order_idx = next((i for i, h in enumerate(headers) if 'order' in h), None)

            code = row[code_idx].strip() if code_idx < len(row) else ""
            if not code:
                continue
            try:
                value = float(row[value_idx].replace(',', '').strip()) if value_idx < len(row) else 0
            except (ValueError, IndexError):
                value = 0
            date = row[date_idx].strip() if date_idx and date_idx < len(row) else ""
            order_id = row[order_idx].strip() if order_idx and order_idx < len(row) else ""

            transactions.append({"code": code, "value": value, "date": date, "order_id": order_id})

    elif filename.endswith('.xlsx') or filename.endswith('.xls'):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        ws = wb.active
        headers = None
        for row in ws.iter_rows(values_only=True):
            if not headers:
                headers = [str(h or '').strip().lower() for h in row]
                continue
            row_list = list(row)
            if len(row_list) < 3:
                continue

            code_idx = next((i for i, h in enumerate(headers) if 'code' in h and 'coupon' not in h), None)
            if code_idx is None:
                code_idx = next((i for i, h in enumerate(headers) if 'coupon' in h or 'code' in h), 1)
            value_idx = next((i for i, h in enumerate(headers) if 'value' in h or 'amount' in h or 'revenue' in h), None)
            if value_idx is None:
                value_idx = len(headers) - 1
            date_idx = next((i for i, h in enumerate(headers) if 'date' in h), None)
            order_idx = next((i for i, h in enumerate(headers) if 'order' in h), None)

            code = str(row_list[code_idx] or '').strip() if code_idx < len(row_list) else ""
            if not code:
                continue
            try:
                val = row_list[value_idx] if value_idx < len(row_list) else 0
                value = float(str(val).replace(',', '')) if val else 0
            except (ValueError, TypeError):
                value = 0
            date = str(row_list[date_idx] or '').strip() if date_idx and date_idx < len(row_list) else ""
            order_id = str(row_list[order_idx] or '').strip() if order_idx and order_idx < len(row_list) else ""

            transactions.append({"code": code, "value": value, "date": date, "order_id": order_id})

    logger.info(f"Parsed {len(transactions)} transactions from {filename}")
    return transactions


def _load_publisher_codes_from_drive(folder_id: str) -> Dict[str, Dict[str, set]]:
    """
    Load coupon codes from Drive folder structure.
    Returns: { publisher_name: { offer_filename: set(codes) } }
    """
    from sheets_client import _get_drive
    from googleapiclient.http import MediaIoBaseDownload

    drive = _get_drive()
    publisher_codes = {}

    # List sub-folders (each = one publisher)
    pub_folders = drive.files().list(
        q=f"'{folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false",
        fields="files(id,name)"
    ).execute().get('files', [])

    logger.info(f"Found {len(pub_folders)} publisher folders")

    for pub_folder in pub_folders:
        pub_name = pub_folder['name']
        publisher_codes[pub_name] = {}

        # List CSV files in this publisher folder
        code_files = drive.files().list(
            q=f"'{pub_folder['id']}' in parents and trashed=false",
            fields="files(id,name,mimeType)"
        ).execute().get('files', [])

        for code_file in code_files:
            if code_file['mimeType'] != 'text/csv' and not code_file['name'].endswith('.csv'):
                continue

            try:
                # Download the CSV
                request = drive.files().get_media(fileId=code_file['id'])
                content = io.BytesIO()
                downloader = MediaIoBaseDownload(content, request)
                done = False
                while not done:
                    _, done = downloader.next_chunk()

                content.seek(0)
                raw = content.read().decode('utf-8', errors='ignore')
                codes = set(line.strip() for line in raw.splitlines() if line.strip())

                offer_name = code_file['name'].replace('.csv', '')
                publisher_codes[pub_name][offer_name] = codes
                logger.info(f"  {pub_name}/{code_file['name']}: {len(codes)} codes")
            except Exception as e:
                logger.warning(f"  Failed to download {pub_name}/{code_file['name']}: {e}")

    return publisher_codes


def run_attribution(file_bytes: bytes, filename: str, drive_folder_url: str) -> Dict[str, Any]:
    """
    Run revenue attribution.

    Returns:
    {
        "summary": [
            {"publisher": "Flipkart", "offer": "FK L1 - 500", "orders": 172, "revenue": 442570, "codes_matched": ["BTXRZD500"]},
            ...
        ],
        "totals": {"orders": 500, "revenue": 1200000, "attributed_orders": 480, "attributed_revenue": 1150000},
        "unattributed": {"orders": 20, "revenue": 50000, "codes": ["UNKNOWN1", ...]},
        "transactions": [...],  # full detail (limited to first 500)
    }
    """
    folder_id = _extract_folder_id(drive_folder_url)
    if not folder_id:
        return {"error": "Invalid Drive folder URL"}

    # Parse revenue file
    transactions = _parse_revenue_file(file_bytes, filename)
    if not transactions:
        return {"error": "No transactions found in the uploaded file"}

    # Load publisher codes from Drive
    publisher_codes = _load_publisher_codes_from_drive(folder_id)
    if not publisher_codes:
        return {"error": "No publisher code files found in the Drive folder"}

    # Build reverse lookup: code → (publisher, offer)
    code_to_pub_offer = {}
    for pub_name, offers in publisher_codes.items():
        for offer_name, codes in offers.items():
            for code in codes:
                code_to_pub_offer[code.upper()] = (pub_name, offer_name)

    # Attribution
    summary = defaultdict(lambda: {"orders": 0, "revenue": 0.0, "codes_matched": set()})
    unattributed_codes = set()
    unattributed_orders = 0
    unattributed_revenue = 0.0
    attributed_transactions = []

    for txn in transactions:
        code = txn["code"].upper()
        if code in code_to_pub_offer:
            pub, offer = code_to_pub_offer[code]
            key = f"{pub}||{offer}"
            summary[key]["orders"] += 1
            summary[key]["revenue"] += txn["value"]
            summary[key]["codes_matched"].add(txn["code"])
            attributed_transactions.append({**txn, "publisher": pub, "offer": offer, "status": "attributed"})
        else:
            unattributed_orders += 1
            unattributed_revenue += txn["value"]
            unattributed_codes.add(txn["code"])
            attributed_transactions.append({**txn, "publisher": "", "offer": "", "status": "unattributed"})

    # Build summary list
    summary_list = []
    for key, data in sorted(summary.items(), key=lambda x: -x[1]["revenue"]):
        pub, offer = key.split("||")
        summary_list.append({
            "publisher": pub,
            "offer": offer,
            "orders": data["orders"],
            "revenue": round(data["revenue"], 2),
            "codes_matched": list(data["codes_matched"])[:20],
        })

    total_orders = len(transactions)
    total_revenue = sum(t["value"] for t in transactions)
    attributed_orders = total_orders - unattributed_orders

    return {
        "summary": summary_list,
        "totals": {
            "orders": total_orders,
            "revenue": round(total_revenue, 2),
            "attributed_orders": attributed_orders,
            "attributed_revenue": round(total_revenue - unattributed_revenue, 2),
            "attribution_rate": round(attributed_orders / total_orders * 100, 1) if total_orders > 0 else 0,
        },
        "unattributed": {
            "orders": unattributed_orders,
            "revenue": round(unattributed_revenue, 2),
            "codes": list(unattributed_codes)[:50],
        },
        "transactions": attributed_transactions[:500],
    }
