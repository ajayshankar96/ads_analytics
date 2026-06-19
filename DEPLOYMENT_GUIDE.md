# Deployment Guide — TrustScan App

How the TrustScan 2.0 sales-demo app is actually deployed and operated on
Razorpay's Kubernetes cluster.

> **Architecture in one line:** a single pod runs a stock `python:3.9-slim`
> image that, on boot, **clones this repo, installs deps, and runs
> `trustscan_app.py`** (a FastAPI app that serves both the API and the
> static frontend). There is **no Docker image build and no CI pipeline** —
> a deploy is just "update `main`, then restart the pod so it re-clones."

---

## 🎯 At a glance

| Thing | Value |
|---|---|
| Namespace | `analytics-tools` |
| Deployment | `trustscan-analytics` |
| Container name | `trustscan` |
| Base image | `c.rzp.io/proxy_dockerhub/library/python:3.9-slim` (stock Python) |
| App entrypoint | `trustscan_app.py` (FastAPI + Uvicorn) |
| Container port | `8501` |
| Source repo | `github.com/ajayshankar96/ads_analytics` (branch `main`) |
| Internal URL | https://trustscan-analytics.dev.razorpay.in |
| External URL | https://trustscan-analytics.ext.dev.razorpay.in |
| Auth | Google OAuth + email allowlist (S3-backed, admin-managed) |
| Admins | `ADMIN_EMAILS` (default `ajay.shankar`, `dhruv.goel`) — manage access + limit in-app (see §6) |
| Service account | `trustscan-poc-service-account` (IRSA role `dev-serve-trustscan-poc`) — grants S3 access |
| Search limit | Global daily cap (default 1000), admin-editable, persisted in S3 |

---

## 1️⃣ How the pod boots

The deployment's container `command` is a single bootstrap script:

```bash
apt-get update -qq && apt-get install -y -qq git \
  && git clone --depth=1 https://github.com/ajayshankar96/ads_analytics /tmp/repo \
  && pip install --no-cache-dir fastapi uvicorn boto3 python-dotenv itsdangerous \
  && python /tmp/repo/trustscan_app.py
```

Consequences worth remembering:

- **Every (re)start re-clones `main` from GitHub.** Whatever is on `main` is
  what runs. There is no image to rebuild.
- First boot takes ~1–2 min (apt + pip install). The liveness probe allows
  for this (`initialDelaySeconds: 120` on `GET /` at port 8501).
- `trustscan_app.py` serves the frontend with
  `FileResponse(frontend/build/index.html)` on the catch-all route, so the
  HTML is read from disk **on every request** (relevant for hot-fixes below).

---

## 2️⃣ Deploying a change (the normal flow)

```bash
# 1. Commit your change to the repo and push to main
git add <files>
git commit -m "..."
git push origin main

# 2. Restart the pod so it re-clones the updated main
kubectl rollout restart deployment/trustscan-analytics -n analytics-tools

# 3. Watch it come up (re-clone + pip install ≈ 1–2 min)
kubectl rollout status deployment/trustscan-analytics -n analytics-tools
```

> `main` is a protected branch; pushes from an account with bypass rights show
> a "Bypassed rule violations" notice — that's expected, the push still lands.

### Optional: emergency hot-fix without a restart

Because the app reads `index.html` from disk per request, you can patch a
**frontend-only** change into the running pod for an instant fix:

```bash
POD=$(kubectl get pods -n analytics-tools | grep trustscan-analytics | awk '{print $1}' | head -1)
kubectl cp frontend/build/index.html analytics-tools/$POD:/tmp/repo/frontend/build/index.html
```

⚠️ **This is temporary.** The next restart/reschedule re-clones `main` and
discards the patch. Always also commit the change to `main`.

---

## 3️⃣ Configuration & environment variables

Config comes from three places: a ConfigMap, a Secret, and inline env on the
deployment spec.

