# Media Network Dashboard — Deployment Guide

Operational guide for the **Razorpay Media Network Dashboard** (the rebuilt 3P
Apps Script dashboard). FastAPI backend + React frontend, deployed on the
`dev-serve` EKS cluster in the `analytics-tools` namespace.

- **Live URL:** https://3p-media-dashboard-analytics.dev.razorpay.in/
- **Repo:** `github.com/ajayshankar96/ads_analytics` → `media-dashboard/`
- **Cluster / namespace:** `dev-serve` / `analytics-tools`
- **Deployment:** `media-dashboard`

---

## 🏗️ Architecture

There is **no Docker build**. The pod runs a stock `python:3.11-slim` image and,
on startup, **git-clones this repo**, installs backend deps, and runs uvicorn.
FastAPI serves the **pre-built React bundle** from `backend/static/`.

Pod startup command (`kubernetes/deployment.yaml`):

```bash
apt-get update -qq && apt-get install -y -qq git &&
git clone --depth 1 https://github.com/ajayshankar96/ads_analytics.git /app &&
cd /app/media-dashboard/backend &&
pip install --no-cache-dir -q -r requirements.txt &&
uvicorn main:app --host 0.0.0.0 --port 8000
```

Implication: **deploying = pushing to `main` + restarting the pod** (so it
re-clones). The committed `backend/static/` is what's served, so the frontend
**must be built and committed** as part of any frontend change.

---

## 🚀 Deploy a change

```bash
# 1. (frontend changes only) build the React app and copy it into backend/static
cd media-dashboard/frontend
npm run build
cd ..
rm -rf backend/static && cp -r frontend/build backend/static

# 2. commit + push (backend and/or static)
git add media-dashboard/backend media-dashboard/frontend
git commit -m "…"
git push origin main

# 3. restart the pod so it re-clones the latest code
kubectl rollout restart deployment/media-dashboard -n analytics-tools --context dev-serve
kubectl rollout status  deployment/media-dashboard -n analytics-tools --context dev-serve
```

> Backend-only changes still need the rollout restart (the pod only clones on
> startup). Frontend changes additionally need `npm run build` + copying to
> `backend/static/` before committing.

After deploy, **hard-refresh** the browser — `index.html` references a hashed
bundle (`main.<hash>.js`) that changes every build.

---

## 🔐 Google authentication

The backend authenticates to Google APIs with an **OAuth2 user token** stored
in the `media-dashboard-secrets` secret under `OAUTH_TOKEN_JSON_CONTENT`. It
runs as whichever Google account generated that token.

**Required scopes:**

| Scope | Used for |
|-------|----------|
| `…/auth/spreadsheets` | Read dashboard data; read/write owned sheets |
| `…/auth/drive` | Reports folder, view-tracking sheet, sharing |
| `…/auth/gmail.send` | (server-side fallback) sending campaign emails |

### Re-generating the token (add scopes / rotate / change account)

A token can't gain new scopes by refresh — you must re-consent in a browser.
Use the helper (reuses the existing client credentials):

```bash
cd media-dashboard/backend

# 1. pull current token
kubectl get secret media-dashboard-secrets -n analytics-tools --context dev-serve \
  -o jsonpath='{.data.OAUTH_TOKEN_JSON_CONTENT}' | base64 -d > current_token.json

# 2. re-auth (opens browser; approve ALL requested permissions)
python3 generate_oauth_token.py current_token.json   # writes new_oauth_token.json

# 3. write it back (use `replace`, NOT `patch` — patch is RBAC-blocked here)
kubectl get secret media-dashboard-secrets -n analytics-tools --context dev-serve -o json \
| python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
with open('new_oauth_token.json','rb') as f:
    d['data']['OAUTH_TOKEN_JSON_CONTENT'] = base64.b64encode(f.read()).decode()
d['metadata'].get('annotations', {}).pop('kubectl.kubernetes.io/last-applied-configuration', None)
d['metadata'].pop('managedFields', None); d['metadata'].pop('creationTimestamp', None)
print(json.dumps(d))
" | kubectl replace -f -

# 4. restart the pod to load the new token, then delete the local token files
kubectl rollout restart deployment/media-dashboard -n analytics-tools --context dev-serve
rm -f current_token.json new_oauth_token.json   # contain credentials — never commit
```

