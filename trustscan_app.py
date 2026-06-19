from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
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
import urllib.parse
import secrets
import time
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("trustscan")

# ── Unified audit log (persisted to S3) ───────────────────────────────────────
# Must live under TS_POC/ — the only prefix the pod's IRSA role can write to.
AUDIT_LOG_KEY = os.getenv("AUDIT_LOG_KEY", "TS_POC/activity_log/audit_events.jsonl")
import threading, datetime
_AUDIT_LOCK = threading.Lock()

def _detect_device(ua: str) -> str:
    ua = ua.lower()
    if any(x in ua for x in ["iphone", "android", "mobile", "blackberry", "windows phone"]):
        return "Mobile"
    if any(x in ua for x in ["ipad", "tablet"]):
        return "Tablet"
    return "Desktop"

def _req_meta(request: Request):
    """Extract ip, device, access from a request."""
    ip = request.headers.get("x-forwarded-for", "").split(",")[0].strip() or \
         (request.client.host if request.client else "unknown")
    ua = request.headers.get("user-agent", "")
    host = request.headers.get("x-forwarded-host") or request.url.hostname or ""
    return ip, _detect_device(ua), ("External" if "ext" in host else "Internal"), host

def _audit(event: dict):
    """Append an audit event to the S3 NDJSON log (background thread, never
    blocks the request). Stamps an IST timestamp and serializes the
    read-modify-write with a lock so concurrent events don't clobber each other."""
    event["timestamp"] = datetime.datetime.now(
        datetime.timezone(datetime.timedelta(hours=5, minutes=30))
    ).strftime("%Y-%m-%d %H:%M:%S IST")
    def _write():
        try:
            import boto3
            bucket = os.getenv("S3_BUCKET", "rzp-1415-prod-general-purpose-analytics")
            s3 = boto3.client("s3", region_name="ap-south-1")
            with _AUDIT_LOCK:
                try:
                    existing = s3.get_object(Bucket=bucket, Key=AUDIT_LOG_KEY)["Body"].read().decode()
                except Exception:
                    existing = ""
                s3.put_object(Bucket=bucket, Key=AUDIT_LOG_KEY,
                              Body=(existing + json.dumps(event) + "\n").encode(),
                              ContentType="application/x-ndjson")
        except Exception as e:
            logger.warning(f"[AUDIT_ERR] {e}")
    threading.Thread(target=_write, daemon=True).start()


# ── Global daily search rate limit (persisted in S3) ───────────────────────────
# One shared counter for the whole app. A "search" = one scan = one /api/ts1 call.
# Stored as s3://$S3_BUCKET/TS_POC/search_counter/<YYYY-MM-DD>.json so it survives
# pod restarts and resets automatically at midnight IST.
DAILY_SEARCH_LIMIT = int(os.getenv("DAILY_SEARCH_LIMIT", "1000"))
RATE_LIMIT_PREFIX  = os.getenv("RATE_LIMIT_PREFIX", "TS_POC/search_counter/")
_IST = datetime.timezone(datetime.timedelta(hours=5, minutes=30))
_RATE_LOCK = threading.Lock()

def _rate_key():
    day = datetime.datetime.now(_IST).strftime("%Y-%m-%d")
    return day, f"{RATE_LIMIT_PREFIX}{day}.json"

def _search_quota(do_increment: bool):
    """Global daily search counter in S3. Returns (allowed, count, limit).

    do_increment=True consumes one search (used by /api/ts1, once per scan);
    /api/ts2 calls with False to gate without double-counting the chunked calls.
    Serialized by a lock and FAILS OPEN on any S3 error so a transient S3 issue
    never blocks scanning.
    """
    with _RATE_LOCK:
        try:
            import boto3
            from botocore.exceptions import ClientError
            bucket = os.getenv("S3_BUCKET", "rzp-1415-prod-general-purpose-analytics")
            s3 = boto3.client("s3", region_name="ap-south-1")
            day, key = _rate_key()
            try:
                obj = s3.get_object(Bucket=bucket, Key=key)
                count = int(json.loads(obj["Body"].read().decode()).get("count", 0))
            except ClientError as e:
                if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404"):
                    count = 0
                else:
                    raise
            if count >= DAILY_SEARCH_LIMIT:
                return False, count, DAILY_SEARCH_LIMIT
            if do_increment:
                count += 1
                s3.put_object(
                    Bucket=bucket, Key=key,
                    Body=json.dumps({
                        "date": day, "count": count, "limit": DAILY_SEARCH_LIMIT,
                        "updated": datetime.datetime.now(_IST).strftime("%Y-%m-%d %H:%M:%S IST"),
                    }).encode(),
                    ContentType="application/json",
                )
            return True, count, DAILY_SEARCH_LIMIT
        except Exception as e:
            logger.warning(f"[RATE_LIMIT_ERR] {e} — failing open")
            return True, -1, DAILY_SEARCH_LIMIT

