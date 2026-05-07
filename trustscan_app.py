from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List
import os
import csv
import io
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
]

# ── In-memory store ───────────────────────────────────────────────────────────
# Keyed by contact (phone number) → dict of all columns
_DATA: dict = {}


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
    }


@app.post("/api/batch-trust-scan")
def batch_trust_scan(payload: dict):
    phones = payload.get("phones", [])
    if not phones:
        raise HTTPException(status_code=400, detail="No phone numbers provided")
    if len(phones) > 500:
        raise HTTPException(status_code=400, detail="Max 500 numbers per batch")
    phones = [str(p) for p in phones if str(p).isdigit() and len(str(p)) == 10]
    if not phones:
        raise HTTPException(status_code=400, detail="No valid 10-digit numbers found")

    results = []
    for phone in phones:
        record = _DATA.get(phone)
        if record:
            results.append({
                "phone": phone,
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
            })
        else:
            results.append({"phone": phone})
    return {"results": results}


# ── Bands Scan endpoints ──────────────────────────────────────────────────────

@app.get("/api/bands-scan/{phone}")
def bands_scan(phone: str):
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")

    record = _DATA.get(phone)
    if not record:
        raise HTTPException(status_code=404, detail="No data found for this phone number")

    return {
        "phone": phone,
        "dpd30_band":              record["bands_dpd30_band"],
        "dpd90_band":              record["bands_dpd90_band"],
        "cd_band":                 record["bands_cd_band"],
        "predicted_income_bucket": record["bands_income_bucket"],
        "thick_thin_data":         record["thick_thin_data"],
        "model_version":           record["model_version"],
        "dpd30_prob_band":         record["dpd_30_prob_band"],
        "dpd90_prob_band":         record["dpd_90_prob_band"],
        "cd_prob_band":            record["cd_dpd_30_prob_band"],
    }


@app.post("/api/batch-bands-scan")
def batch_bands_scan(payload: dict):
    phones = payload.get("phones", [])
    if not phones:
        raise HTTPException(status_code=400, detail="No phone numbers provided")
    if len(phones) > 500:
        raise HTTPException(status_code=400, detail="Max 500 numbers per batch")
    phones = [str(p) for p in phones if str(p).isdigit() and len(str(p)) == 10]
    if not phones:
        raise HTTPException(status_code=400, detail="No valid 10-digit numbers found")

    results = []
    for phone in phones:
        record = _DATA.get(phone)
        if record:
            results.append({
                "phone": phone,
                "dpd30_band":              record["bands_dpd30_band"],
                "dpd90_band":              record["bands_dpd90_band"],
                "cd_band":                 record["bands_cd_band"],
                "predicted_income_bucket": record["bands_income_bucket"],
                "thick_thin_data":         record["thick_thin_data"],
                "model_version":           record["model_version"],
                "dpd30_prob_band":         record["dpd_30_prob_band"],
                "dpd90_prob_band":         record["dpd_90_prob_band"],
                "cd_prob_band":            record["cd_dpd_30_prob_band"],
            })
        else:
            results.append({"phone": phone})
    return {"results": results}


@app.get("/health")
def health_check():
    return {"status": "healthy", "contacts_loaded": len(_DATA)}


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
