# Deploying a New App on Kubernetes — Generic Recipe

A reusable, copy-paste recipe for hosting **any** lightweight internal app on
Razorpay's Kubernetes cluster using the same "git-clone-on-boot" pattern that
runs TrustScan (see `DEPLOYMENT_GUIDE.md` for the TrustScan specifics).

> **The pattern in one line:** run a stock language image (e.g.
> `python:3.9-slim` or `node:20-slim`) whose container `command` clones your
> repo, installs deps, and starts the app. **No Dockerfile, no image build, no
> CI** — deploys are "push to `main`, then restart the pod."

---

## ✅ When to use this (and when not to)

**Good fit**
- Internal tools, dashboards, demos, POCs, single-purpose apps
- Small teams that want to ship by `git push` without owning a CI/registry
- Apps with a handful of pip/npm deps and modest traffic

**Use a real container image instead when**
- It's a production / customer-facing service (need reproducible, scanned, pinned builds)
- Boot time matters (this pattern reinstalls deps on every pod start, ~1–3 min)
- You can't rely on egress to GitHub + PyPI/npm at pod start
- You need many replicas / autoscaling (repeated clone+install is wasteful)
- Dependencies must be version-pinned and immutable

See **§🔟 "Graduating to a container image"** when you outgrow this.

---

## 0️⃣ Prerequisites

