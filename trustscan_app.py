from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import csv
import io
import json
import re
import hashlib
import urllib.request
import urllib.error
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("trustscan")

app = FastAPI(title="TrustScan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Data Config ───────────────────────────────────────────────────────────────
# Primary: local CSV bundled in the repo (cloned to /tmp/repo at startup)
_REPO_DATA_CSV = Path("/tmp/repo/data/trustscan_sample.csv")
# Fallback: S3 (requires pod IAM access)
S3_BUCKET = os.getenv("S3_BUCKET", "rzp-1415-prod-general-purpose-analytics")
S3_PREFIX = os.getenv("S3_PREFIX", "ajayshankar/trustscan_sample/")

# Column order matches the CTAS SELECT (Hive CSV has no header row)
CSV_COLUMNS = [
    "contact",
    "bands_dpd30_band", "bands_dpd90_band", "bands_cd_band",
    "bands_income_bucket", "thick_thin_data", "model_version",
    "dpd_30_prob_band", "dpd_90_prob_band", "cd_dpd_30_prob_band",
    "exact_dpd30_band", "exact_dpd90_band",
    "dpd30_credit_score", "dpd90_credit_score",
    "dpd30_default_probability", "dpd90_default_probability", "dpd_date",
    "exact_cd_band", "predicted_income", "exact_income_bucket",
    "cd_credit_score", "cd_default_probability", "cohort", "cd_date",
    "ts1_band",
]

# ── In-memory store ───────────────────────────────────────────────────────────
# Keyed by contact (phone number) → dict of all columns
_DATA: dict = {}
# DE variables store — keyed by phone → dict of DE variable band codes
_DE_DATA: dict = {}

_REPO_DE_CSV = Path("/tmp/repo/data/de_variables.csv")

DE_COLUMNS = [
    "phone", "avg_amount", "yearly_transaction_volume", "max_vintage",
    "weighted_success_rate", "perc_non_discretionary_spends",
    "unique_city_transacted", "yoy_growth_percentage", "ott_trxns_last_1_year",
    "perc_merchants_emi_linked", "upi_payment_amount", "vintage_utilities",
    "weighted_error_ratio", "unique_state_transacted",
    "loan_stacking_amount_l3m", "count_issuer_cc",
]

def load_de_data():
    """Load DE variables CSV (has header row)."""
    global _DE_DATA
    if _REPO_DE_CSV.exists():
        try:
            with open(_REPO_DE_CSV, newline="") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    phone = row.get("phone", "").strip()
                    if phone:
                        _DE_DATA[phone] = {k: v.strip() for k, v in row.items()}
            logger.info(f"Loaded DE variables for {len(_DE_DATA)} contacts")
        except Exception as e:
            logger.warning(f"Failed to load DE variables CSV: {e}")


def _load_csv_file(path_or_buffer, source_label: str) -> dict:
    """Parse a CSV (no header) into a dict keyed by contact."""
    records = {}
    reader = csv.reader(path_or_buffer)
    for row in reader:
        if len(row) < len(CSV_COLUMNS):
            continue
        record = dict(zip(CSV_COLUMNS, [v.strip() for v in row]))
        contact = record.get("contact", "").strip()
        if contact:
            records[contact] = record
    logger.info(f"Loaded {len(records)} contacts from {source_label}")
    return records


def load_data():
    """Load data on startup: try local repo CSV first, fall back to S3."""
    global _DATA

    # ── Primary: local file bundled in the cloned repo ────────────────────────
    if _REPO_DATA_CSV.exists():
        try:
            with open(_REPO_DATA_CSV, newline="") as f:
                _DATA = _load_csv_file(f, str(_REPO_DATA_CSV))
            return
        except Exception as e:
            logger.warning(f"Failed to load local CSV ({_REPO_DATA_CSV}): {e}")

    # ── Fallback: S3 ──────────────────────────────────────────────────────────
    logger.info(f"Local CSV not found, trying S3: s3://{S3_BUCKET}/{S3_PREFIX}")
    try:
        import boto3
        s3 = boto3.client("s3", region_name="ap-south-1")
        response = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=S3_PREFIX)
        files = [
            obj["Key"] for obj in response.get("Contents", [])
            if not obj["Key"].endswith("/") and obj["Size"] > 0
            and not obj["Key"].rsplit("/", 1)[-1].startswith(("_", "."))
        ]
        if not files:
            logger.warning(f"No data files found at s3://{S3_BUCKET}/{S3_PREFIX}")
            return
        records = {}
        for key in files:
            logger.info(f"Loading s3://{S3_BUCKET}/{key}")
            raw = s3.get_object(Bucket=S3_BUCKET, Key=key)["Body"].read().decode("utf-8")
            records.update(_load_csv_file(io.StringIO(raw), key))
        _DATA = records
    except Exception as e:
        logger.error(f"Failed to load data from S3: {e}")