| Variable | Source | Purpose |
|---|---|---|
| `PORT` | inline | App listen port (`8501`) |
| `APP_ENV` | inline | `dev` |
| `TRINO_HOST` | ConfigMap `trustscan-config` | Trino coordinator host |
| `TRINO_PORT` / `TRINO_HTTP_SCHEME` / `TRINO_CATALOG` / `TRINO_SCHEMA` | ConfigMap / inline | Trino connection |
| `TRINO_USER` / `TRINO_PASSWORD` | **Secret** `trustscan-secrets` | Trino credentials |
| `S3_BUCKET` / `S3_PREFIX` | inline | Login/scan audit-log location |
| `DAILY_SEARCH_LIMIT` | inline | **Seed/fallback** for the admin-editable daily cap (default `1000`); live value lives in S3 — see §5 |
| `RATE_LIMIT_PREFIX` | inline | S3 prefix for the daily counter (default `TS_POC/search_counter/`) |
| `ALLOWED_EMAILS` | inline | **Seed/fallback** for the allowlist; live list lives in S3 and is admin-managed — see §4 |
| `ADMIN_EMAILS` | inline | Who can use the in-app admin panel (default `ajay.shankar@razorpay.com,dhruv.goel@razorpay.com`); see §6 |
| `GOOGLE_CLIENT_ID` | inline | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | inline | 🔒 OAuth client secret — **do not expose / commit** |
| `SESSION_SECRET` | inline | 🔒 Session-cookie signing key — **do not expose / commit** |
| `GOOGLE_REDIRECT_URI` | inline | Default OAuth callback (app also derives it per originating host) |
| `TS1_AUTH` / `TS2_AUTH` | inline | 🔒 Basic-auth credentials for the TrustScan 1.0 / 2.0 APIs — **do not expose / commit** |

> **Security note:** the four 🔒 values are currently stored as plaintext
> inline env on the deployment. They should ideally be moved into the
> `trustscan-secrets` Secret. Regardless, **never paste their values into this
> repo, logs, or screenshots.**

### S3 access (service account / IRSA)

The app needs S3 to read/write the daily search counter (§5), the audit log, and
the admin-managed config (the allowlist and the daily-limit value — see §4/§6).
Access is **not** via the EKS node role — that role has no S3 permissions. The
deployment must run under the **`trustscan-poc-service-account`** service
account, whose IRSA annotation maps it to IAM role `dev-serve-trustscan-poc`
(which is granted `s3:GetObject` / `s3:PutObject` on `TS_POC/*`).

```bash
# One-time: point the deployment at the IRSA service account (triggers a rollout)
kubectl patch deployment trustscan-analytics -n analytics-tools \
  -p '{"spec":{"template":{"spec":{"serviceAccountName":"trustscan-poc-service-account"}}}}'

# Verify the running pod assumes the role:
POD=$(kubectl get pods -n analytics-tools | grep trustscan-analytics | awk '{print $1}' | head -1)
kubectl exec -n analytics-tools $POD -- python3 -c \
  "import boto3; print(boto3.client('sts').get_caller_identity()['Arn'])"
# → .../assumed-role/dev-serve-trustscan-poc/...
```

> If the pod prints `dev-serve-worker-node` instead, it's on the node role and
> S3 calls will be `AccessDenied` — re-apply the `serviceAccountName` patch.
> The role currently lacks `s3:DeleteObject`, so counter/probe files can't be
> deleted by the app (harmless — daily counter files are tiny).

### Trino credentials (Secret)

```bash
kubectl create secret generic trustscan-secrets \
  --from-literal=TRINO_USER='<user>' \
  --from-literal=TRINO_PASSWORD='<password>' \
  -n analytics-tools --dry-run=client -o yaml | kubectl apply -f -
# Then restart so the pod picks it up:
kubectl rollout restart deployment/trustscan-analytics -n analytics-tools
```

---

## 4️⃣ Managing who can log in (allowlist)

Access is gated by Google OAuth **and** an email allowlist, which is an
**S3-backed, admin-editable store**:

- **Source of truth:** `s3://$S3_BUCKET/TS_POC/config/allowed_emails.json`.
- **Seeded** from the `ALLOWED_EMAILS` env var on first run (so nobody loses
  access), cached ~30 s in memory, and **falls back** to the env value if S3 is
  unreachable. Admins (§6) are always allowed, even if absent from the file.
- A user who authenticates but isn't allowed gets a **403**.