- [ ] `kubectl` configured for the cluster (namespace `analytics-tools` or your own)
- [ ] A GitHub repo with your app code, pushable to `main`
- [ ] App entrypoint that **reads `PORT` from env** and **binds `0.0.0.0`**
- [ ] List of config values (non-secret → ConfigMap, secret → Secret)
- [ ] Internal hostname you want (confirm domain pattern with #platform/#devops)

Throughout, replace these placeholders:

| Placeholder | Example |
|---|---|
| `<app>` | `myreport` |
| `<namespace>` | `analytics-tools` |
| `<repo-url>` | `https://github.com/you/myrepo` |
| `<entrypoint>` | `app.py` (or `server.js`) |
| `<port>` | `8501` |
| `<host>` | `myreport.dev.razorpay.in` |

---

## 1️⃣ Make your app deployable

Your entrypoint must listen on `PORT` and bind all interfaces. Examples:

```python
# Python (FastAPI/Uvicorn)
import os, uvicorn
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8501")))
```

```js
// Node (Express)
const port = process.env.PORT || 8501;
app.listen(port, "0.0.0.0", () => console.log(`up on ${port}`));
```

Also expose a cheap **health route** (e.g. `GET /` or `GET /health`) for the
k8s probes. If `/` is auth-gated, add an unauthenticated `/health`.

---

## 2️⃣ Namespace

```bash
kubectl get ns <namespace> || kubectl create namespace <namespace>
```

---

## 3️⃣ ConfigMap (non-secret config)

```yaml
# k8s/<app>-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: <app>-config
  namespace: <namespace>
data:
  APP_ENV: "dev"
  # ... any non-secret settings your app reads from env ...
```

```bash
kubectl apply -f k8s/<app>-config.yaml
```

---

## 4️⃣ Secret (credentials)

Never put secret **values** in the repo. Create the Secret imperatively:

```bash
kubectl create secret generic <app>-secrets \
  --from-literal=DB_USER='<user>' \
  --from-literal=DB_PASSWORD='<password>' \
  -n <namespace> --dry-run=client -o yaml | kubectl apply -f -
```

> Reference these by `secretKeyRef` in the Deployment (see below). Avoid the
> anti-pattern of pasting secrets as plaintext inline env.

---

## 5️⃣ Deployment (the clone-on-boot pattern)

```yaml
# k8s/<app>-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: <app>
  namespace: <namespace>
  labels: { app: <app> }
spec:
  replicas: 1
  selector:
    matchLabels: { app: <app> }
  template:
    metadata:
      labels: { app: <app> }
    spec:
      nodeSelector:
        node.kubernetes.io/worker-generic: ""   # match TrustScan's node pool
      containers:
      - name: <app>
        # Stock image via Razorpay's Docker Hub proxy (swap for node:20-slim etc.)
        image: c.rzp.io/proxy_dockerhub/library/python:3.9-slim
        imagePullPolicy: IfNotPresent
        command:
          - /bin/bash
          - -c
          - >
            apt-get update -qq && apt-get install -y -qq git &&
            git clone --depth=1 <repo-url> /tmp/repo &&
            pip install --no-cache-dir -r /tmp/repo/requirements.txt &&
            python /tmp/repo/<entrypoint>
        ports:
        - containerPort: <port>
        env:
        - name: PORT
          value: "<port>"
        - name: APP_ENV
          valueFrom: { configMapKeyRef: { name: <app>-config, key: APP_ENV } }
        - name: DB_USER
          valueFrom: { secretKeyRef: { name: <app>-secrets, key: DB_USER } }
        - name: DB_PASSWORD
          valueFrom: { secretKeyRef: { name: <app>-secrets, key: DB_PASSWORD } }
        # Generous delay: first boot clones + installs deps (~1–3 min)
        livenessProbe:
          httpGet: { path: /, port: <port> }
          initialDelaySeconds: 120
          periodSeconds: 10
          failureThreshold: 5
        readinessProbe:
          httpGet: { path: /, port: <port> }
          initialDelaySeconds: 60
          periodSeconds: 5
          failureThreshold: 5
        resources:
          requests: { cpu: "300m", memory: "512Mi" }
          limits:   { memory: "1Gi" }
```

```bash
kubectl apply -f k8s/<app>-deployment.yaml
```

**Tips**
- Pin deps in `requirements.txt` (or `package.json`) for repeatability.
- For Node: `... && npm ci --omit=dev && node /tmp/repo/<entrypoint>`.
- `--depth=1` keeps the clone fast. Use a branch (`-b <branch>`) if not `main`.

---

## 6️⃣ Service

```yaml
# k8s/<app>-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: <app>
  namespace: <namespace>
  labels: { app: <app> }
spec:
  type: ClusterIP
  selector: { app: <app> }
  ports:
  - name: http
    port: 80
    targetPort: <port>
    protocol: TCP
```

```bash
kubectl apply -f k8s/<app>-service.yaml
```

---

## 7️⃣ Ingress (internal + optional external)

Razorpay dev apps follow the pattern `<app>.dev.razorpay.in` (internal) and
`<app>.ext.dev.razorpay.in` (external). **Confirm the exact ingress class,
annotations, TLS issuer and domain with #platform/#devops** — they vary by
cluster.

```yaml
# k8s/<app>-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: <app>
  namespace: <namespace>
  annotations:
    kubernetes.io/ingress.class: "nginx"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    # cert-manager.io/cluster-issuer: "letsencrypt-prod"   # if cert-manager is used
spec:
  tls:
  - hosts: [ "<host>" ]
    secretName: <app>-tls
  rules:
  - host: <host>                       # e.g. myreport.dev.razorpay.in
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: <app>
            port: { number: 80 }
```

```bash
kubectl apply -f k8s/<app>-ingress.yaml
```

Add a second `rules`/`tls` entry for the `.ext.dev.razorpay.in` host if you
need external access. DNS for the host must point at the ingress controller —
raise this with the network/platform team.

---

## 8️⃣ Optional: gate access with Google OAuth + allowlist

TrustScan restricts access with Google OAuth plus an `ALLOWED_EMAILS`
allowlist. To reuse the pattern in your app:

1. Create a Google OAuth client (Client ID + Secret); set the authorized
   redirect URI to `https://<host>/auth/callback` (and the `.ext` host too).
2. In the app, add `/auth/login`, `/auth/callback`, `/auth/logout`, sign the
   session with a `SESSION_SECRET`, and reject any authenticated email not in
   `ALLOWED_EMAILS`.
3. Provide these as env (secret values via the Secret, not inline):
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` 🔒, `SESSION_SECRET` 🔒,
   `GOOGLE_REDIRECT_URI`, `ALLOWED_EMAILS`.

Update the allowlist without editing code:

```bash
kubectl set env deployment/<app> -n <namespace> \
  ALLOWED_EMAILS="a@razorpay.com,b@razorpay.com,..."
```

> `trustscan_app.py` in this repo is a working reference implementation of the
> whole OAuth + allowlist + dynamic-redirect flow.

---

## 9️⃣ Deploying updates

```bash
# 1. Push your change
git push origin main

# 2. Restart so the pod re-clones and reinstalls
kubectl rollout restart deployment/<app> -n <namespace>
kubectl rollout status  deployment/<app> -n <namespace>
```

- The pod **only** picks up new code on (re)start — there's nothing to rebuild.
- If your app serves files from disk per request, a **frontend-only** change can
  be hot-patched with `kubectl cp` for an instant (but non-durable) fix — always
  also commit it.
- Rollback: `kubectl rollout undo deployment/<app> -n <namespace>` reverts the
  **spec** (env/command/image). To revert **code**, revert the commit on `main`
  and restart.

---

## 🔍 Verify

```bash
kubectl get pods -n <namespace> -l app=<app>
kubectl logs -f deployment/<app> -n <namespace>

# Local smoke test (bypasses ingress/DNS)
kubectl port-forward deployment/<app> 8080:<port> -n <namespace>
curl http://localhost:8080/health
```

---

## 🧾 Quick checklist

- [ ] App reads `PORT`, binds `0.0.0.0`, has a health route
- [ ] Deps pinned in `requirements.txt` / `package.json`
- [ ] ConfigMap for non-secret config, Secret for credentials (no inline secrets)
- [ ] Deployment uses the clone-on-boot command + generous probe delays
- [ ] Service (ClusterIP) → Ingress (host + TLS), domain confirmed with platform
- [ ] DNS points the host at the ingress controller
- [ ] (Optional) OAuth + `ALLOWED_EMAILS` wired
- [ ] Deploy = push to `main` + `kubectl rollout restart`

---

## ⚠️ Known trade-offs of this pattern

- **Slow cold start** — every pod reinstalls deps (~1–3 min); probes must allow for it.
- **Boot-time network dependency** — needs egress to GitHub and the package index.
- **Not reproducible** — unpinned deps can drift; no image digest to roll back to.
- **No image scanning / SBOM** — fine for internal tools, not for production.
- **Secrets discipline** — easy to leak by inlining; always use the Secret.

When these start to bite, move to a built image:

## 🔟 Graduating to a container image

1. Add a `Dockerfile` that copies the repo, installs pinned deps, sets `CMD`.
2. Build & push to Razorpay's registry (`c.rzp.io/razorpay/<app>`), ideally via
   a CI pipeline on merge to `main`.
3. Change the Deployment to use `image: c.rzp.io/razorpay/<app>:<tag>` and drop
   the `apt/git clone/pip install` bootstrap `command`.
4. Deploys become `kubectl set image ...` (or GitOps) instead of `rollout
   restart`, with fast, reproducible, scannable starts.

---

## 📞 Support

- **Infra / ingress / DNS:** #devops / #platform
- **Reference implementation:** this repo — `trustscan_app.py` + `DEPLOYMENT_GUIDE.md`
