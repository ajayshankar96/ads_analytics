"""
Google OAuth + email-allowlist access gate for media-dashboard.

Ported from the repo's reference implementation (trustscan_app.py). Behaviour:
  * If GOOGLE_CLIENT_ID is unset, the gate is DISABLED (app stays open) — so the
    code can be deployed safely before the OAuth client exists. Setting
    GOOGLE_CLIENT_ID (+ secret) turns enforcement on.
  * When enabled, every request needs a signed session cookie whose email is in
    ALLOWED_EMAILS; otherwise browser requests redirect to Google login and
    /api/* requests get 401.

Required env to enable:
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, SESSION_SECRET,
  ALLOWED_EMAILS (comma-separated; defaults to ajay.shankar@razorpay.com).
"""

import json
import logging
import os
import secrets
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
GOOGLE_REDIRECT_URI = os.getenv(
    "GOOGLE_REDIRECT_URI",
    "https://3p-media-dashboard-analytics.dev.razorpay.in/auth/callback",
)
SESSION_SECRET = os.getenv("SESSION_SECRET", secrets.token_hex(32))
SESSION_HOURS = 8
COOKIE_NAME = "md_session"
COOKIE_DOMAIN = os.getenv("SESSION_COOKIE_DOMAIN", ".dev.razorpay.in")

ALLOWED_EMAILS = set(
    e.strip().lower()
    for e in os.getenv("ALLOWED_EMAILS", "ajay.shankar@razorpay.com").split(",")
    if e.strip()
)

_AUTH_SKIP = {
    "/auth/login", "/auth/callback", "/auth/logout", "/signin",
    "/health", "/favicon.ico", "/favicon.svg",
}

# In-memory CSRF state store: { state_token -> {ts, host, redirect_uri} }
_OAUTH_STATES: dict = {}


def auth_enabled() -> bool:
    return bool(GOOGLE_CLIENT_ID)


def _make_session(email: str) -> str:
    return URLSafeTimedSerializer(SESSION_SECRET).dumps({"email": email})


def _verify_session(token: str):
    if not token:
        return None
    try:
        data = URLSafeTimedSerializer(SESSION_SECRET).loads(token, max_age=SESSION_HOURS * 3600)
        return data.get("email")
    except (BadSignature, SignatureExpired):
        return None


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Gate disabled until an OAuth client is configured — fail open so the
        # app never locks itself out before setup is complete.
        if not auth_enabled():
            return await call_next(request)

        path = request.url.path
        if path in _AUTH_SKIP or path.startswith("/static/"):
            return await call_next(request)

        email = _verify_session(request.cookies.get(COOKIE_NAME))
        if not email:
            if path.startswith("/api/"):
                return JSONResponse(
                    status_code=401,
                    content={"error": "Authentication required", "login": "/auth/login"},
                )
            return RedirectResponse(url="/auth/login")

        request.state.user_email = email
        return await call_next(request)


_SIGNIN_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Media Dashboard · Sign in</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F4F8FE;
 display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{background:#fff;border-radius:16px;padding:48px 40px;text-align:center;
 box-shadow:0 4px 24px rgba(1,38,82,.10);max-width:400px;width:100%}
