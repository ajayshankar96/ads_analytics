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

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/gmail.send",
]
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


def _get_drive():
    creds = _get_credentials()
    return build("drive", "v3", credentials=creds, cache_discovery=False)


# ── Drive folder–based report registry ─────────────────────────────────────────
REPORTS_FOLDER_NAME = "Media Dashboard - Reports"
_reports_folder_id = None


def ensure_reports_folder() -> str:
    """Find-or-create the Drive folder that holds all report spreadsheets.

    Cached in-process. Survives pod restarts because we look it up by name each
    cold start (the service account owns it, so drive.file scope can see it).
    """
    global _reports_folder_id
    if _reports_folder_id:
        return _reports_folder_id

    drive = _get_drive()
    q = (
        "mimeType='application/vnd.google-apps.folder' "
        f"and name='{REPORTS_FOLDER_NAME}' and trashed=false"
    )
    res = drive.files().list(q=q, fields="files(id,name)", spaces="drive").execute()
    files = res.get("files", [])
    if files:
        _reports_folder_id = files[0]["id"]
        logger.info(f"Found reports folder: {_reports_folder_id}")
    else:
        meta = {"name": REPORTS_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"}
        folder = drive.files().create(body=meta, fields="id").execute()
        _reports_folder_id = folder["id"]
        logger.info(f"Created reports folder: {_reports_folder_id}")
    return _reports_folder_id


def move_to_folder(file_id: str, folder_id: str) -> None:
    """Move a file into the given folder (removing it from any current parents)."""
    drive = _get_drive()
    meta = drive.files().get(fileId=file_id, fields="parents").execute()
    prev_parents = ",".join(meta.get("parents", []))
    drive.files().update(
        fileId=file_id,
        addParents=folder_id,
        removeParents=prev_parents,
        fields="id,parents",
    ).execute()


ASSETS_FOLDER_NAME = "Media Dashboard - Campaign Assets"
_assets_folder_id = None


def ensure_assets_folder() -> str:
    """Find-or-create the Drive folder for campaign asset uploads."""
    global _assets_folder_id
    if _assets_folder_id:
        return _assets_folder_id

    drive = _get_drive()
    q = (
        "mimeType='application/vnd.google-apps.folder' "
        f"and name='{ASSETS_FOLDER_NAME}' and trashed=false"
    )
    res = drive.files().list(q=q, fields="files(id,name)", spaces="drive").execute()
    files = res.get("files", [])
    if files:
        _assets_folder_id = files[0]["id"]
    else:
        meta = {"name": ASSETS_FOLDER_NAME, "mimeType": "application/vnd.google-apps.folder"}
        folder = drive.files().create(body=meta, fields="id").execute()
        _assets_folder_id = folder["id"]
    return _assets_folder_id


def upload_campaign_asset(file_bytes: bytes, filename: str, mime_type: str) -> dict:
    """Upload an image to the assets Drive folder. Returns {id, url, name}."""
    from googleapiclient.http import MediaInMemoryUpload

    drive = _get_drive()
    folder_id = ensure_assets_folder()

    media = MediaInMemoryUpload(file_bytes, mimetype=mime_type)
    file_meta = {"name": filename, "parents": [folder_id]}
    created = drive.files().create(
        body=file_meta, media_body=media, fields="id,webViewLink,webContentLink"
    ).execute()

    # Try to make publicly viewable; if org policy blocks it, share with domain instead
    try:
        drive.permissions().create(
            fileId=created["id"],
            body={"type": "anyone", "role": "reader"},
        ).execute()
    except Exception:
        try:
            drive.permissions().create(
                fileId=created["id"],
                body={"type": "domain", "domain": "razorpay.com", "role": "reader"},
            ).execute()
        except Exception:
            pass  # file is still accessible by service account and shared folder viewers

    # Use thumbnail link that works within the org
    view_url = f"https://lh3.googleusercontent.com/d/{created['id']}"
    return {"id": created["id"], "url": view_url, "name": filename, "web_view_link": created.get("webViewLink", "")}


def set_app_properties(file_id: str, props: dict) -> None:
    """Set/merge appProperties (app-private metadata) on a Drive file."""
    drive = _get_drive()
    # Drive requires all values to be strings
    str_props = {k: ("" if v is None else str(v)) for k, v in props.items()}
    drive.files().update(fileId=file_id, body={"appProperties": str_props}).execute()


def get_app_properties(file_id: str) -> dict:
    """Return appProperties + key native fields for a single Drive file."""
    drive = _get_drive()
    f = drive.files().get(
        fileId=file_id,
        fields="id,name,createdTime,modifiedTime,webViewLink,appProperties",
    ).execute()
    return f


def list_folder_files(folder_id: str) -> List[dict]:
    """List all non-trashed files in a folder with their metadata + appProperties."""
    drive = _get_drive()
    files = []
    page_token = None
    while True:
        res = drive.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields="nextPageToken, files(id,name,createdTime,modifiedTime,webViewLink,appProperties)",
            spaces="drive",
            pageSize=1000,
            pageToken=page_token,
        ).execute()
        files.extend(res.get("files", []))
        page_token = res.get("nextPageToken")
        if not page_token:
            break
    return files