def _rate_limit_response(limit: int):
    return JSONResponse(status_code=429, content={"error": {
        "code": "DAILY_LIMIT_REACHED",
        "reason": "daily_limit_reached",
        "description": f"The daily limit of {limit} searches has been reached. It resets at midnight IST.",
    }})

app = FastAPI(title="TrustScan API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── OAuth / Session Config ─────────────────────────────────────────────────────
GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI",
    "https://trustscan-analytics.dev.razorpay.in/auth/callback")
SESSION_SECRET = os.getenv("SESSION_SECRET", secrets.token_hex(32))
SESSION_HOURS  = 8

# Env-seeded allowlist — used to SEED the S3 store on first run and as a fallback
# if S3 is ever unreachable. The live source of truth is the S3 file below.
ALLOWED_EMAILS = set(
    e.strip().lower()
    for e in os.getenv("ALLOWED_EMAILS", "ajay.shankar@razorpay.com").split(",")
    if e.strip()
)

# Admins who can manage access via the in-app panel (static, via env).
ADMIN_EMAILS = set(
    e.strip().lower()
    for e in os.getenv("ADMIN_EMAILS", "ajay.shankar@razorpay.com,dhruv.goel@razorpay.com").split(",")
    if e.strip()
)

# ── Dynamic, admin-editable allowlist (S3-backed) ──────────────────────────────
# Source of truth: s3://$S3_BUCKET/TS_POC/config/allowed_emails.json. Seeded from
# the ALLOWED_EMAILS env var on first run (so nobody loses access), cached in
# memory with a short TTL, and falls back to the env set if S3 is unreachable.
# Admins (ADMIN_EMAILS) are always included so they can never lock themselves out.
ALLOWLIST_KEY   = os.getenv("ALLOWLIST_KEY", "TS_POC/config/allowed_emails.json")
_ALLOWLIST_TTL  = 30  # seconds
_ALLOWLIST_CACHE = {"emails": None, "ts": 0.0}
_ALLOWLIST_LOCK = threading.Lock()

def _allowlist_s3():
    import boto3
    return (boto3.client("s3", region_name="ap-south-1"),
            os.getenv("S3_BUCKET", "rzp-1415-prod-general-purpose-analytics"))

def _read_allowlist():
    """Return the allowlist set from S3, or None if absent/unreadable."""
    try:
        s3, bucket = _allowlist_s3()
        raw = s3.get_object(Bucket=bucket, Key=ALLOWLIST_KEY)["Body"].read().decode()
        return set(e.strip().lower() for e in json.loads(raw).get("emails", []) if e.strip())
    except Exception:
        return None

def _write_allowlist(emails, updated_by="system"):
    s3, bucket = _allowlist_s3()
    body = json.dumps({
        "emails": sorted(emails),
        "updated": datetime.datetime.now(_IST).strftime("%Y-%m-%d %H:%M:%S IST"),
        "updated_by": updated_by,
    }, indent=2).encode()
    s3.put_object(Bucket=bucket, Key=ALLOWLIST_KEY, Body=body, ContentType="application/json")

def get_allowlist(force=False):
    """Cached allowlist set (admins always included). Seeds S3 from env on first
    run; falls back to the env set in-memory if S3 is unreachable."""
    import time
    now = time.time()
    with _ALLOWLIST_LOCK:
        if (not force and _ALLOWLIST_CACHE["emails"] is not None
                and now - _ALLOWLIST_CACHE["ts"] < _ALLOWLIST_TTL):
            return _ALLOWLIST_CACHE["emails"]
        s3set = _read_allowlist()
        if s3set is None:
            s3set = set(ALLOWED_EMAILS)              # seed from env
            try:
                _write_allowlist(s3set, updated_by="seed:env")
            except Exception as e:
                logger.warning(f"[ALLOWLIST_SEED_ERR] {e} — using env set in-memory")
        merged = s3set | ADMIN_EMAILS
        _ALLOWLIST_CACHE["emails"] = merged
        _ALLOWLIST_CACHE["ts"] = now
        return merged

def is_allowed(email):
    return (email or "").strip().lower() in get_allowlist()

def is_admin(email):
    return (email or "").strip().lower() in ADMIN_EMAILS