h1{font-size:22px;font-weight:700;color:#0A1929;margin-bottom:8px}
p{font-size:13.5px;color:#52606D;line-height:1.55;margin-bottom:32px}
a.btn{display:inline-flex;align-items:center;gap:10px;background:#2563eb;color:#fff;
 font-size:14px;font-weight:600;padding:13px 24px;border-radius:10px;text-decoration:none}
a.btn img{width:20px;height:20px;background:#fff;border-radius:3px;padding:2px}
.footer{margin-top:28px;font-size:11.5px;color:#9AA5B1}
</style></head>
<body><div class="card">
<h1>RMN · Media Dashboard</h1>
<p>Sign in with your Razorpay Google account to continue.</p>
<a class="btn" href="/auth/login"><img src="https://www.google.com/favicon.ico" alt="G"/>Sign in with Google</a>
<div class="footer">Access restricted to allow-listed accounts</div>
</div></body></html>"""


router = APIRouter()


@router.get("/signin", include_in_schema=False)
def signin():
    return HTMLResponse(_SIGNIN_HTML)


@router.get("/auth/login", include_in_schema=False)
def auth_login(request: Request):
    state = secrets.token_urlsafe(32)
    originating_host = (
        request.headers.get("x-forwarded-host")
        or request.url.hostname
        or "3p-media-dashboard-analytics.dev.razorpay.in"
    )
    scheme = "https" if "ext" not in originating_host else "http"
    dynamic_redirect_uri = f"{scheme}://{originating_host}/auth/callback"
    _OAUTH_STATES[state] = {"ts": time.time(), "host": originating_host, "redirect_uri": dynamic_redirect_uri}
    for k in list(_OAUTH_STATES):
        if time.time() - _OAUTH_STATES[k]["ts"] > 900:
            del _OAUTH_STATES[k]

    params = urllib.parse.urlencode({
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": dynamic_redirect_uri,
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "access_type": "online",
        "prompt": "select_account",
    })
    return RedirectResponse(url=f"https://accounts.google.com/o/oauth2/v2/auth?{params}", status_code=302)


@router.get("/auth/callback", include_in_schema=False)
def auth_callback(request: Request, code: str = None, state: str = None, error: str = None):
    if error:
        return HTMLResponse(f"<h1>Access denied</h1><p>{error}</p>", status_code=403)

    stored = _OAUTH_STATES.pop(state or "", None)
    if not stored or time.time() - stored["ts"] > 900:
        return HTMLResponse(
            "<h1>Invalid or expired session state.</h1><p><a href='/auth/login'>Sign in</a></p>",
            status_code=400,
        )
    originating_host = stored["host"]
    dynamic_redirect_uri = stored["redirect_uri"]

    token_payload = urllib.parse.urlencode({
        "code": code,
        "client_id": GOOGLE_CLIENT_ID,
        "client_secret": GOOGLE_CLIENT_SECRET,
        "redirect_uri": dynamic_redirect_uri,
        "grant_type": "authorization_code",
    }).encode()
    try:
        req = urllib.request.Request(
            "https://oauth2.googleapis.com/token", data=token_payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST",
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            token_resp = json.loads(r.read().decode())
    except Exception as e:
        logger.error(f"[OAUTH_TOKEN_ERROR] {e}")
        return HTMLResponse(f"<h1>Token exchange failed</h1><p>{e}</p>", status_code=500)

    access_token = token_resp.get("access_token")
    if not access_token:
        return HTMLResponse("<h1>No access token received from Google.</h1>", status_code=500)

    try:
        ui_req = urllib.request.Request(
            "https://www.googleapis.com/oauth2/v3/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        with urllib.request.urlopen(ui_req, timeout=10) as r:
            userinfo = json.loads(r.read().decode())
    except Exception as e:
        logger.error(f"[OAUTH_USERINFO_ERROR] {e}")
        return HTMLResponse(f"<h1>Failed to get user info</h1><p>{e}</p>", status_code=500)

    email = userinfo.get("email", "").lower().strip()
    name = userinfo.get("name", email)

    if email not in ALLOWED_EMAILS:
        logger.warning(f"[ACCESS_DENIED] {email}")
        return HTMLResponse(
            f"<!doctype html><html><body style='font-family:sans-serif;text-align:center;padding:60px'>"
            f"<h1 style='color:#B42318'>Access Denied</h1>"
            f"<p><strong>{email}</strong> is not authorised to use this app.</p>"
            f"<p>Contact ajay.shankar@razorpay.com to request access.</p></body></html>",
            status_code=403,
        )

    logger.info(f"[LOGIN] {email} | {name}")
    resp = RedirectResponse(url=f"{('https' if 'ext' not in originating_host else 'http')}://{originating_host}/", status_code=302)
    resp.set_cookie(
        COOKIE_NAME, _make_session(email),
        httponly=True, samesite="lax", domain=COOKIE_DOMAIN,
        max_age=SESSION_HOURS * 3600,
    )
    return resp


@router.get("/auth/logout", include_in_schema=False)
def auth_logout():
    resp = RedirectResponse(url="/signin", status_code=302)
    resp.delete_cookie(COOKIE_NAME, domain=COOKIE_DOMAIN)
    return resp