# Load on startup
load_data()
load_de_data()


# ── Trust Scan endpoint ───────────────────────────────────────────────────────

@app.get("/api/trust-scan/{phone}")
def trust_scan(phone: str):
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")

    record = _DATA.get(phone)
    if not record:
        raise HTTPException(status_code=404, detail="No data found for this phone number")

    return {
        "phone": phone,
        # Exact values (Full Scan)
        "dpd30_band":          record["exact_dpd30_band"],
        "dpd90_band":          record["exact_dpd90_band"],
        "dpd30_credit_score":  record["dpd30_credit_score"],
        "dpd90_credit_score":  record["dpd90_credit_score"],
        "dpd30_probability":   record["dpd30_default_probability"],
        "dpd90_probability":   record["dpd90_default_probability"],
        "dpd_date":            record["dpd_date"],
        "cd_band":             record["exact_cd_band"],
        "predicted_income":    record["predicted_income"],
        "predicted_income_bucket": record["exact_income_bucket"],
        "cd_credit_score":     record["cd_credit_score"],
        "cd_probability":      record["cd_default_probability"],
        "cohort":              record["cohort"],
        "cd_date":             record["cd_date"],
        # Bands data (Bands view)
        "bands_dpd30_band":    record["bands_dpd30_band"],
        "bands_dpd90_band":    record["bands_dpd90_band"],
        "bands_cd_band":       record["bands_cd_band"],
        "bands_income_bucket": record["bands_income_bucket"],
        "dpd30_prob_band":     record["dpd_30_prob_band"],
        "dpd90_prob_band":     record["dpd_90_prob_band"],
        "cd_prob_band":        record["cd_dpd_30_prob_band"],
        "thick_thin_data":     record["thick_thin_data"],
        "model_version":       record["model_version"],
        # Trust Scan 1.0
        "ts1_band":            record.get("ts1_band", ""),
        # Data Engineering Layer variables (None if not available)
        "de_variables":        _DE_DATA.get(phone),
    }



@app.get("/health")
def health_check():
    return {"status": "healthy", "contacts_loaded": len(_DATA)}


# ── Unified scan endpoint (live API → CSV fallback) ───────────────────────────

# TS 2.0 attributes to request from the live API
_TS2_SCAN_ATTRS = [
    "dpd_30_prob_band", "dpd_90_prob_band", "cd_dpd_30_prob_band",
    "thick_thin_data", "predicted_income_bucket",
    # DE layer variables
    "avg_amount", "yearly_transaction_volume", "max_vintage",
    "weighted_success_rate", "perc_non_discretionary_spends",
    "unique_city_transacted", "yoy_growth_percentage", "ott_trxns_last_1_year",
    "perc_merchants_emi_linked", "upi_payment_amount", "vintage_utilities",
    "weighted_error_ratio", "unique_state_transacted",
    "loan_stacking_amount_l3m", "count_issuer_cc",
]