def _mutate_allowlist(add=None, remove=None, updated_by="admin"):
    """Add/remove emails on the S3 allowlist under the lock; returns sorted list
    of non-admin users."""
    import time
    with _ALLOWLIST_LOCK:
        current = _read_allowlist()
        if current is None:
            current = set(ALLOWED_EMAILS)
        for e in (add or []):
            e = (e or "").strip().lower()
            if e:
                current.add(e)
        for e in (remove or []):
            current.discard((e or "").strip().lower())
        current -= ADMIN_EMAILS          # admins live in ADMIN_EMAILS, not the file
        _write_allowlist(current, updated_by=updated_by)
        _ALLOWLIST_CACHE["emails"] = current | ADMIN_EMAILS
        _ALLOWLIST_CACHE["ts"] = time.time()
        return sorted(current)

# In-memory CSRF state store  { state_token -> created_timestamp }
_OAUTH_STATES: dict = {}


# ── Session helpers ────────────────────────────────────────────────────────────
def _make_session(email: str) -> str:
    from itsdangerous import URLSafeTimedSerializer
    return URLSafeTimedSerializer(SESSION_SECRET).dumps({"email": email})

def _verify_session(token: str):
    """Return email string or None."""
    if not token:
        return None
    from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
    try:
        data = URLSafeTimedSerializer(SESSION_SECRET).loads(
            token, max_age=SESSION_HOURS * 3600
        )
        return data.get("email")
    except (BadSignature, SignatureExpired):
        return None


# ── Auth Middleware ────────────────────────────────────────────────────────────
_AUTH_SKIP = {"/auth/login", "/auth/callback", "/auth/logout",
              "/api/health", "/health", "/favicon.ico"}

class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if path in _AUTH_SKIP or path.startswith("/static/"):
            return await call_next(request)

        email = _verify_session(request.cookies.get("ts_session"))
        if not email:
            if path.startswith("/api/"):
                return JSONResponse(status_code=401,
                    content={"error": "Authentication required", "login": "/auth/login"})
            return RedirectResponse(url="/auth/login")

        request.state.user_email = email
        return await call_next(request)

app.add_middleware(AuthMiddleware)


# ── Login page HTML ────────────────────────────────────────────────────────────
_LOGIN_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TrustScan · Sign in</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
  background:#F4F8FE;display:flex;align-items:center;justify-content:center;
  min-height:100vh;padding:24px}
.card{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;
  box-shadow:0 4px 24px rgba(1,38,82,.10);max-width:400px;width:100%}
