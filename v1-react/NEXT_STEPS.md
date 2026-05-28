# Next Steps - Deploy TrustScan App

Your app is ready to deploy! Follow these steps to get it live on Razorpay's infrastructure.

## ✅ What's Done

- ✅ FastAPI backend with all Trino query endpoints
- ✅ React frontend with UI
- ✅ Production Dockerfiles for both backend and frontend
- ✅ Kubernetes manifests (deployment, service, ingress, configmap)
- ✅ GitHub Actions CI/CD pipeline
- ✅ Comprehensive documentation
- ✅ Code pushed to GitHub: https://github.com/ajayshankar96/ads_analytics

## 📋 Next Steps

### 1. Create Pull Request & Merge

```bash
# Go to GitHub and create PR
open https://github.com/ajayshankar96/ads_analytics/pull/new/deploy-trustscan-app

# Or merge directly if you're the only contributor
cd /tmp/ads_analytics
git checkout main
git merge deploy-trustscan-app
git push origin main
```

### 2. Set Up GitHub Secrets

Go to: **https://github.com/ajayshankar96/ads_analytics/settings/secrets/actions**

Add these secrets:

| Secret Name | Value | How to Get |
|------------|-------|------------|
| `DOCKER_USERNAME` | Your Docker Hub username | Sign up at https://hub.docker.com |
| `DOCKER_PASSWORD` | Docker Hub access token | Docker Hub → Settings → Security → New Access Token |
| `KUBE_CONFIG` | Base64 kubeconfig | `cat ~/.kube/config \| base64` (ask DevOps if you don't have this) |

### 3. Update Configuration Files

#### A. Kubernetes Secret (Trino Credentials)

Create secret manually (don't commit to git!):

```bash
# Create the secret
kubectl create secret generic trustscan-secrets \
  --from-literal=TRINO_USER='your-actual-trino-username' \
  --from-literal=TRINO_PASSWORD='your-actual-trino-password' \
  -n analytics-tools

# Verify it was created
kubectl get secret trustscan-secrets -n analytics-tools
```

#### B. Update Trino Host in ConfigMap

Edit `kubernetes/configmap.yaml`:

```yaml
data:
  TRINO_HOST: "trino.razorpay.com"  # Replace with actual Trino host
```

#### C. Update Docker Images

Edit `kubernetes/deployment.yaml` and `.github/workflows/build-and-deploy.yml`:

```yaml
# Change this:
image: ajayshankar96/trustscan-backend:latest

# To your actual Docker Hub username or internal registry:
image: YOUR_DOCKERHUB_USERNAME/trustscan-backend:latest
```

### 4. Deploy to Kubernetes

#### Option A: Automatic (via GitHub Actions)

1. Merge PR to `main` branch
2. GitHub Actions will automatically:
   - Build Docker images
   - Push to Docker Hub
   - Deploy to Kubernetes

Watch at: https://github.com/ajayshankar96/ads_analytics/actions

#### Option B: Manual Deployment

```bash
# Apply Kubernetes manifests
kubectl create namespace analytics-tools
kubectl apply -f kubernetes/configmap.yaml
kubectl apply -f kubernetes/deployment.yaml
kubectl apply -f kubernetes/service.yaml
kubectl apply -f kubernetes/ingress.yaml

# Check deployment
kubectl get pods -n analytics-tools
kubectl get svc -n analytics-tools
```

### 5. Configure Internal DNS

Contact DevOps/Network team to:

1. Create DNS entry: `trustscan.internal.razorpay.com`
2. Point to Kubernetes ingress IP
3. Set up TLS certificate

### 6. Test the Application

```bash
# Port-forward to test locally
kubectl port-forward svc/trustscan-frontend 8080:80 -n analytics-tools

# Open browser
open http://localhost:8080

# Test backend API
kubectl port-forward svc/trustscan-backend 8000:8000 -n analytics-tools
curl http://localhost:8000/health
```

### 7. Access Production App

Once DNS is configured:
- **Internal URL**: https://trustscan.internal.razorpay.com

## 🔧 Quick Commands Reference

```bash
# View logs
kubectl logs -f deployment/trustscan-backend -n analytics-tools
kubectl logs -f deployment/trustscan-frontend -n analytics-tools

# Check pod status
kubectl get pods -n analytics-tools -l app=trustscan

# Restart deployment
kubectl rollout restart deployment/trustscan-backend -n analytics-tools
kubectl rollout restart deployment/trustscan-frontend -n analytics-tools

# Scale replicas
kubectl scale deployment trustscan-backend --replicas=3 -n analytics-tools

# Delete deployment
kubectl delete -f kubernetes/ -n analytics-tools
```

## 📚 Documentation

- **README.md**: Overview and local development
- **DEPLOYMENT_GUIDE.md**: Complete deployment guide with troubleshooting
- **KUBERNETES_DEPLOYMENT.md**: Original K8s documentation

## ⚠️ Important Notes

1. **Don't commit secrets**: Never add real passwords to `kubernetes/secret.yaml`
2. **Update image names**: Replace `ajayshankar96` with your Docker Hub username
3. **Test locally first**: Build and run Docker images locally before deploying
4. **Monitor resources**: Set appropriate CPU/memory limits for production

## 🆘 Need Help?

- **GitHub Issues**: https://github.com/ajayshankar96/ads_analytics/issues
- **Deployment Guide**: See `DEPLOYMENT_GUIDE.md` for detailed troubleshooting
- **Contact**: Ajay Shankar (ajay.shankar@razorpay.com)

---

**🚀 Ready to deploy?** Start with Step 1 above!