**Normal way to manage users:** the in-app **admin panel** (§6) — no redeploy.
Adds take effect immediately; removes take effect at the user's next sign-in
(an active session lasts up to 8 h).

**Fallback (no UI):** view or edit the S3 file directly. Note the env var only
*seeds* the file on first run — once `allowed_emails.json` exists, changing the
env var alone will **not** update the live list.

```bash
# View the live allowlist
POD=$(kubectl get pods -n analytics-tools | grep trustscan-analytics | awk '{print $1}' | head -1)
kubectl exec -n analytics-tools $POD -- python3 -c \
  "import boto3,os,json; print(boto3.client('s3','ap-south-1').get_object(Bucket=os.getenv('S3_BUCKET'),Key='TS_POC/config/allowed_emails.json')['Body'].read().decode())"
```

---

## 5️⃣ Daily search rate limit

The app enforces a **global** cap on searches per day (a "search" = one scan =
one `/api/ts1` call). It's defined in `trustscan_app.py`:

- `/api/ts1` checks the counter and **increments** it (once per scan); `/api/ts2`
  **checks only** (so a capped scan blocks fully and stops calling the upstream
  API, without double-counting ts2's chunked calls).
- The counter is persisted at
  `s3://$S3_BUCKET/TS_POC/search_counter/<YYYY-MM-DD>.json` (one file per day),
  so it **survives pod restarts** and **auto-resets at midnight IST**.
- Updates are lock-serialized and **fail open** on any S3 error — a transient S3
  issue never blocks scanning (but also won't enforce the cap while S3 is down).
- When the cap is hit, the API returns `429` and the UI shows
  *"Daily search limit reached … resets at midnight IST."*

> **Requires S3 access** — the deployment must run under
> `trustscan-poc-service-account` (see §3). Without it, every counter write is
> `AccessDenied`, the limiter fails open, and the cap is **not** enforced.

The **limit value** itself is admin-editable and stored at
`s3://$S3_BUCKET/TS_POC/config/rate_limit.json` (seeded from `DAILY_SEARCH_LIMIT`
on first run, env as fallback, cached ~30 s).

**Change the limit:** use the in-app **admin panel → Rate Limits** (§6) — it
applies live, no redeploy. The `DAILY_SEARCH_LIMIT` env var only *seeds* the S3
value on first run; once `rate_limit.json` exists, changing the env alone won't
update the live limit.

Check today's usage:

```bash
POD=$(kubectl get pods -n analytics-tools | grep trustscan-analytics | awk '{print $1}' | head -1)
kubectl exec -n analytics-tools $POD -- python3 -c \
  "import boto3,os,datetime,json; d=datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=5,minutes=30))).strftime('%Y-%m-%d'); \
   print(boto3.client('s3','ap-south-1').get_object(Bucket=os.getenv('S3_BUCKET'),Key=f'TS_POC/search_counter/{d}.json')['Body'].read().decode())"
```

---

## 6️⃣ Admin panel (in-app access & limit management)

Admins get a profile icon on the **desktop header** (top-right) that opens two
tools — so routine user and limit changes need **no redeploy or kubectl**.

- **Who's an admin:** anyone in `ADMIN_EMAILS` (default `ajay.shankar@razorpay.com`,
  `dhruv.goel@razorpay.com`). Admins are always on the allowlist. The icon and
  every admin endpoint are gated server-side — non-admins get `403`.
- **👥 User Roles** → view the live allowlist, add an email (instant access) or
  remove one (effective at next sign-in). Writes `allowed_emails.json` (§4).
- **⚙️ Rate Limits** → view today's usage and raise/lower the daily cap live.
  Writes `rate_limit.json` (§5).

> The icon is desktop-only today (not yet on the mobile nav).

Change the admin list (triggers a rollout):

```bash
kubectl set env deployment/trustscan-analytics -n analytics-tools \
  ADMIN_EMAILS="ajay.shankar@razorpay.com,dhruv.goel@razorpay.com"
```

**Endpoints** (all behind login; admin-only ones return `403` for non-admins):

| Method · Path | Purpose |
|---|---|
| `GET /api/whoami` | Current user + `is_admin` (frontend shows the icon if true) |
| `GET /api/admin/users` | List the allowlist (with admin flags) |
| `POST /api/admin/users` | Add — body `{"email": "..."}` or `{"emails": [...]}` |
| `DELETE /api/admin/users` | Remove — body `{"email": "..."}` (admins protected) |
| `GET /api/admin/rate-limit` | Current limit + used/remaining today |
| `POST /api/admin/rate-limit` | Set limit — body `{"daily_limit": N}` |

> **S3 config files** (under `TS_POC/config/`, require the IRSA SA — §3):
> `allowed_emails.json` (allowlist) · `rate_limit.json` (daily limit).

---

## 7️⃣ Mobile vs desktop UI

The frontend serves **one** `index.html`. It detects mobile via
`navigator.userAgent`:

- **Mobile** browsers get a dedicated full-screen flow (Home → Scanning →
  Spotlight results with Bands / Credit / Signals tabs).
- **Desktop** browsers get the original 2-column report — unchanged.

Both hit the same backend (`/api/ts1`, `/api/ts2`) and share the same data
helpers. There is no separate mobile URL or build.

---

## 8️⃣ Verify a deployment

```bash
# Pod should be Running with 0 restarts
kubectl get pods -n analytics-tools | grep trustscan-analytics

# Tail boot + request logs
kubectl logs -f deployment/trustscan-analytics -n analytics-tools

# Confirm the running code matches main (example: check a known marker)
POD=$(kubectl get pods -n analytics-tools | grep trustscan-analytics | awk '{print $1}' | head -1)
kubectl exec -n analytics-tools $POD -- head -1 /tmp/repo/frontend/build/index.html
```

For an end-to-end check, open the URL in a browser and log in with an
allowlisted Google account (curl can't get past OAuth). Use mobile-device
emulation in DevTools to verify the mobile UI.

---

## 🔧 Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Pod stuck `0/1` for ~2 min after restart | Normal — apt/pip install on boot. Wait for the liveness `initialDelaySeconds`. |
| `CrashLoopBackOff` | `kubectl logs` the pod; usually a Python error in `trustscan_app.py` or a missing env var. |
| Pod `Pending` | Insufficient cluster resources / node scheduling. `kubectl describe pod`. |
| Login loops or "redirect_uri mismatch" | The Google OAuth client must allow the callback for the host you're using (`…dev.razorpay.in/auth/callback` and the `…ext.dev…` variant). |
| Authenticated but blocked (403) | Email not in `ALLOWED_EMAILS` — see §4. |
| Trino errors | Check `trustscan-secrets` / `trustscan-config`; test from pod: `kubectl exec -it deployment/trustscan-analytics -n analytics-tools -- sh`. |
| Change pushed but not live | Did you `rollout restart`? The pod only re-clones on (re)start. |

```bash
# Roll back to the previous pod spec if a deploy goes bad
kubectl rollout undo deployment/trustscan-analytics -n analytics-tools
kubectl rollout history deployment/trustscan-analytics -n analytics-tools
```

> Note: `rollout undo` reverts the **deployment spec** (env, image, command).
> It does **not** revert the application code, since code comes from `main` at
> boot — to revert code, revert the commit on `main` and restart.

---

## 📊 Monitoring

```bash
kubectl logs -f deployment/trustscan-analytics -n analytics-tools   # logs
kubectl top pod -n analytics-tools                                  # CPU/memory
kubectl describe pod <pod> -n analytics-tools                       # events
```

Login and scan events are also written to S3 at
`s3://$S3_BUCKET/$S3_PREFIX` (audit log), subject to the pod's IAM
permissions.

---

## 🔐 Security checklist

1. **Never commit secrets** — OAuth secret, session key, and `TS1/TS2_AUTH`
   stay out of the repo, logs, and screenshots.
2. Prefer moving the 🔒 inline env values into the `trustscan-secrets` Secret.
3. Keep `ALLOWED_EMAILS` tight — it's the only thing between OAuth and the data.
4. Rotate Trino and API credentials periodically.
5. Keep ingress on the internal/dev domains; don't expose publicly without review.

---

## 📞 Support

- **Owner:** Ajay Shankar (ajay.shankar@razorpay.com)
- **Repo:** github.com/ajayshankar96/ads_analytics
- **Infra:** #devops / #platform
