from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List
import trino
from trino.auth import BasicAuthentication
import os
from pathlib import Path

app = FastAPI(title="TrustScan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Trino connection config
TRINO_HOST = os.getenv("TRINO_HOST", "localhost")
TRINO_PORT = int(os.getenv("TRINO_PORT", "8080"))
TRINO_USER = os.getenv("TRINO_USER", "admin")
TRINO_PASSWORD = os.getenv("TRINO_PASSWORD", "")
TRINO_CATALOG = os.getenv("TRINO_CATALOG", "hive")
TRINO_SCHEMA = os.getenv("TRINO_SCHEMA", "aggregate_ba")
TRINO_HTTP_SCHEME = os.getenv("TRINO_HTTP_SCHEME", "https")


def get_trino_connection():
    # Internal coordinator (trino-coordinator.int.stage.razorpay.in) uses HTTPS
    # but does not require password auth from within the cluster.
    # verify=False is needed because it uses an internal TLS certificate.
    # TRINO_USE_BASIC_AUTH=true enables BasicAuthentication (for gateway URLs).
    import urllib3
    urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
    use_basic_auth = os.getenv("TRINO_USE_BASIC_AUTH", "false").lower() == "true"
    auth = BasicAuthentication(TRINO_USER, TRINO_PASSWORD) if (TRINO_PASSWORD and use_basic_auth) else None
    return trino.dbapi.connect(
        host=TRINO_HOST,
        port=TRINO_PORT,
        user=TRINO_USER,
        http_scheme=TRINO_HTTP_SCHEME,
        auth=auth,
        catalog=TRINO_CATALOG,
        schema=TRINO_SCHEMA,
        verify=False,
    )


# ── Trust Scan endpoint ──────────────────────────────────────────────────────

@app.get("/api/trust-scan/{phone}")
def trust_scan(phone: str):
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")
    try:
        conn = get_trino_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT dpd30_band, dpd90_band,
                   dpd30_credit_score, dpd90_credit_score,
                   dpd30_default_probability, dpd90_default_probability,
                   date
            FROM hive.aggregate_ba.ts_dpd_predictions_ajay_9_april
            WHERE contact = '{phone}'
            ORDER BY date DESC
            LIMIT 1
        """)
        dpd_row = cursor.fetchone()
        cursor.execute(f"""
            SELECT cd_band, predicted_income, predicted_income_bucket,
                   cd_credit_score, cd_default_probability, cohort, date
            FROM hive.aggregate_ba.ts_dpd_predictions_cd_income_20_april
            WHERE contact = '{phone}'
            ORDER BY date DESC
            LIMIT 1
        """)
        cd_row = cursor.fetchone()
        cursor.close()
        conn.close()

        if not dpd_row and not cd_row:
            raise HTTPException(status_code=404, detail="No data found for this phone number")

        result = {"phone": phone}
        if dpd_row:
            result.update({
                "dpd30_band": dpd_row[0], "dpd90_band": dpd_row[1],
                "dpd30_credit_score": dpd_row[2], "dpd90_credit_score": dpd_row[3],
                "dpd30_probability": round(dpd_row[4] * 100, 1),
                "dpd90_probability": round(dpd_row[5] * 100, 1),
                "dpd_date": str(dpd_row[6]),
            })
        if cd_row:
            result.update({
                "cd_band": cd_row[0],
                "predicted_income": round(cd_row[1]) if cd_row[1] else None,
                "predicted_income_bucket": cd_row[2],
                "cd_credit_score": cd_row[3],
                "cd_probability": round(cd_row[4] * 100, 1),
                "cohort": cd_row[5],
                "cd_date": str(cd_row[6]),
            })
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@app.post("/api/batch-trust-scan")
def batch_trust_scan(payload: dict):
    phones = payload.get("phones", [])
    if not phones:
        raise HTTPException(status_code=400, detail="No phone numbers provided")
    if len(phones) > 500:
        raise HTTPException(status_code=400, detail="Max 500 numbers per batch")
    phones = [p for p in phones if str(p).isdigit() and len(str(p)) == 10]
    if not phones:
        raise HTTPException(status_code=400, detail="No valid 10-digit numbers found")
    in_clause = ",".join(f"'{p}'" for p in phones)
    try:
        conn = get_trino_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT contact, dpd30_band, dpd90_band,
                   dpd30_credit_score, dpd90_credit_score,
                   dpd30_default_probability, dpd90_default_probability, date
            FROM hive.aggregate_ba.ts_dpd_predictions_ajay_9_april
            WHERE contact IN ({in_clause})
              AND date = (SELECT MAX(date) FROM hive.aggregate_ba.ts_dpd_predictions_ajay_9_april)
        """)
        dpd_map = {}
        for row in cursor.fetchall():
            dpd_map[row[0]] = {
                "dpd30_band": row[1], "dpd90_band": row[2],
                "dpd30_credit_score": row[3], "dpd90_credit_score": row[4],
                "dpd30_probability": round(row[5] * 100, 1),
                "dpd90_probability": round(row[6] * 100, 1),
                "dpd_date": str(row[7]),
            }
        cursor.execute(f"""
            SELECT contact, cd_band, predicted_income, predicted_income_bucket,
                   cd_credit_score, cd_default_probability, cohort, date
            FROM hive.aggregate_ba.ts_dpd_predictions_cd_income_20_april
            WHERE contact IN ({in_clause})
              AND date = (SELECT MAX(date) FROM hive.aggregate_ba.ts_dpd_predictions_cd_income_20_april)
        """)
        cd_map = {}
        for row in cursor.fetchall():
            cd_map[row[0]] = {
                "cd_band": row[1],
                "predicted_income": round(row[2]) if row[2] else None,
                "predicted_income_bucket": row[3],
                "cd_credit_score": row[4],
                "cd_probability": round(row[5] * 100, 1),
                "cohort": row[6],
                "cd_date": str(row[7]),
            }
        cursor.close()
        conn.close()
        results = []
        for p in phones:
            record = {"phone": p}
            record.update(dpd_map.get(p, {}))
            record.update(cd_map.get(p, {}))
            results.append(record)
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch query failed: {str(e)}")


