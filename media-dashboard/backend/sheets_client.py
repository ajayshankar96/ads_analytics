"""
Google Sheets API v4 client.
Reads/writes to the Master_Report and KPI spreadsheets.

Auth priority:
  1. OAuth2 user credentials (OAUTH_CLIENT_SECRET_JSON) — best for sheets shared
     with your personal/work Google account (no service account sharing needed)
  2. Service account JSON file (GOOGLE_SERVICE_ACCOUNT_JSON)
"""

import os
import json
import logging
import pickle
from typing import List, Any

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

logger = logging.getLogger(__name__)

# Spreadsheet IDs (from original Code.gs CONFIG)
MASTER_SPREADSHEET_ID = os.environ.get(
    "MASTER_SPREADSHEET_ID",
    "1yvcrWEvWauUOOGJrN5votRlOP-kCaSrOKeh-YvjKjfI"
)
KPI_SPREADSHEET_ID = os.environ.get(
    "KPI_SPREADSHEET_ID",
    "1VDr2ewZw2Xl43PuYBoKt8PgepItHZs-icD49YnILBss"
)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
TOKEN_CACHE = "token.pickle"


def _get_credentials():
    """
    Build credentials. Tries in this order:
      1. OAuth2 user login (OAUTH_CLIENT_SECRET_JSON) — opens browser on first run,
         then caches token.pickle for future runs.
      2. Service account JSON (GOOGLE_SERVICE_ACCOUNT_JSON).
    """
    # ── Option 1a: OAuth2 token JSON (for k8s / env var deployment) ──────────
    # Set OAUTH_TOKEN_JSON to the path of oauth_token.json, or
    # set OAUTH_TOKEN_JSON_CONTENT to the raw JSON string
    token_json_path = os.environ.get("OAUTH_TOKEN_JSON", "oauth_token.json")
    token_json_content = os.environ.get("OAUTH_TOKEN_JSON_CONTENT")

    if token_json_content or os.path.exists(token_json_path):
        from google.oauth2.credentials import Credentials
        from google.auth.transport.requests import Request

        if token_json_content:
            token_data = json.loads(token_json_content)
        else:
            with open(token_json_path) as f:
                token_data = json.load(f)

        creds = Credentials(
            token=token_data.get("token"),
            refresh_token=token_data.get("refresh_token"),
            token_uri=token_data.get("token_uri", "https://oauth2.googleapis.com/token"),
            client_id=token_data.get("client_id"),
            client_secret=token_data.get("client_secret"),
            scopes=token_data.get("scopes", SCOPES),
        )

        # Auto-refresh if expired
        if not creds.valid and creds.refresh_token:
            logger.info("Refreshing OAuth2 token...")
            creds.refresh(Request())

        logger.info("Using OAuth2 token credentials")
        return creds

    # ── Option 1b: OAuth2 browser login (local dev fallback) ─────────────────
    oauth_secret = os.environ.get("OAUTH_CLIENT_SECRET_JSON", "client_secret.json")
    if os.path.exists(oauth_secret):
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request

        creds = None
        if os.path.exists(TOKEN_CACHE):
            with open(TOKEN_CACHE, "rb") as f:
                creds = pickle.load(f)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                logger.info("Refreshing OAuth2 token...")
                creds.refresh(Request())
            else:
                logger.info("Starting OAuth2 browser login flow...")
                flow = InstalledAppFlow.from_client_secrets_file(oauth_secret, SCOPES)
                creds = flow.run_local_server(port=0)
            with open(TOKEN_CACHE, "wb") as f:
                pickle.dump(creds, f)
            logger.info("OAuth2 token saved to token.pickle")

        logger.info("Using OAuth2 user credentials (browser flow)")
        return creds

    # ── Option 2: Service account JSON ───────────────────────────────────────
    from google.oauth2 import service_account as _sa

    creds_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON", "service_account.json")
    if os.path.exists(creds_path):
        logger.info(f"Loading service account credentials from: {creds_path}")
        return _sa.Credentials.from_service_account_file(creds_path, scopes=SCOPES)

    creds_content = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON_CONTENT")
    if creds_content:
        info = json.loads(creds_content)
        return _sa.Credentials.from_service_account_info(info, scopes=SCOPES)

    raise FileNotFoundError(
        "No Google credentials found.\n"
        "Either:\n"
        "  A) Put your OAuth2 client secret as 'client_secret.json' in the backend folder, OR\n"
        "  B) Set GOOGLE_SERVICE_ACCOUNT_JSON to your service account key file path."
    )


def _get_service():
    creds = _get_credentials()
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def read_range(spreadsheet_id: str, range_name: str) -> List[List[Any]]:
    """Return all values in a named range."""
    try:
        service = _get_service()
        result = (
            service.spreadsheets()
            .values()
            .get(spreadsheetId=spreadsheet_id, range=range_name)
            .execute()
        )
        return result.get("values", [])
    except HttpError as e:
        logger.error(f"Sheets API error reading {spreadsheet_id}/{range_name}: {e}")
        raise


def read_master_report() -> List[List[Any]]:
    """Read the entire Master_Report sheet (header + all rows)."""
    logger.info("Reading Master_Report sheet from Google Sheets...")
    data = read_range(MASTER_SPREADSHEET_ID, "Master_Report")
    logger.info(f"Loaded {len(data) - 1} rows from Master_Report")
    return data


def read_kpi_sheet(sheet_name: str) -> List[List[Any]]:
    """Read a sheet from the KPI spreadsheet."""
    return read_range(KPI_SPREADSHEET_ID, sheet_name)


def append_rows(spreadsheet_id: str, range_name: str, rows: List[List[Any]]) -> dict:
    """Append rows to a sheet."""
    service = _get_service()
    body = {"values": rows}
    result = (
        service.spreadsheets()
        .values()
        .append(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",
            body=body,
        )
        .execute()
    )
    return result


def update_cell(spreadsheet_id: str, cell: str, value: Any) -> dict:
    """Update a single cell."""
    service = _get_service()
    body = {"values": [[value]]}
    result = (
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=spreadsheet_id,
            range=cell,
            valueInputOption="USER_ENTERED",
            body=body,
        )
        .execute()
    )
    return result


def update_range(spreadsheet_id: str, range_name: str, values: List[List[Any]]) -> dict:
    """Update a range in a sheet."""
    service = _get_service()
    body = {"values": values}
    result = (
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=spreadsheet_id,
            range=range_name,
            valueInputOption="USER_ENTERED",
            body=body,
        )
        .execute()
    )
    return result


def get_sheet_names(spreadsheet_id: str) -> List[str]:
    """Return list of sheet names in a spreadsheet."""
    service = _get_service()
    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    return [s["properties"]["title"] for s in meta.get("sheets", [])]