def _extract_ts1_band(body: dict) -> str:
    """Flexibly extract the A-G band letter from any TS 1.0 API response shape."""
    if not body:
        return ""
    raw = (
        body.get("band") or
        (body.get("credit_risk") or {}).get("risk_band") or
        (body.get("trust_scan") or {}).get("band") or
        (body.get("data") or {}).get("band") or
        body.get("risk_band") or
        body.get("risk_profile_band") or ""
    )
    return str(raw).strip().upper()[:1] if raw else ""

def _extract_attr(val) -> str:
    """Normalize a TS 2.0 attribute value — may be a plain string or a nested object."""
    if val is None:
        return ""
    if isinstance(val, dict):
        return str(val.get("band") or val.get("value") or val.get("code") or "")
    return str(val)

def _live_scan(phone: str) -> dict:
    sha = hashlib.sha256(phone.encode()).hexdigest()

    # ── TS 1.0 ────────────────────────────────────────────────────────────────
    ts1_result = _razorpay_request(
        "https://api.razorpay.com/v1/trust_scan",
        {"customer": {"contact": phone}},
        _LIVE_CONFIG["ts1_auth"],
    )
    ts1_band = ""
    if ts1_result["status"] == 200:
        ts1_band = _extract_ts1_band(ts1_result["body"])
    elif ts1_result["status"] == 404:
        pass  # not found is fine — TS2 may still have data
    else:
        raise HTTPException(status_code=ts1_result["status"], detail=ts1_result["body"])

    # ── TS 2.0 (chunked) ──────────────────────────────────────────────────────
    CHUNK = 40
    chunks = [_TS2_SCAN_ATTRS[i:i+CHUNK] for i in range(0, len(_TS2_SCAN_ATTRS), CHUNK)]
    raw_attrs: dict = {}
    as_of = None
    for chunk in chunks:
        result = _razorpay_request(
            "https://api.razorpay.com/v2/engage/trust_scan",
            {"customer_identifier": {"type": "SHA256_PHONE", "value": sha}, "attributes": chunk},
            _LIVE_CONFIG["ts2_auth"],
        )
        if result["status"] == 404:
            continue
        if result["status"] != 200:
            raise HTTPException(status_code=result["status"], detail=result["body"])
        rb = result["body"]
        if as_of is None:
            as_of = rb.get("as_of") or (rb.get("data") or {}).get("as_of")
        chunk_attrs = rb.get("attributes") or (rb.get("data") or {}).get("attributes") or {}
        for k, v in chunk_attrs.items():
            raw_attrs[k] = _extract_attr(v)

    if not ts1_band and not raw_attrs:
        raise HTTPException(status_code=404, detail="No data found for this phone number")

    dpd30_prob = raw_attrs.get("dpd_30_prob_band", "")
    dpd90_prob = raw_attrs.get("dpd_90_prob_band", "")
    cd_prob    = raw_attrs.get("cd_dpd_30_prob_band", "")

    de_vars = {k: raw_attrs.get(k, "") for k in [
        "avg_amount", "yearly_transaction_volume", "max_vintage",
        "weighted_success_rate", "perc_non_discretionary_spends",
        "unique_city_transacted", "yoy_growth_percentage", "ott_trxns_last_1_year",
        "perc_merchants_emi_linked", "upi_payment_amount", "vintage_utilities",
        "weighted_error_ratio", "unique_state_transacted",
        "loan_stacking_amount_l3m", "count_issuer_cc",
    ]}

    return {
        "phone": phone,
        "source": "live",
        "ts1_band": ts1_band,
        # Risk bands — decile format (A1..J9) from live API
        "dpd30_band":  dpd30_prob,
        "dpd90_band":  dpd90_prob,
        "cd_band":     cd_prob,
        "dpd30_prob_band": dpd30_prob,
        "dpd90_prob_band": dpd90_prob,
        "cd_prob_band":    cd_prob,
        # Income & engagement
        "predicted_income_bucket": raw_attrs.get("predicted_income_bucket", ""),
        "predicted_income":        "",
        "thick_thin_data":         raw_attrs.get("thick_thin_data", ""),
        "cohort":                  "",
        # Dates
        "dpd_date": as_of or "",
        "cd_date":  as_of or "",
        # Scores/probs — not returned by live API (compliance)
        "dpd30_credit_score": "", "dpd90_credit_score": "", "cd_credit_score": "",
        "dpd30_probability":  "", "dpd90_probability":  "", "cd_probability":  "",
        # Bands view fields
        "bands_dpd30_band":    dpd30_prob,
        "bands_dpd90_band":    dpd90_prob,
        "bands_cd_band":       cd_prob,
        "bands_income_bucket": raw_attrs.get("predicted_income_bucket", ""),
        "model_version": "live",
        # DE layer
        "de_variables": de_vars,
    }