# ── Bands Scan endpoints ─────────────────────────────────────────────────────

@app.get("/api/bands-scan/{phone}")
def bands_scan(phone: str):
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")
    try:
        conn = get_trino_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT ts.dpd30_band, ts.dpd90_band, ts.cd_dpd30_band,
                   ts.predicted_income_bucket, ts.thick_thin_data,
                   ts.model_version, ts.part1_computed_at,
                   ts.dpd_30_prob_band, ts.dpd_90_prob_band, ts.cd_dpd_30_prob_band
            FROM hive.aggregate_ba.engage_trustscan_api_ready_variables ts
            JOIN hive.aggregate_ba.all_unique_contacts_trustscan uc
              ON ts.main_contact = LOWER(uc.hashed_contact)
            WHERE uc.contact = '{phone}'
            LIMIT 1
        """)
        row = cursor.fetchone()
        cursor.close()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="No data found for this phone number")
        return {
            "phone": phone,
            "dpd30_band": row[0], "dpd90_band": row[1], "cd_band": row[2],
            "predicted_income_bucket": row[3], "thick_thin_data": row[4],
            "model_version": row[5], "computed_at": str(row[6]),
            "dpd30_prob_band": row[7], "dpd90_prob_band": row[8], "cd_prob_band": row[9],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Query failed: {str(e)}")


@app.post("/api/batch-bands-scan")
def batch_bands_scan(payload: dict):
    phones = payload.get("phones", [])
    if not phones:
        raise HTTPException(status_code=400, detail="No phone numbers provided")
    if len(phones) > 500:
        raise HTTPException(status_code=400, detail="Max 500 numbers per batch")
    phones = [p for p in phones if str(p).isdigit() and len(str(p)) == 10]
    if not phones:
        raise HTTPException(status_code=400, detail="No valid 10-digit numbers found")
    in_clause = ",".join(f"'{p}'" for p in phones)
    try:
        conn = get_trino_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT uc.contact, ts.dpd30_band, ts.dpd90_band, ts.cd_dpd30_band,
                   ts.predicted_income_bucket, ts.thick_thin_data,
                   ts.model_version, CAST(ts.part1_computed_at AS VARCHAR),
                   ts.dpd_30_prob_band, ts.dpd_90_prob_band, ts.cd_dpd_30_prob_band
            FROM hive.aggregate_ba.engage_trustscan_api_ready_variables ts
            JOIN hive.aggregate_ba.all_unique_contacts_trustscan uc
              ON ts.main_contact = LOWER(uc.hashed_contact)
            WHERE uc.contact IN ({in_clause})
        """)
        results_map = {}
        for row in cursor.fetchall():
            results_map[row[0]] = {
                "phone": row[0], "dpd30_band": row[1], "dpd90_band": row[2],
                "cd_band": row[3], "predicted_income_bucket": row[4],
                "thick_thin_data": row[5], "model_version": row[6],
                "computed_at": row[7], "dpd30_prob_band": row[8],
                "dpd90_prob_band": row[9], "cd_prob_band": row[10],
            }
        cursor.close()
        conn.close()
        results = [results_map.get(p, {"phone": p}) for p in phones]
        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch query failed: {str(e)}")


@app.get("/health")
def health_check():
    return {"status": "healthy"}


# ── Serve React frontend ─────────────────────────────────────────────────────
# The frontend/build/ directory is expected at the same level as this script

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
