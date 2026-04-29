# Deployment Guide - TrustScan App

Complete guide to deploy the TrustScan app to Razorpay's Kubernetes cluster.

## 🎯 Overview

This guide covers:
1. Setting up Docker Hub registry
2. Configuring GitHub Actions secrets
3. Building and pushing Docker images
4. Deploying to Kubernetes
5. Accessing the application

---

## 📋 Prerequisites

- [ ] Access to Razorpay's Kubernetes cluster
- [ ] Docker Hub account (or access to Razorpay's container registry)
- [ ] GitHub repository access with admin permissions
- [ ] Trino connection credentials
- [ ] kubectl installed and configured

---

## 1️⃣ Docker Registry Setup

### Option A: Using Docker Hub (Public/Personal)

1. Create Docker Hub account at https://hub.docker.com
2. Create two repositories:
   - `trustscan-backend`
   - `trustscan-frontend`
3. Generate access token: Settings → Security → New Access Token

### Option B: Using Razorpay's Internal Registry

Contact DevOps team for:
- Registry URL
- Credentials
- Namespace/project allocation

Update image names in:
- `kubernetes/deployment.yaml`
- `.github/workflows/build-and-deploy.yml`

---

## 2️⃣ GitHub Secrets Configuration

Go to your repo: **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

### Required Secrets

| Secret Name | Description | How to Get |
|------------|-------------|------------|
| `DOCKER_USERNAME` | Docker Hub username | Your Docker Hub account |
| `DOCKER_PASSWORD` | Docker Hub token | Docker Hub → Settings → Security → New Access Token |
| `KUBE_CONFIG` | Base64 kubeconfig | `cat ~/.kube/config \| base64` |

### Optional Secrets (if using private registry)

| Secret Name | Description |
|------------|-------------|
| `REGISTRY_URL` | Private registry URL |
| `REGISTRY_USERNAME` | Registry username |
| `REGISTRY_PASSWORD` | Registry password/token |

---

## 3️⃣ Update Trino Configuration

### Create Kubernetes Secret (One-time)

```bash
# Create secret with your Trino credentials
kubectl create secret generic trustscan-secrets \
  --from-literal=TRINO_USER='your-trino-username' \
  --from-literal=TRINO_PASSWORD='your-trino-password' \
  -n analytics-tools --dry-run=client -o yaml > /tmp/trustscan-secret.yaml

# Apply the secret
kubectl apply -f /tmp/trustscan-secret.yaml

# Delete the temp file (don't commit secrets!)
rm /tmp/trustscan-secret.yaml
```

### Update ConfigMap

Edit `kubernetes/configmap.yaml` with correct Trino host:

```yaml
TRINO_HOST: "trino-prod.razorpay.com"  # Update this
```

---

## 4️⃣ Manual Build & Push (Optional)

If you want to build manually before GitHub Actions:

```bash
# Build backend
cd backend
docker build -t ajayshankar96/trustscan-backend:latest .
docker push ajayshankar96/trustscan-backend:latest

# Build frontend
cd ../frontend
docker build -t ajayshankar96/trustscan-frontend:latest .
docker push ajayshankar96/trustscan-frontend:latest
```

---

## 5️⃣ Deploy to Kubernetes

### Automatic Deployment (Recommended)

1. Push to `main` branch
2. GitHub Actions will automatically:
   - Build Docker images
   - Push to registry
   - Deploy to Kubernetes

Watch the workflow: **GitHub → Actions tab**

### Manual Deployment

```bash
# Create namespace
kubectl create namespace analytics-tools

# Apply all manifests
kubectl apply -f kubernetes/configmap.yaml
kubectl apply -f kubernetes/secret.yaml  # if you created it manually
kubectl apply -f kubernetes/deployment.yaml
kubectl apply -f kubernetes/service.yaml
kubectl apply -f kubernetes/ingress.yaml

# Check deployment
kubectl get pods -n analytics-tools
kubectl get svc -n analytics-tools
kubectl get ingress -n analytics-tools
```

---

## 6️⃣ Verify Deployment

### Check Pod Status

```bash
# Should show 2 backend + 2 frontend pods running
kubectl get pods -n analytics-tools -l app=trustscan

# Check logs
kubectl logs -f deployment/trustscan-backend -n analytics-tools
kubectl logs -f deployment/trustscan-frontend -n analytics-tools
```

### Test Backend Health

```bash
# Port-forward to test locally
kubectl port-forward svc/trustscan-backend 8000:8000 -n analytics-tools

# In another terminal
curl http://localhost:8000/health
# Should return: {"status":"healthy","database":"connected"}
```

### Test Frontend

```bash
# Port-forward frontend
kubectl port-forward svc/trustscan-frontend 8080:80 -n analytics-tools

# Open browser
open http://localhost:8080
```

---

## 7️⃣ Configure Ingress (Internal Access)

### Update Domain

Edit `kubernetes/ingress.yaml`:

```yaml
spec:
  rules:
  - host: trustscan.internal.razorpay.com  # Update this domain
```

### DNS Configuration

Contact DevOps/Network team to:
1. Create internal DNS entry for `trustscan.internal.razorpay.com`
2. Point to Kubernetes ingress controller IP
3. Configure TLS certificate (if using HTTPS)

### Access the App

Once DNS is configured:
- Internal URL: https://trustscan.internal.razorpay.com

---

## 🔧 Troubleshooting

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n analytics-tools

# Common issues:
# - ImagePullBackOff: Wrong image name or registry auth
# - CrashLoopBackOff: Check logs for errors
# - Pending: Insufficient cluster resources
```

### Backend Can't Connect to Trino

```bash
# Verify secret exists
kubectl get secret trustscan-secrets -n analytics-tools

# Check secret content (base64 encoded)
kubectl get secret trustscan-secrets -n analytics-tools -o yaml

# Test Trino connection from pod
kubectl exec -it deployment/trustscan-backend -n analytics-tools -- sh
# Inside pod:
curl -u $TRINO_USER:$TRINO_PASSWORD https://$TRINO_HOST:$TRINO_PORT/v1/info
```

### Frontend Can't Reach Backend

```bash
# Check if backend service exists
kubectl get svc trustscan-backend -n analytics-tools

# Check backend endpoints
kubectl get endpoints trustscan-backend -n analytics-tools

# Test from frontend pod
kubectl exec -it deployment/trustscan-frontend -n analytics-tools -- sh
# Inside pod:
wget -O- http://trustscan-backend:8000/health
```

### Ingress Not Working

```bash
# Check ingress status
kubectl describe ingress trustscan-ingress -n analytics-tools

# Check ingress controller logs
kubectl logs -f -n ingress-nginx deployment/ingress-nginx-controller
```

---

## 🔄 Updating the Application

### Update Code

1. Make changes to backend or frontend code
2. Commit and push to `main`
3. GitHub Actions will automatically rebuild and deploy

### Manual Update

```bash
# Rebuild and push new images
docker build -t ajayshankar96/trustscan-backend:v2 ./backend
docker push ajayshankar96/trustscan-backend:v2

# Update deployment
kubectl set image deployment/trustscan-backend \
  fastapi=ajayshankar96/trustscan-backend:v2 \
  -n analytics-tools

# Check rollout
kubectl rollout status deployment/trustscan-backend -n analytics-tools
```

### Rollback

```bash
# Rollback to previous version
kubectl rollout undo deployment/trustscan-backend -n analytics-tools

# Rollback to specific revision
kubectl rollout history deployment/trustscan-backend -n analytics-tools
kubectl rollout undo deployment/trustscan-backend --to-revision=2 -n analytics-tools
```

---

## 📊 Monitoring

### View Logs

```bash
# Stream backend logs
kubectl logs -f -l app=trustscan,component=backend -n analytics-tools

# Stream frontend logs  
kubectl logs -f -l app=trustscan,component=frontend -n analytics-tools

# View last 100 lines
kubectl logs --tail=100 deployment/trustscan-backend -n analytics-tools
```

### Resource Usage

```bash
# CPU and memory usage
kubectl top pods -n analytics-tools

# Detailed metrics
kubectl describe pod <pod-name> -n analytics-tools
```

---

## 🔐 Security Best Practices

1. **Never commit secrets** to git
2. **Use Kubernetes secrets** for sensitive data
3. **Rotate credentials** regularly
4. **Limit ingress** to internal network only
5. **Use TLS** for production
6. **Set resource limits** to prevent resource exhaustion

---

## 📞 Support

**Issues**: Create GitHub issue
**Owner**: Ajay Shankar (ajay.shankar@razorpay.com)
**DevOps**: Contact #devops or #platform channels
