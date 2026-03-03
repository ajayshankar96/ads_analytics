# Kubernetes Deployment Guide

Deploy the VPA Ecosystem Checker on Razorpay's internal Kubernetes cluster.

## 📋 Prerequisites

- Access to Razorpay's Kubernetes cluster
- `kubectl` configured and connected to the cluster
- Docker registry access (e.g., Docker Hub, AWS ECR, GCR, or internal registry)
- Docker installed locally (for building the image)

## 🚀 Quick Deployment

### Step 1: Build Docker Image

```bash
cd /path/to/ads_analytics

# Build the Docker image
docker build -t vpa-ecosystem-checker:latest .

# Tag for your registry (update with your registry URL)
docker tag vpa-ecosystem-checker:latest <YOUR_REGISTRY>/vpa-ecosystem-checker:latest

# Push to registry
docker push <YOUR_REGISTRY>/vpa-ecosystem-checker:latest
```

**Examples for different registries:**

```bash
# Docker Hub
docker tag vpa-ecosystem-checker:latest dockerhub.com/razorpay/vpa-ecosystem-checker:latest
docker push dockerhub.com/razorpay/vpa-ecosystem-checker:latest

# AWS ECR
docker tag vpa-ecosystem-checker:latest <account-id>.dkr.ecr.<region>.amazonaws.com/vpa-ecosystem-checker:latest
docker push <account-id>.dkr.ecr.<region>.amazonaws.com/vpa-ecosystem-checker:latest

# Google Container Registry
docker tag vpa-ecosystem-checker:latest gcr.io/<project-id>/vpa-ecosystem-checker:latest
docker push gcr.io/<project-id>/vpa-ecosystem-checker:latest
```

### Step 2: Update Deployment Config

Edit `kubernetes/deployment.yaml` and replace `<YOUR_REGISTRY>` with your actual registry URL:

```yaml
image: <YOUR_REGISTRY>/vpa-ecosystem-checker:latest
```

### Step 3: Deploy to Kubernetes

```bash
# Create namespace (optional but recommended)
kubectl create namespace analytics-tools

# Apply configurations
kubectl apply -f kubernetes/configmap.yaml -n analytics-tools
kubectl apply -f kubernetes/deployment.yaml -n analytics-tools
kubectl apply -f kubernetes/service.yaml -n analytics-tools

# Check deployment status
kubectl get pods -n analytics-tools
kubectl get svc -n analytics-tools
```

### Step 4: Access the Application

#### Option A: Port Forward (for testing)

```bash
kubectl port-forward -n analytics-tools svc/vpa-ecosystem-checker 8501:80
```

Then access at: http://localhost:8501

#### Option B: Via Ingress (production)

Update `kubernetes/service.yaml` ingress section with your internal domain:

```yaml
host: vpa-checker.internal.razorpay.com  # Your internal domain
```

Then apply:
```bash
kubectl apply -f kubernetes/service.yaml -n analytics-tools
```

Access at: http://vpa-checker.internal.razorpay.com

## 🔧 Configuration

### Update Trino Connection

Edit `kubernetes/configmap.yaml` if you need to change database settings:

```yaml
data:
  trino_host: "your-trino-host.com"
  trino_port: "443"
  trino_catalog: "hive"
```

Apply changes:
```bash
kubectl apply -f kubernetes/configmap.yaml -n analytics-tools
kubectl rollout restart deployment/vpa-ecosystem-checker -n analytics-tools
```

### Scale the Application

```bash
# Scale to 3 replicas
kubectl scale deployment vpa-ecosystem-checker --replicas=3 -n analytics-tools

# Or edit deployment.yaml and change replicas value
```

## 🐛 Troubleshooting

### Check Pod Logs

```bash
# Get pod name
kubectl get pods -n analytics-tools

# View logs
kubectl logs -f <pod-name> -n analytics-tools

# View logs from all pods
kubectl logs -f -l app=vpa-checker -n analytics-tools
```

### Check Pod Status