> ⚠️ Sheets the token account only has **view** access to cannot be written.
> Campaign onboarding writes to the KPI/Automation Tracker sheet, so that
> account needs **Editor** access there (see below).

---

## 📄 Spreadsheets & Drive

| Purpose | ID / location | Access needed | Set via |
|---------|---------------|---------------|---------|
| Dashboard data (read) | `1yvcrWEvWauUOOGJrN5votRlOP-kCaSrOKeh-YvjKjfI` — `Master_Report` | read | `MASTER_SPREADSHEET_ID` |
| Campaign onboarding | `1VDr2ewZw2Xl43PuYBoKt8PgepItHZs-icD49YnILBss` ("Automation Tracker", `Sheet1`) | **edit** | `KPI_SPREADSHEET_ID` |
| View-tracking stats | "Media Dashboard - View Tracking" (auto-created, owned by the token account) | owner | auto |
| Advertiser/Publisher reports | "Media Dashboard - Reports" Drive folder (auto-created) | owner | auto |

Legacy reports (created via the old Apps Script) remain owned by their original
creator; the dashboard lists them read-only from the KPI registry (hybrid list).

---

## 📧 Campaign email (per-user sending)

Campaign emails are sent **client-side from the signed-in user's own Gmail**
via Google Identity Services — the token stays in the browser (no server-side
storage). Requirements:

- A GCP **OAuth "Web application" client**; its ID is hard-coded in
  `frontend/src/components/CampaignOnboarding.jsx` as `GOOGLE_WEB_CLIENT_ID`.
  The app domain must be an **Authorized JavaScript origin** on that client.
- The **Gmail API must be enabled** in the GCP project (`38441679546`).
- If `GOOGLE_WEB_CLIENT_ID` is empty, it falls back to server-side sending from
  the token account (needs `gmail.send` scope).

---

## ⚙️ Config & secrets

- **ConfigMap** `media-dashboard-config` — `MASTER_SPREADSHEET_ID`,
  `KPI_SPREADSHEET_ID`, `S3_*`/Trino vars, `CACHE_REFRESH_INTERVAL`, etc.
- **Secret** `media-dashboard-secrets` — `OAUTH_TOKEN_JSON_CONTENT` (+ any other
  credentials). Update with `kubectl replace` (not `patch`).

The master report is cached in memory and refreshed every
`CACHE_REFRESH_INTERVAL` seconds (default 300). Force a refresh via
`POST /api/cache/refresh` or the "Refresh Cache" button in the header.

---

## 🩺 Common operations & troubleshooting

```bash
# Pod status / logs
kubectl get pods -n analytics-tools --context dev-serve -l app=media-dashboard
kubectl logs -n analytics-tools --context dev-serve deployment/media-dashboard --tail=100

# Health
curl https://3p-media-dashboard-analytics.dev.razorpay.in/health
```

| Symptom | Likely cause / fix |
|---------|--------------------|
| `403 … caller does not have permission` on a sheet write | Token account lacks **Editor** on that spreadsheet — share it as Editor |
| View stats stuck at 0 / report list empty | View-tracking sheet / reports folder not created — check startup logs; ensure `drive` scope on the token |
| Email sends but body empty | (fixed) was a MIME header/body separator bug — ensure latest bundle is deployed |
| `Gmail API has not been used in project …` | Enable the Gmail API in GCP project `38441679546` |
| Pod `Running` but `0/1` for a while | Normal — startup runs apt-get + git clone + pip install before readiness |

---

## 📞 Owner

**Ajay Shankar** — ajay.shankar@razorpay.com