@app.get("/api/scan/{phone}")
def unified_scan(phone: str):
    """
    Unified scan: calls live Razorpay API when credentials are configured,
    falls back to in-memory CSV data otherwise.
    """
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")

    if _live_configured():
        return _live_scan(phone)

    # CSV fallback
    record = _DATA.get(phone)
    if not record:
        raise HTTPException(status_code=404, detail="No data found for this phone number")

    return {
        "phone": phone,
        "source": "csv",
        "dpd30_band":          record["exact_dpd30_band"],
        "dpd90_band":          record["exact_dpd90_band"],
        "dpd30_credit_score":  record["dpd30_credit_score"],
        "dpd90_credit_score":  record["dpd90_credit_score"],
        "dpd30_probability":   record["dpd30_default_probability"],
        "dpd90_probability":   record["dpd90_default_probability"],
        "dpd_date":            record["dpd_date"],
        "cd_band":             record["exact_cd_band"],
        "predicted_income":    record["predicted_income"],
        "predicted_income_bucket": record["exact_income_bucket"],
        "cd_credit_score":     record["cd_credit_score"],
        "cd_probability":      record["cd_default_probability"],
        "cohort":              record["cohort"],
        "cd_date":             record["cd_date"],
        "bands_dpd30_band":    record["bands_dpd30_band"],
        "bands_dpd90_band":    record["bands_dpd90_band"],
        "bands_cd_band":       record["bands_cd_band"],
        "bands_income_bucket": record["bands_income_bucket"],
        "dpd30_prob_band":     record["dpd_30_prob_band"],
        "dpd90_prob_band":     record["dpd_90_prob_band"],
        "cd_prob_band":        record["cd_dpd_30_prob_band"],
        "thick_thin_data":     record["thick_thin_data"],
        "model_version":       record["model_version"],
        "ts1_band":            record.get("ts1_band", ""),
        "de_variables":        _DE_DATA.get(phone),
    }


# ── Live API proxy ────────────────────────────────────────────────────────────
# Mirrors the local proxy in TrustScan 2.app — credentials stored in memory,
# seeded from env vars TS1_AUTH / TS2_AUTH on startup, overridable via /api/setup.

_LIVE_CONFIG: dict = {
    "ts1_auth": os.getenv("TS1_AUTH", ""),
    "ts2_auth": os.getenv("TS2_AUTH", ""),
}

def _live_configured() -> bool:
    return bool(_LIVE_CONFIG.get("ts1_auth") and _LIVE_CONFIG.get("ts2_auth"))

def _norm_auth(s: str) -> str:
    t = s.strip()
    if not t:
        return ""
    return t if t.startswith("Basic ") else f"Basic {t}"


class LiveSetupRequest(BaseModel):
    ts1_auth: str
    ts2_auth: str

class Ts1LiveRequest(BaseModel):
    contact: str

class Ts2LiveRequest(BaseModel):
    sha256: str
    attributes: List[str]


