from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import trino
from trino.auth import BasicAuthentication
import os
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Trino Query API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
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
TRINO_HTTP_SCHEME = os.getenv("TRINO_HTTP_SCHEME", "http")


def get_trino_connection():
    auth = BasicAuthentication(TRINO_USER, TRINO_PASSWORD) if TRINO_PASSWORD else None
    return trino.dbapi.connect(
        host=TRINO_HOST,
        port=TRINO_PORT,
        user=TRINO_USER,
        http_scheme=TRINO_HTTP_SCHEME,
        auth=auth,
        catalog=TRINO_CATALOG,
        schema=TRINO_SCHEMA,
    )


# ── Legacy impressions endpoint (kept for backwards compat) ──────────────────

class ImpressionQuery(BaseModel):
    offer_id: str
    query_date: str


@app.post("/query/impressions")
def query_impressions(query: ImpressionQuery):
    try:
        conn = get_trino_connection()
        cursor = conn.cursor()
        cursor.execute(f"""
            SELECT SUM(impressions) as total_impressions
            FROM aggregate_ba.engage_bu_mid_level_impressions
            WHERE offer_id = '{query.offer_id}'
            AND producer_created_date = '{query.query_date}'
        """)
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        if result and result[0] is not None:
            return {"offer_id": query.offer_id, "date": query.query_date, "total_impressions": result[0]}
        return {"offer_id": query.offer_id, "date": query.query_date, "total_impressions": 0,
                "message": "No data found"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {str(e)}")


# ── Trust Scan endpoint ──────────────────────────────────────────────────────

@app.get("/api/trust-scan/{phone}")
def trust_scan(phone: str):
    # Validate: digits only, 10 chars
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")

    try:
        conn = get_trino_connection()
        cursor = conn.cursor()

        # DPD table: latest record for this contact
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

        # CD + income table: latest record for this contact
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
                "dpd30_band": dpd_row[0],
                "dpd90_band": dpd_row[1],
                "dpd30_credit_score": dpd_row[2],
                "dpd90_credit_score": dpd_row[3],
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

    # Validate all are 10-digit numbers
    phones = [p for p in phones if str(p).isdigit() and len(str(p)) == 10]
    if not phones:
        raise HTTPException(status_code=400, detail="No valid 10-digit numbers found")

    in_clause = ",".join(f"'{p}'" for p in phones)

    try:
        conn = get_trino_connection()
        cursor = conn.cursor()

        # Fetch all DPD rows in one query (latest date per contact via subquery)
        cursor.execute(f"""
            SELECT contact, dpd30_band, dpd90_band,
                   dpd30_credit_score, dpd90_credit_score,
                   dpd30_default_probability, dpd90_default_probability, date
            FROM hive.aggregate_ba.ts_dpd_predictions_ajay_9_april
            WHERE contact IN ({in_clause})
              AND date = (SELECT MAX(date)
                          FROM hive.aggregate_ba.ts_dpd_predictions_ajay_9_april)
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

        # Fetch all CD/income rows in one query
        cursor.execute(f"""
            SELECT contact, cd_band, predicted_income, predicted_income_bucket,
                   cd_credit_score, cd_default_probability, cohort, date
            FROM hive.aggregate_ba.ts_dpd_predictions_cd_income_20_april
            WHERE contact IN ({in_clause})
              AND date = (SELECT MAX(date)
                          FROM hive.aggregate_ba.ts_dpd_predictions_cd_income_20_april)
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


# ── Bands Scan endpoints (engage_trustscan_api_ready_variables) ─────────────

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
            "dpd30_band":  row[0],
            "dpd90_band":  row[1],
            "cd_band":     row[2],
            "predicted_income_bucket": row[3],
            "thick_thin_data": row[4],
            "model_version":   row[5],
            "computed_at":     str(row[6]),
            "dpd30_prob_band": row[7],
            "dpd90_prob_band": row[8],
            "cd_prob_band":    row[9],
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
                "phone":    row[0],
                "dpd30_band":  row[1],
                "dpd90_band":  row[2],
                "cd_band":     row[3],
                "predicted_income_bucket": row[4],
                "thick_thin_data": row[5],
                "model_version":   row[6],
                "computed_at":     row[7],
                "dpd30_prob_band": row[8],
                "dpd90_prob_band": row[9],
                "cd_prob_band":    row[10],
            }
        cursor.close()
        conn.close()

        results = [results_map.get(p, {"phone": p}) for p in phones]
        return {"results": results}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Batch query failed: {str(e)}")


@app.get("/health")
def health_check():
    try:
        conn = get_trino_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        cursor.close()
        conn.close()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Database connection failed: {str(e)}")
