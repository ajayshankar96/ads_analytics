# Streamlit Deployment Guide - TrustScan App

Simple deployment of TrustScan analytics app using Streamlit on Kubernetes.

## 🎯 Why Streamlit?

- ✅ **No Docker Registry needed** - Uses public Python image
- ✅ **Easy to update** - Just update ConfigMap, no rebuilds
- ✅ **Single file app** - All code in one Python file
- ✅ **Internal-only access** - Secure by default
- ✅ **Interactive UI** - Built-in widgets and charts

---

## 🚀 Quick Deploy

### Prerequisites

- kubectl access to Razorpay K8s cluster
- Trino credentials

### Step 1: Create Namespace and Secrets

```bash
# Create namespace
kubectl create namespace analytics-tools

# Create Trino credentials secret
kubectl create secret generic trustscan-secrets \
  --from-literal=TRINO_USER='your-trino-username' \
  --from-literal=TRINO_PASSWORD='your-trino-password' \
  -n analytics-tools

# Create Trino config
kubectl create configmap trustscan-config \
  --from-literal=TRINO_HOST='trino.razorpay.com' \
  -n analytics-tools

# Verify
kubectl get secret trustscan-secrets -n analytics-tools
kubectl get configmap trustscan-config -n analytics-tools
```

### Step 2: Deploy App Code

```bash
# Create ConfigMap from Streamlit app file
kubectl create configmap trustscan-app-code \
  --from-file=trustscan_streamlit.py=./trustscan_streamlit.py \
  -n analytics-tools

# Verify
kubectl get configmap trustscan-app-code -n analytics-tools
```

### Step 3: Deploy to Kubernetes

```bash
# Deploy Streamlit app
kubectl apply -f kubernetes/streamlit-deployment.yaml

# Check deployment
kubectl get pods -n analytics-tools -l component=streamlit
kubectl get svc -n analytics-tools
kubectl get ingress -n analytics-tools

# View logs
kubectl logs -f deployment/trustscan-streamlit -n analytics-tools
```

### Step 4: Access the App

**Internal URL:** http://trustscan.internal.razorpay.com

**Requirements to access:**
- ✅ Connected to Razorpay office network, OR
- ✅ Connected to Razorpay VPN

**Note:** DNS setup may be required - contact DevOps/Network team to:
1. Create internal DNS entry for `trustscan.internal.razorpay.com`
2. Point to Kubernetes ingress controller IP

---

## 🔄 Updating the App

To update the Streamlit app code (no Docker rebuild needed!):

```bash
# Update ConfigMap with new code
kubectl create configmap trustscan-app-code \
  --from-file=trustscan_streamlit.py=./trustscan_streamlit.py \
  -n analytics-tools \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart pods to load new code
kubectl rollout restart deployment/trustscan-streamlit -n analytics-tools

# Watch rollout
kubectl rollout status deployment/trustscan-streamlit -n analytics-tools
```

---

## 🧪 Test Locally (Before Deploying)

```bash
# Install dependencies
pip install streamlit trino pandas

# Set environment variables
export TRINO_HOST="trino.razorpay.com"
export TRINO_USER="your-username"
export TRINO_PASSWORD="your-password"

# Run app
streamlit run trustscan_streamlit.py

# Open browser at http://localhost:8501
```

---

## 🔐 Security

### Internal-Only Access

The app is **only accessible from Razorpay's internal network**:

1. **Internal K8s Cluster** - Not exposed to internet
2. **Internal Domain** - `.internal.razorpay.com` only resolves internally
3. **Network Policies** - K8s network policies restrict access
4. **VPN Required** - Remote workers must use Razorpay VPN

### Test Security

**From office/VPN:**
```bash
curl http://trustscan.internal.razorpay.com
# Should return HTML (works!)
```

**From home without VPN:**
```bash
curl http://trustscan.internal.razorpay.com
# Should fail: DNS not found or connection refused
```

---

## 🐛 Troubleshooting

### Pod Not Starting