@app.post("/api/setup")
def setup_live(body: LiveSetupRequest):
    ts1 = _norm_auth(body.ts1_auth)
    ts2 = _norm_auth(body.ts2_auth)
    if not ts1 or not ts2:
        raise HTTPException(status_code=400, detail="Both ts1_auth and ts2_auth are required")
    _LIVE_CONFIG["ts1_auth"] = ts1
    _LIVE_CONFIG["ts2_auth"] = ts2
    logger.info("Live API credentials updated via /api/setup")
    return {"ok": True, "setup": "complete"}


@app.get("/api/live/health")
def live_health():
    return {
        "ok": True,
        "setup": "complete" if _live_configured() else "required",
        "ts1_auth_set": bool(_LIVE_CONFIG.get("ts1_auth")),
        "ts2_auth_set": bool(_LIVE_CONFIG.get("ts2_auth")),
    }


def _razorpay_request(url: str, payload: dict, auth: str) -> dict:
    """Make a POST to api.razorpay.com and return the parsed JSON body."""
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Authorization": auth},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return {"status": resp.status, "body": json.loads(resp.read().decode())}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            err_body = json.loads(raw.decode())
        except Exception:
            err_body = {"raw": raw.decode()}
        return {"status": e.code, "body": err_body}
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"error": "upstream_unreachable", "detail": str(exc)})


@app.post("/api/live/ts1")
def live_ts1(body: Ts1LiveRequest):
    if not _live_configured():
        raise HTTPException(status_code=409, detail={
            "code": "SETUP_REQUIRED",
            "description": "API keys not configured. POST credentials to /api/setup first.",
        })
    contact = body.contact.strip()
    if not contact.isdigit() or len(contact) != 10:
        raise HTTPException(status_code=400, detail="contact must be a 10-digit phone number")

    result = _razorpay_request(
        "https://api.razorpay.com/v1/trust_scan",
        {"customer": {"contact": contact}},
        _LIVE_CONFIG["ts1_auth"],
    )
    if result["status"] != 200:
        raise HTTPException(status_code=result["status"], detail=result["body"])
    return result["body"]


@app.post("/api/live/ts2")
def live_ts2(body: Ts2LiveRequest):
    if not _live_configured():
        raise HTTPException(status_code=409, detail={
            "code": "SETUP_REQUIRED",
            "description": "API keys not configured. POST credentials to /api/setup first.",
        })
    sha = body.sha256.strip().lower()
    if not re.match(r"^[0-9a-f]{64}$", sha):
        raise HTTPException(status_code=400, detail="sha256 must be a 64-char hex string")
    attrs = body.attributes
    if not attrs:
        raise HTTPException(status_code=400, detail="attributes must be a non-empty list")

    # API caps at 40 attributes per request — chunk and merge
    CHUNK = 40
    chunks = [attrs[i:i+CHUNK] for i in range(0, len(attrs), CHUNK)]
    merged_attrs: dict = {}
    as_of = None
    for chunk in chunks:
        result = _razorpay_request(
            "https://api.razorpay.com/v2/engage/trust_scan",
            {
                "customer_identifier": {"type": "SHA256_PHONE", "value": sha},
                "attributes": chunk,
            },
            _LIVE_CONFIG["ts2_auth"],
        )
        if result["status"] != 200:
            raise HTTPException(status_code=result["status"], detail=result["body"])
        rb = result["body"]
        if as_of is None:
            as_of = rb.get("as_of") or rb.get("data", {}).get("as_of")
        chunk_attrs = rb.get("attributes") or rb.get("data", {}).get("attributes") or {}
        merged_attrs.update(chunk_attrs)

    return {"as_of": as_of, "attributes": merged_attrs}


# ── Serve React frontend ──────────────────────────────────────────────────────

_REPO_ROOT = Path(__file__).parent
_BUILD_DIR = _REPO_ROOT / "frontend" / "build"

if _BUILD_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_BUILD_DIR / "static")), name="static")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        return FileResponse(str(_BUILD_DIR / "index.html"))
else:
    @app.get("/")
    def root():
        return {"message": "TrustScan API running. Frontend build not found."}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8501"))
    uvicorn.run(app, host="0.0.0.0", port=port)