def trash_file(file_id: str) -> None:
    """Move a Drive file to trash."""
    drive = _get_drive()
    drive.files().update(fileId=file_id, body={"trashed": True}).execute()


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


def create_spreadsheet(title: str) -> dict:
    """Create a new Google Spreadsheet and return {spreadsheetId, spreadsheetUrl}."""
    service = _get_service()
    body = {
        "properties": {"title": title},
        "sheets": [{"properties": {"title": "Sheet1"}}],
    }
    result = service.spreadsheets().create(body=body, fields="spreadsheetId").execute()
    ss_id = result["spreadsheetId"]
    ss_url = f"https://docs.google.com/spreadsheets/d/{ss_id}/edit"
    logger.info(f"Created spreadsheet: {title} ({ss_id})")
    return {"spreadsheetId": ss_id, "spreadsheetUrl": ss_url}


def ensure_sheet_tab(spreadsheet_id: str, tab_title: str):
    """Add a sheet tab if it doesn't already exist."""
    service = _get_service()
    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing = [s["properties"]["title"] for s in meta.get("sheets", [])]
    if tab_title in existing:
        return  # Already exists

    requests = [{"addSheet": {"properties": {"title": tab_title}}}]
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body={"requests": requests}
    ).execute()
    logger.info(f"Created tab '{tab_title}' in {spreadsheet_id}")


def write_sheet_tab(spreadsheet_id: str, tab_title: str, data: List[List[Any]]) -> dict:
    """Clear a tab and write new data to it."""
    service = _get_service()
    range_name = f"'{tab_title}'"

    # Clear existing content
    service.spreadsheets().values().clear(
        spreadsheetId=spreadsheet_id, range=range_name, body={}
    ).execute()

    if not data:
        return {}

    # Convert all values to strings/numbers safe for Sheets API
    clean_data = []
    for row in data:
        clean_row = []
        for cell in row:
            if cell is None or cell == "":
                clean_row.append("")
            elif isinstance(cell, float) and cell == int(cell):
                clean_row.append(int(cell))
            elif isinstance(cell, (int, float)):
                clean_row.append(cell)
            else:
                clean_row.append(str(cell))
        clean_data.append(clean_row)

    body = {"values": clean_data}
    result = (
        service.spreadsheets()
        .values()
        .update(
            spreadsheetId=spreadsheet_id,
            range=f"'{tab_title}'!A1",
            valueInputOption="USER_ENTERED",
            body=body,
        )
        .execute()
    )
    return result


def share_spreadsheet(spreadsheet_id: str, emails: List[str]) -> None:
    """Share a spreadsheet with editor access to a list of email addresses."""
    try:
        from googleapiclient.discovery import build as _build
        creds = _get_credentials()
        drive_service = _build("drive", "v3", credentials=creds, cache_discovery=False)

        for email in emails:
            try:
                drive_service.permissions().create(
                    fileId=spreadsheet_id,
                    body={"type": "user", "role": "writer", "emailAddress": email},
                    sendNotificationEmail=False,
                ).execute()
            except Exception as e:
                logger.warning(f"Could not share {spreadsheet_id} with {email}: {e}")
        logger.info(f"Shared {spreadsheet_id} with {len(emails)} users")
    except Exception as e:
        logger.warning(f"Drive sharing failed (non-fatal): {e}")


def send_email(to: List[str], subject: str, body: str, subtype: str = "html", cc: List[str] = None) -> dict:
    """Send an email via the Gmail API as the authenticated account.

    subtype: "plain" or "html". Requires the gmail.send scope on the OAuth token.
    """
    import base64
    from email.mime.text import MIMEText

    creds = _get_credentials()
    gmail = build("gmail", "v1", credentials=creds, cache_discovery=False)

    msg = MIMEText(body, subtype)
    msg["to"] = ", ".join(to)
    if cc:
        msg["cc"] = ", ".join(cc)
    msg["subject"] = subject

    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    result = gmail.users().messages().send(userId="me", body={"raw": raw}).execute()
    logger.info(f"Sent email '{subject}' to {to} (id={result.get('id')})")
    return result