```bash
# Check pod status
kubectl describe pod -n analytics-tools -l component=streamlit

# Common issues:
# - ImagePullBackOff: Wait, the python:3.9-slim image will download
# - CrashLoopBackOff: Check logs for errors
```

### App Not Loading

```bash
# Check logs
kubectl logs -f deployment/trustscan-streamlit -n analytics-tools

# Look for:
# - "You can now view your Streamlit app in your browser"
# - Any Python errors
```

### Can't Connect to Trino

```bash
# Verify secret exists
kubectl get secret trustscan-secrets -n analytics-tools -o yaml

# Check if credentials are correct
# Test from pod:
kubectl exec -it deployment/trustscan-streamlit -n analytics-tools -- bash
# Inside pod:
python3 -c "import trino; print('Trino library loaded')"
```

### DNS Not Working

```bash
# Check ingress
kubectl describe ingress trustscan-streamlit -n analytics-tools

# Get ingress IP
kubectl get ingress trustscan-streamlit -n analytics-tools

# Contact DevOps to:
# 1. Create DNS entry: trustscan.internal.razorpay.com
# 2. Point to ingress IP
```

### Port Forward (Temporary Access)

If DNS isn't set up yet, test via port-forward:

```bash
# Port forward to local machine
kubectl port-forward svc/trustscan-streamlit 8501:8501 -n analytics-tools

# Access at http://localhost:8501
```

---

## 📊 Monitoring

### View Logs

```bash
# Stream logs
kubectl logs -f deployment/trustscan-streamlit -n analytics-tools

# Last 100 lines
kubectl logs --tail=100 deployment/trustscan-streamlit -n analytics-tools

# All logs since timestamp
kubectl logs --since=1h deployment/trustscan-streamlit -n analytics-tools
```

### Resource Usage

```bash
# Check CPU/memory
kubectl top pod -n analytics-tools -l component=streamlit

# Check events
kubectl get events -n analytics-tools --sort-by='.lastTimestamp' | grep trustscan
```

---

## 🔧 Configuration

### Update Trino Connection

```bash
# Update config
kubectl create configmap trustscan-config \
  --from-literal=TRINO_HOST='new-trino-host.com' \
  -n analytics-tools \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart to apply changes
kubectl rollout restart deployment/trustscan-streamlit -n analytics-tools
```

### Update Credentials

```bash
# Update secret
kubectl create secret generic trustscan-secrets \
  --from-literal=TRINO_USER='new-username' \
  --from-literal=TRINO_PASSWORD='new-password' \
  -n analytics-tools \
  --dry-run=client -o yaml | kubectl apply -f -

# Restart
kubectl rollout restart deployment/trustscan-streamlit -n analytics-tools
```

### Scale Replicas

```bash
# Scale to multiple replicas (for high availability)
kubectl scale deployment trustscan-streamlit --replicas=2 -n analytics-tools
```

---

## 🗑️ Cleanup

```bash
# Delete everything
kubectl delete -f kubernetes/streamlit-deployment.yaml
kubectl delete configmap trustscan-app-code -n analytics-tools
kubectl delete configmap trustscan-config -n analytics-tools
kubectl delete secret trustscan-secrets -n analytics-tools

# Or delete entire namespace (if nothing else is there)
kubectl delete namespace analytics-tools
```

---

## 📝 Features

The Streamlit app includes:

1. **Trust Scan** - Single phone DPD/CD lookup
   - DPD 30/90 bands and scores
   - Credit default probabilities
   - Predicted income

2. **Bands Scan** - Credit bands from API-ready table
   - Credit bands
   - Income buckets
   - Thick/thin data classification

3. **Batch Query** - Bulk phone number lookup
   - Up to 500 numbers
   - Download results as CSV

4. **Offer Impressions** - Query offer impression data
   - By offer ID and date
   - Total impressions count

---

## 🆘 Support

**Owner:** Ajay Shankar (ajay.shankar@razorpay.com)
**DevOps:** Contact #devops or #platform channels
**GitHub:** https://github.com/ajayshankar96/ads_analytics

---

**Last Updated:** 2026-04-29
