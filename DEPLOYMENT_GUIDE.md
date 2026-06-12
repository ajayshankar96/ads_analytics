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
| Auth | Google OAuth + email allowlist (`ALLOWED_EMAILS`) |

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
| `ALLOWED_EMAILS` | inline | Comma-separated OAuth allowlist (see §4) |
| `GOOGLE_CLIENT_ID` | inline | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | inline | 🔒 OAuth client secret — **do not expose / commit** |
| `SESSION_SECRET` | inline | 🔒 Session-cookie signing key — **do not expose / commit** |
| `GOOGLE_REDIRECT_URI` | inline | Default OAuth callback (app also derives it per originating host) |
| `TS1_AUTH` / `TS2_AUTH` | inline | 🔒 Basic-auth credentials for the TrustScan 1.0 / 2.0 APIs — **do not expose / commit** |

> **Security note:** the four 🔒 values are currently stored as plaintext
> inline env on the deployment. They should ideally be moved into the
> `trustscan-secrets` Secret. Regardless, **never paste their values into this
> repo, logs, or screenshots.**

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

Access is gated by Google OAuth **and** the `ALLOWED_EMAILS` allowlist
(`trustscan_app.py` rejects any authenticated email not in the set). The
allowlist lives in the deployment's inline env, so update it with
`kubectl set env` (this triggers a rollout):

```bash
# Pass the FULL comma-separated list (it replaces the existing value)
kubectl set env deployment/trustscan-analytics -n analytics-tools \
  ALLOWED_EMAILS="ajay.shankar@razorpay.com,dhruv.goel@razorpay.com,narahari.bhat@razorpay.com,pranav.t@razorpay.com,amal.shaji@razorpay.com,ajayshankar1996@gmail.com,nithin.r@razorpay.com,maneesha.nair@razorpay.com,debasree.choudhury@razorpay.com"
```

Verify:

```bash
kubectl get deploy trustscan-analytics -n analytics-tools \
  -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="ALLOWED_EMAILS")].value}' \
  | tr ',' '\n'
```

A user who authenticates but isn't on the list gets a 403 (not on allowlist).

---

## 5️⃣ Mobile vs desktop UI

The frontend serves **one** `index.html`. It detects mobile via
`navigator.userAgent`:

- **Mobile** browsers get a dedicated full-screen flow (Home → Scanning →
  Spotlight results with Bands / Credit / Signals tabs).
- **Desktop** browsers get the original 2-column report — unchanged.

Both hit the same backend (`/api/ts1`, `/api/ts2`) and share the same data
helpers. There is no separate mobile URL or build.

---

## 6️⃣ Verify a deployment

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