```bash
# Describe pod
kubectl describe pod <pod-name> -n analytics-tools

# Check events
kubectl get events -n analytics-tools --sort-by='.lastTimestamp'
```

### Common Issues

**Pod stuck in ImagePullBackOff:**
```bash
# Check if image exists and registry is accessible
kubectl describe pod <pod-name> -n analytics-tools

# Verify image name in deployment.yaml
kubectl edit deployment vpa-ecosystem-checker -n analytics-tools
```

**Pod CrashLoopBackOff:**
```bash
# Check application logs
kubectl logs <pod-name> -n analytics-tools

# Check if ConfigMap is created
kubectl get configmap -n analytics-tools
```

**Service not accessible:**
```bash
# Check service endpoints
kubectl get endpoints vpa-ecosystem-checker -n analytics-tools

# Test service internally
kubectl run -it --rm debug --image=alpine --restart=Never -- sh
# Inside the pod:
wget -O- http://vpa-ecosystem-checker.analytics-tools.svc.cluster.local
```

## 🔄 Updating the Application

### Method 1: Update Image

```bash
# Build new image
docker build -t vpa-ecosystem-checker:v2 .
docker tag vpa-ecosystem-checker:v2 <YOUR_REGISTRY>/vpa-ecosystem-checker:v2
docker push <YOUR_REGISTRY>/vpa-ecosystem-checker:v2

# Update deployment
kubectl set image deployment/vpa-ecosystem-checker streamlit-app=<YOUR_REGISTRY>/vpa-ecosystem-checker:v2 -n analytics-tools

# Check rollout status
kubectl rollout status deployment/vpa-ecosystem-checker -n analytics-tools
```

### Method 2: Apply Updated YAML

```bash
# After editing deployment.yaml
kubectl apply -f kubernetes/deployment.yaml -n analytics-tools

# Monitor rollout
kubectl rollout status deployment/vpa-ecosystem-checker -n analytics-tools
```

### Rollback if Needed

```bash
# Undo last rollout
kubectl rollout undo deployment/vpa-ecosystem-checker -n analytics-tools

# Rollback to specific revision
kubectl rollout history deployment/vpa-ecosystem-checker -n analytics-tools
kubectl rollout undo deployment/vpa-ecosystem-checker --to-revision=2 -n analytics-tools
```

## 📊 Monitoring

### Resource Usage

```bash
# Check CPU/Memory usage
kubectl top pods -n analytics-tools

# Check node resources
kubectl top nodes
```

### Application Metrics

```bash
# Watch pod status
kubectl get pods -n analytics-tools -w

# Check deployment status
kubectl get deployment vpa-ecosystem-checker -n analytics-tools
```

## 🔐 Security Considerations

### Network Policies (Optional)

Create network policies to restrict traffic:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: vpa-checker-netpol
  namespace: analytics-tools
spec:
  podSelector:
    matchLabels:
      app: vpa-checker
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: ingress-nginx
    ports:
    - protocol: TCP
      port: 8501
  egress:
  - to:
    - namespaceSelector: {}
    ports:
    - protocol: TCP
      port: 443  # Trino
```

### Resource Quotas

Set resource limits per namespace:

```bash
kubectl create quota analytics-quota --hard=cpu=4,memory=8Gi,pods=10 -n analytics-tools
```

## 📝 Best Practices

1. **Use specific image tags** instead of `:latest` for production
2. **Set resource limits** to prevent resource exhaustion
3. **Use health checks** (already configured in deployment.yaml)
4. **Monitor logs** regularly for errors
5. **Keep images updated** with security patches
6. **Use namespaces** to organize applications
7. **Document changes** in git commit messages

## 🆘 Support

For Kubernetes-specific issues, contact your DevOps/Platform team.

For application issues, contact: Ajay Shankar (`ajay.shankar@razorpay.com`)

## 📚 Additional Resources

- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Streamlit Deployment Guide](https://docs.streamlit.io/knowledge-base/tutorials/deploy)
- Internal Razorpay K8s documentation (check your internal wiki)