.logo{margin-bottom:24px}
.logo svg{width:52px;height:58px}
h1{font-size:22px;font-weight:700;color:#0A1929;margin-bottom:8px;letter-spacing:-.02em}
p{font-size:13.5px;color:#52606D;line-height:1.55;margin-bottom:32px}
a.btn{display:inline-flex;align-items:center;gap:10px;background:#0A1929;color:#fff;
  font-size:14px;font-weight:600;padding:13px 24px;border-radius:10px;
  text-decoration:none;transition:background .15s}
a.btn:hover{background:#1A2B3F}
a.btn img{width:20px;height:20px;background:#fff;border-radius:3px;padding:2px}
.footer{margin-top:28px;font-size:11.5px;color:#9AA5B1}
</style>
</head>
<body>
<div class="card">
  <div class="logo">
    <svg viewBox="0 0 32 34" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 1L2 7v9C2 24.5 8.3 31.5 16 33c7.7-1.5 14-8.5 14-17V7Z" fill="#274DB0"/>
      <text x="16" y="22.5" font-family="Arial,sans-serif" font-size="11"
        font-weight="700" fill="white" text-anchor="middle" letter-spacing="-0.3">T.S</text>
    </svg>
  </div>
  <h1>TrustScan 2.0</h1>
  <p>Sign in with your Razorpay Google account to access the customer intelligence dashboard.</p>
  <a class="btn" href="/auth/login">
    <img src="https://www.google.com/favicon.ico" alt="G"/>
    Sign in with Google
  </a>
  <div class="footer">Access restricted to @razorpay.com accounts</div>
</div>
</body>
</html>"""


# ── OAuth Routes ───────────────────────────────────────────────────────────────
@app.get("/auth/login")
def auth_login(request: Request):
    state = secrets.token_urlsafe(32)
    # Store originating host so callback can redirect back to the right URL
    originating_host = request.headers.get("x-forwarded-host") or request.url.hostname or "trustscan-analytics.dev.razorpay.in"
    # Use http for ext URL, https for internal
    scheme = "https" if "ext" not in originating_host else "http"
    dynamic_redirect_uri = f"{scheme}://{originating_host}/auth/callback"
    _OAUTH_STATES[state] = {"ts": time.time(), "host": originating_host, "redirect_uri": dynamic_redirect_uri}
    # Prune stale states (> 15 min)
    for k in list(_OAUTH_STATES):
        entry = _OAUTH_STATES[k]
        ts = entry["ts"] if isinstance(entry, dict) else entry
        if time.time() - ts > 900:
            del _OAUTH_STATES[k]

    params = urllib.parse.urlencode({
        "client_id":     GOOGLE_CLIENT_ID,
        "redirect_uri":  dynamic_redirect_uri,
        "response_type": "code",
        "scope":         "openid email profile",
        "state":         state,
        "access_type":   "online",
        "prompt":        "select_account",
    })
    return RedirectResponse(
        url=f"https://accounts.google.com/o/oauth2/v2/auth?{params}",
        status_code=302,
    )


@app.get("/auth/callback")
def auth_callback(request: Request,
                  code: str = None, state: str = None, error: str = None):
    ip, device, access, host = _req_meta(request)

    if error:
        logger.warning(f"[OAUTH_ERROR] {error}")
        _audit({"type": "login", "status": "oauth_error", "reason": error,
                "device": device, "access": access, "ip": ip})
        return HTMLResponse(f"<h1>Access denied</h1><p>{error}</p>", status_code=403)

    # Validate CSRF state
    stored = _OAUTH_STATES.pop(state or "", None)
    ts = stored["ts"] if isinstance(stored, dict) else stored
    originating_host = stored.get("host", "trustscan-analytics.dev.razorpay.in") if isinstance(stored, dict) else "trustscan-analytics.dev.razorpay.in"
    scheme = "https" if "ext" not in originating_host else "http"
    dynamic_redirect_uri = stored.get("redirect_uri", f"{scheme}://{originating_host}/auth/callback") if isinstance(stored, dict) else GOOGLE_REDIRECT_URI
    if not ts or time.time() - ts > 900:
        _audit({"type": "login", "status": "invalid_state",
                "device": device, "access": access, "ip": ip})
        return HTMLResponse("<h1>Invalid or expired session state. Please try again.</h1>"
                            "<p><a href='/auth/login'>Sign in</a></p>", status_code=400)

    # Exchange code → access token
    token_payload = urllib.parse.urlencode({
        "code":          code,
        "client_id":     GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri":  dynamic_redirect_uri,
        "grant_type":    "authorization_code",
    }).encode()
    try:
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token",
            data=token_payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            token_resp = json.loads(r.read().decode())
    except Exception as e:
        logger.error(f"[OAUTH_TOKEN_ERROR] {e}")
        _audit({"type": "login", "status": "token_error", "reason": str(e),
                "device": device, "access": access, "ip": ip})
        return HTMLResponse(f"<h1>Token exchange failed</h1><p>{e}</p>", status_code=500)

    access_token = token_resp.get("access_token")
    if not access_token:
        _audit({"type": "login", "status": "token_error", "reason": "no access_token in response",
                "device": device, "access": access, "ip": ip})
        return HTMLResponse("<h1>No access token received from Google.</h1>", status_code=500)

    # Get user info
    try:
        ui_req = urllib.request.Request(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(ui_req, timeout=10) as r:
            userinfo = json.loads(r.read().decode())
    except Exception as e:
        logger.error(f"[OAUTH_USERINFO_ERROR] {e}")
        _audit({"type": "login", "status": "userinfo_error", "reason": str(e),
                "device": device, "access": access, "ip": ip})
        return HTMLResponse(f"<h1>Failed to get user info</h1><p>{e}</p>", status_code=500)

    email = userinfo.get("email", "").lower().strip()
    name  = userinfo.get("name", email)

    if not is_allowed(email):
        logger.warning(f"[ACCESS_DENIED] {email}")
        _audit({"type": "login", "status": "access_denied", "email": email, "name": name,
                "device": device, "access": access, "ip": ip})
        return HTMLResponse(f"""<!doctype html><html><head><title>Access Denied</title>
<style>body{{font-family:sans-serif;display:flex;align-items:center;justify-content:center;
min-height:100vh;background:#F4F8FE}}
.card{{background:#fff;border-radius:16px;padding:48px;text-align:center;max-width:420px;
box-shadow:0 4px 24px rgba(1,38,82,.1)}}
h1{{color:#B42318;margin-bottom:12px}}p{{color:#52606D;margin-bottom:20px}}
a{{color:#274DB0}}</style></head>
<body><div class="card">
<h1>Access Denied</h1>
<p><strong>{email}</strong> is not authorised to use TrustScan.</p>
<p>Contact <a href="mailto:ajay.shankar@razorpay.com">ajay.shankar@razorpay.com</a> to request access.</p>
</div></body></html>""", status_code=403)

    logger.info(f"[LOGIN] {email} | {name}")
    _audit({"type": "login", "status": "success", "email": email, "name": name,
            "device": device, "access": access, "ip": ip,
            "url": f"http://{originating_host}/"})

    # Redirect back to the URL the user originally came from (internal or external)
    redirect_url = f"http://{originating_host}/"
    resp = RedirectResponse(url=redirect_url, status_code=302)
    resp.set_cookie(
        "ts_session", _make_session(email),
        httponly=True, samesite="lax",
        domain=".dev.razorpay.in",
        max_age=SESSION_HOURS * 3600,
    )
    return resp


@app.get("/auth/logout")
def auth_logout():
    resp = RedirectResponse(url="/signin", status_code=302)
    resp.delete_cookie("ts_session")
    return resp


@app.get("/api/login-log")
def get_login_log(request: Request, type: str = None):
    """Return audit log from S3. ?type=login or ?type=scan to filter."""
    import boto3
    bucket = os.getenv("S3_BUCKET", "rzp-1415-prod-general-purpose-analytics")
    all_events = []
    # Read new unified log
    try:
        s3 = boto3.client("s3")
        raw = s3.get_object(Bucket=bucket, Key=AUDIT_LOG_KEY)["Body"].read().decode()
        all_events += [json.loads(l) for l in raw.strip().splitlines() if l.strip()]
    except Exception:
        pass
    # Also read old login log for history
    try:
        s3 = boto3.client("s3")
        old_key = "ajayshankar/trustscan_login_log/login_events.jsonl"
        raw = s3.get_object(Bucket=bucket, Key=old_key)["Body"].read().decode()
        for l in raw.strip().splitlines():
            if l.strip():
                e = json.loads(l)
                e.setdefault("type", "login")
                e.setdefault("status", "success")
                all_events.append(e)
    except Exception:
        pass
    if type:
        all_events = [e for e in all_events if e.get("type") == type]
    all_events.sort(key=lambda e: e.get("timestamp", ""), reverse=True)
    return JSONResponse({"events": all_events, "total": len(all_events)})


@app.get("/api/activity-summary")
def activity_summary(request: Request):
    """Per-user rollup of logins and searches from the audit log:
    logins (success / denied / errors), searches (success / errors / rate-limited),
    and first/last-seen timestamps. Failed logins with no identified email are
    grouped under "unknown"."""
    import boto3
    bucket = os.getenv("S3_BUCKET", "rzp-1415-prod-general-purpose-analytics")
    events = []
    try:
        s3 = boto3.client("s3", region_name="ap-south-1")
        raw = s3.get_object(Bucket=bucket, Key=AUDIT_LOG_KEY)["Body"].read().decode()
        events = [json.loads(l) for l in raw.strip().splitlines() if l.strip()]
    except Exception:
        pass

    users: dict = {}
    def rec(email):
        key = (email or "unknown").lower()
        return users.setdefault(key, {
            "email": key, "name": "",
            "logins_success": 0, "logins_denied": 0, "login_errors": 0,
            "searches": 0, "search_errors": 0, "rate_limited": 0,
            "first_seen": "", "last_seen": "", "last_login": "", "last_search": "",
        })

    for e in events:
        ts = e.get("timestamp", "")
        etype, status, email = e.get("type"), e.get("status"), e.get("email")
        r = rec(email)
        if e.get("name") and not r["name"]:
            r["name"] = e["name"]
        if etype == "login":
            if status == "success":
                r["logins_success"] += 1
                if ts > r["last_login"]: r["last_login"] = ts
            elif status == "access_denied":
                r["logins_denied"] += 1
            else:
                r["login_errors"] += 1
        elif etype == "scan":
            if status == "success":
                r["searches"] += 1
                if ts > r["last_search"]: r["last_search"] = ts
            elif status == "rate_limited":
                r["rate_limited"] += 1
            else:
                r["search_errors"] += 1
        else:
            continue
        if ts:
            r["first_seen"] = min(r["first_seen"] or ts, ts)
            if ts > r["last_seen"]: r["last_seen"] = ts

    out = sorted(users.values(), key=lambda u: u["last_seen"], reverse=True)
    totals = {
        "users": len(out),
        "logins_success": sum(u["logins_success"] for u in out),
        "logins_denied":  sum(u["logins_denied"]  for u in out),
        "searches":       sum(u["searches"]        for u in out),
        "rate_limited":   sum(u["rate_limited"]    for u in out),
        "events":         len(events),
    }
    return JSONResponse({"totals": totals, "users": out})


# ── Admin: who am I + access management ────────────────────────────────────────
@app.get("/api/whoami")
def whoami(request: Request):
    email = getattr(request.state, "user_email", None)
    return JSONResponse({"email": email, "is_admin": is_admin(email)})

@app.get("/api/admin/users")
def admin_list_users(request: Request):
    if not is_admin(getattr(request.state, "user_email", None)):
        raise HTTPException(status_code=403, detail="Admins only")
    allow = get_allowlist(force=True)
    users = [{"email": e, "is_admin": e in ADMIN_EMAILS} for e in sorted(allow)]
    return JSONResponse({"users": users, "total": len(users)})

@app.post("/api/admin/users")
async def admin_add_users(request: Request):
    actor = getattr(request.state, "user_email", None)
    if not is_admin(actor):
        raise HTTPException(status_code=403, detail="Admins only")
    try:
        body = await request.json()
    except Exception:
        body = {}
    raw = body.get("emails") or ([body["email"]] if body.get("email") else [])
    valid, invalid = [], []
    for e in raw:
        e = (e or "").strip().lower()
        if re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", e):
            valid.append(e)
        elif e:
            invalid.append(e)
    if not valid:
        raise HTTPException(status_code=400, detail="No valid email addresses provided")
    users = _mutate_allowlist(add=valid, updated_by=actor)
    _audit({"type": "admin", "status": "add_users", "email": actor, "added": valid})
    return JSONResponse({"ok": True, "added": valid, "invalid": invalid, "total": len(users)})

@app.delete("/api/admin/users")
async def admin_remove_user(request: Request):
    actor = getattr(request.state, "user_email", None)
    if not is_admin(actor):
        raise HTTPException(status_code=403, detail="Admins only")
    try:
        body = await request.json()
    except Exception:
        body = {}
    target = (body.get("email") or "").strip().lower()
    if not target:
        raise HTTPException(status_code=400, detail="email required")
    if target in ADMIN_EMAILS:
        raise HTTPException(status_code=400, detail="Cannot remove an admin")
    users = _mutate_allowlist(remove=[target], updated_by=actor)
    _audit({"type": "admin", "status": "remove_user", "email": actor, "removed": target})
    return JSONResponse({"ok": True, "removed": target, "total": len(users)})


@app.get("/signin")
def signin_page():
    return HTMLResponse(_LOGIN_HTML)


# ── Data Config ───────────────────────────────────────────────────────────────
_REPO_DATA_CSV = Path("/tmp/repo/data/trustscan_sample.csv")
S3_BUCKET = os.getenv("S3_BUCKET", "rzp-1415-prod-general-purpose-analytics")
S3_PREFIX = os.getenv("S3_PREFIX", "ajayshankar/trustscan_sample/")

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

_DATA: dict = {}
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
    global _DATA
    if _REPO_DATA_CSV.exists():
        try:
            with open(_REPO_DATA_CSV, newline="") as f:
                _DATA = _load_csv_file(f, str(_REPO_DATA_CSV))
            return
        except Exception as e:
            logger.warning(f"Failed to load local CSV ({_REPO_DATA_CSV}): {e}")

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


load_data()
load_de_data()


# ── Live API Config ────────────────────────────────────────────────────────────
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


def _razorpay_request(url: str, payload: dict, auth: str) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        url, data=data,
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


# ── TS 2.0 attributes ──────────────────────────────────────────────────────────
_TS2_SCAN_ATTRS = [
    "dpd_30_prob_band", "dpd_90_prob_band", "cd_dpd_30_prob_band",
    "thick_thin_data", "yearly_transaction_volume", "yoy_growth_percentage",
    "error_ratio_card", "error_ratio_last_12_weeks_emandate", "error_ratio_last_24_weeks_emandate",
    "failed_txn_amount_sum", "failed_txn_count", "repayment_error_ratio_l12w",
    "risky_fails_to_success_trxn_ratio_l12m", "risky_fails_to_success_trxn_ratio_l6m",
    "success_rate_last_24_weeks_card", "success_rate_last_24_weeks_emandate",
    "weighted_error_ratio", "weighted_error_ratio_last_12_weeks", "weighted_error_ratio_last_24_weeks",
    "weighted_success_rate",
    "avg_amount", "has_failed_high_value_txn",
    "l12m_aov_astrology", "l12m_aov_real_estate", "l12m_spend_astrology", "l12m_spend_micro_drama",
    "l3m_aov_astrology", "l3m_spend_astrology", "l3m_spend_micro_drama",
    "log_aov_gold", "log_aov_last_12_weeks_ecommerce", "log_aov_last_12_weeks_services",
    "log_aov_last_12_weeks_utilities", "log_aov_last_24_weeks_ecommerce", "log_aov_last_24_weeks_utilities",
    "log_aov_utilities", "luxury_category_spend", "ott_trxns_last_1_year",
    "perc_non_discretionary_spends", "predicted_income_bucket",
    "spend_last_12_weeks_lending", "spend_last_1_year_fashion_and_lifestyle",
    "spend_last_1_year_government", "spend_last_1_year_lending", "spend_last_1_year_tours_and_travel",
    "spend_last_24_weeks_lending", "total_spend_last_12_weeks", "upi_payment_amount",
    "vintage_education", "vintage_investments", "vintage_services", "vintage_utilities",
    "weighted_log_aov",
    "max_vintage", "unique_city_transacted", "unique_state_transacted",
    "count_issuer_cc", "loan_stacking_amount_l3m", "loan_stacking_amount_l6m",
    "unique_lenders_last_1_years",
]


def _extract_ts1_band(body: dict) -> str:
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
    if val is None:
        return ""
    if isinstance(val, dict):
        return str(val.get("band") or val.get("value") or val.get("code") or "")
    return str(val)


def _live_scan(phone: str) -> dict:
    sha = hashlib.sha256(phone.encode()).hexdigest()
    ts1_result = _razorpay_request(
        "https://api.razorpay.com/v1/trust_scan",
        {"customer": {"contact": phone}},
        _LIVE_CONFIG["ts1_auth"],
    )
    ts1_band = ""
    if ts1_result["status"] == 200:
        ts1_band = _extract_ts1_band(ts1_result["body"])
    elif ts1_result["status"] == 404:
        pass
    else:
        raise HTTPException(status_code=ts1_result["status"], detail=ts1_result["body"])

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

    return {
        "phone": phone, "source": "live", "ts1_band": ts1_band,
        "dpd30_band": dpd30_prob, "dpd90_band": dpd90_prob, "cd_band": cd_prob,
        "dpd30_prob_band": dpd30_prob, "dpd90_prob_band": dpd90_prob, "cd_prob_band": cd_prob,
        "predicted_income_bucket": raw_attrs.get("predicted_income_bucket", ""),
        "predicted_income": "", "thick_thin_data": raw_attrs.get("thick_thin_data", ""),
        "cohort": "", "dpd_date": as_of or "", "cd_date": as_of or "",
        "dpd30_credit_score": "", "dpd90_credit_score": "", "cd_credit_score": "",
        "dpd30_probability": "", "dpd90_probability": "", "cd_probability": "",
        "bands_dpd30_band": dpd30_prob, "bands_dpd90_band": dpd90_prob, "bands_cd_band": cd_prob,
        "bands_income_bucket": raw_attrs.get("predicted_income_bucket", ""),
        "model_version": "live", "live_attrs": raw_attrs, "de_variables": None,
    }


# ── Pydantic models ────────────────────────────────────────────────────────────
class LiveSetupRequest(BaseModel):
    ts1_auth: str
    ts2_auth: str

class Ts1LiveRequest(BaseModel):
    contact: str

class Ts2LiveRequest(BaseModel):
    sha256: str
    attributes: List[str]


# ── API endpoints ──────────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {
        "ok": True,
        "setup": "complete" if _live_configured() else "required",
        "ts1_auth_set": bool(_LIVE_CONFIG.get("ts1_auth")),
        "ts2_auth_set": bool(_LIVE_CONFIG.get("ts2_auth")),
    }

@app.get("/health")
def health_check():
    return {"status": "healthy", "contacts_loaded": len(_DATA)}


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


@app.post("/api/ts1")
def ts1(body: Ts1LiveRequest, request: Request):
    email = getattr(request.state, "user_email", "unknown")
    masked = body.contact[:3] + "XXXXXXX" if len(body.contact) >= 3 else body.contact
    logger.info(f"[SCAN_TS1] {email} | {masked}")
    _, device, access, _ = _req_meta(request)
    allowed, count, limit = _search_quota(do_increment=True)
    if not allowed:
        logger.info(f"[RATE_LIMITED] {email} | global daily limit {limit} reached (count={count})")
        _audit({"type": "scan", "status": "rate_limited", "email": email,
                "phone": masked, "device": device, "access": access,
                "count": count, "limit": limit})
        return _rate_limit_response(limit)
    try:
        result = live_ts1(body)
        _audit({"type": "scan", "status": "success", "email": email,
                "phone": masked, "device": device, "access": access,
                "count": count, "limit": limit})
        return result
    except Exception as e:
        _audit({"type": "scan", "status": "error", "email": email,
                "phone": masked, "device": device, "access": access, "reason": str(e)})
        raise

@app.post("/api/ts2")
def ts2(body: Ts2LiveRequest, request: Request):
    email = getattr(request.state, "user_email", "unknown")
    _, device, access, _ = _req_meta(request)
    allowed, _count, limit = _search_quota(do_increment=False)
    if not allowed:
        return _rate_limit_response(limit)
    try:
        result = live_ts2(body)
        _audit({"type": "scan", "status": "success", "email": email,
                "phone": "sha256:" + body.sha256[:8] + "…", "device": device, "access": access})
        return result
    except Exception as e:
        _audit({"type": "scan", "status": "error", "email": email,
                "phone": "sha256:" + body.sha256[:8] + "…", "device": device, "access": access, "reason": str(e)})
        raise


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

    CHUNK = 40
    chunks = [attrs[i:i+CHUNK] for i in range(0, len(attrs), CHUNK)]
    merged_attrs: dict = {}
    as_of = None
    for chunk in chunks:
        result = _razorpay_request(
            "https://api.razorpay.com/v2/engage/trust_scan",
            {"customer_identifier": {"type": "SHA256_PHONE", "value": sha}, "attributes": chunk},
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


@app.get("/api/live/health")
def live_health():
    return {
        "ok": True,
        "setup": "complete" if _live_configured() else "required",
        "ts1_auth_set": bool(_LIVE_CONFIG.get("ts1_auth")),
        "ts2_auth_set": bool(_LIVE_CONFIG.get("ts2_auth")),
    }


@app.get("/api/trust-scan/{phone}")
def trust_scan(phone: str):
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")
    record = _DATA.get(phone)
    if not record:
        raise HTTPException(status_code=404, detail="No data found for this phone number")
    return {
        "phone": phone,
        "dpd30_band": record["exact_dpd30_band"], "dpd90_band": record["exact_dpd90_band"],
        "dpd30_credit_score": record["dpd30_credit_score"], "dpd90_credit_score": record["dpd90_credit_score"],
        "dpd30_probability": record["dpd30_default_probability"], "dpd90_probability": record["dpd90_default_probability"],
        "dpd_date": record["dpd_date"], "cd_band": record["exact_cd_band"],
        "predicted_income": record["predicted_income"], "predicted_income_bucket": record["exact_income_bucket"],
        "cd_credit_score": record["cd_credit_score"], "cd_probability": record["cd_default_probability"],
        "cohort": record["cohort"], "cd_date": record["cd_date"],
        "bands_dpd30_band": record["bands_dpd30_band"], "bands_dpd90_band": record["bands_dpd90_band"],
        "bands_cd_band": record["bands_cd_band"], "bands_income_bucket": record["bands_income_bucket"],
        "dpd30_prob_band": record["dpd_30_prob_band"], "dpd90_prob_band": record["dpd_90_prob_band"],
        "cd_prob_band": record["cd_dpd_30_prob_band"], "thick_thin_data": record["thick_thin_data"],
        "model_version": record["model_version"], "ts1_band": record.get("ts1_band", ""),
        "de_variables": _DE_DATA.get(phone),
    }


@app.get("/api/scan/{phone}")
def unified_scan(phone: str):
    if not phone.isdigit() or len(phone) != 10:
        raise HTTPException(status_code=400, detail="Phone must be a 10-digit number")
    if _live_configured():
        return _live_scan(phone)
    record = _DATA.get(phone)
    if not record:
        raise HTTPException(status_code=404, detail="No data found for this phone number")
    return {
        "phone": phone, "source": "csv",
        "dpd30_band": record["exact_dpd30_band"], "dpd90_band": record["exact_dpd90_band"],
        "dpd30_credit_score": record["dpd30_credit_score"], "dpd90_credit_score": record["dpd90_credit_score"],
        "dpd30_probability": record["dpd30_default_probability"], "dpd90_probability": record["dpd90_default_probability"],
        "dpd_date": record["dpd_date"], "cd_band": record["exact_cd_band"],
        "predicted_income": record["predicted_income"], "predicted_income_bucket": record["exact_income_bucket"],
        "cd_credit_score": record["cd_credit_score"], "cd_probability": record["cd_default_probability"],
        "cohort": record["cohort"], "cd_date": record["cd_date"],
        "bands_dpd30_band": record["bands_dpd30_band"], "bands_dpd90_band": record["bands_dpd90_band"],
        "bands_cd_band": record["bands_cd_band"], "bands_income_bucket": record["bands_income_bucket"],
        "dpd30_prob_band": record["dpd_30_prob_band"], "dpd90_prob_band": record["dpd_90_prob_band"],
        "cd_prob_band": record["cd_dpd_30_prob_band"], "thick_thin_data": record["thick_thin_data"],
        "model_version": record["model_version"], "ts1_band": record.get("ts1_band", ""),
        "de_variables": _DE_DATA.get(phone),
    }


# ── Serve frontend SPA ─────────────────────────────────────────────────────────
_REPO_ROOT = Path(__file__).parent
_BUILD_DIR  = _REPO_ROOT / "frontend" / "build"

if _BUILD_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_BUILD_DIR / "static")), name="static")

    @app.get("/{full_path:path}")
    def serve_spa(full_path: str):
        # /signin is handled above; everything else serves the SPA
        return FileResponse(str(_BUILD_DIR / "index.html"))
else:
    @app.get("/")
    def root():
        return {"message": "TrustScan API running. Frontend build not found."}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8501"))
    uvicorn.run(app, host="0.0.0.0", port=port)
