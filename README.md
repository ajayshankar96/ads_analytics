# TrustScan Analytics App

Internal Razorpay tool for querying Trino trust/credit scoring data.

## 🎯 Two Deployment Options

### Option 1: Streamlit (Recommended! ⭐)

**Simple single-file app** - No Docker registry needed!

- ✅ Easy to deploy and update
- ✅ Uses public Python image (no Harbor credentials)
- ✅ Interactive UI with built-in widgets
- ✅ See: [STREAMLIT_DEPLOYMENT.md](STREAMLIT_DEPLOYMENT.md)

### Option 2: FastAPI + React (Advanced)

**Production microservices architecture** - Requires Harbor registry access

- Backend: FastAPI REST API
- Frontend: React SPA
- See: [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)

## 🏗️ Architecture

- **Database**: Trino (queries `aggregate_ba` schema)
- **Deployment**: Kubernetes on Razorpay's internal cluster
- **Access**: Internal-only (office network or VPN required)

## 📦 Features

- **Trust Scan API**: Query DPD (Days Past Due) predictions by phone number
- **Bands Scan API**: Query credit bands and income predictions
- **Batch Operations**: Query up to 500 phone numbers at once
- **Impressions Query**: Query offer impression data

## 🚀 Quick Start

### Local Development

#### Backend (FastAPI)
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Set environment variables
export TRINO_HOST=your-trino-host
export TRINO_USER=your-username  
export TRINO_PASSWORD=your-password

# Run server
uvicorn main:app --reload --port 8000
```

API docs available at: http://localhost:8000/docs

#### Frontend (React)
```bash
cd frontend
npm install
npm start
```

App available at: http://localhost:3000

### Docker Build

```bash
# Build backend
docker build -t trustscan-backend:latest ./backend

# Build frontend
docker build -t trustscan-frontend:latest ./frontend

# Run with docker-compose (optional)
docker-compose up
```

## ☸️ Kubernetes Deployment

### Prerequisites

1. Access to Razorpay's Kubernetes cluster
2. `kubectl` configured
3. Docker images pushed to registry

### Deploy

```bash
# Create namespace
kubectl create namespace analytics-tools

# Apply manifests
kubectl apply -f kubernetes/configmap.yaml
kubectl apply -f kubernetes/secret.yaml
kubectl apply -f kubernetes/deployment.yaml
kubectl apply -f kubernetes/service.yaml
kubectl apply -f kubernetes/ingress.yaml

# Check status
kubectl get pods -n analytics-tools
kubectl get svc -n analytics-tools
```

### Access the App

Internal URL: https://trustscan.internal.razorpay.com

## 🔧 Configuration

### Environment Variables

Update `kubernetes/secret.yaml` with your Trino credentials:

```yaml
TRINO_USER: "your-username"
TRINO_PASSWORD: "your-password"
```

Update `kubernetes/configmap.yaml` for Trino connection:

```yaml
TRINO_HOST: "trino.razorpay.com"
TRINO_PORT: "443"
TRINO_CATALOG: "hive"
TRINO_SCHEMA: "aggregate_ba"
```

## 🔄 CI/CD

GitHub Actions automatically:
1. Builds Docker images on push to `main`
2. Pushes images to Docker Hub
3. Deploys to Kubernetes cluster

### Required Secrets

Add these to your GitHub repository secrets:

- `DOCKER_USERNAME`: Docker Hub username
- `DOCKER_PASSWORD`: Docker Hub password or token
- `KUBE_CONFIG`: Base64-encoded kubeconfig file

## 📚 API Endpoints

### GET /api/trust-scan/{phone}
Query DPD and CD predictions for a single phone number.

### POST /api/batch-trust-scan
Query DPD and CD predictions for multiple phone numbers (max 500).

### GET /api/bands-scan/{phone}
Query credit bands from the API-ready table.

### POST /api/batch-bands-scan
Batch query credit bands for multiple phone numbers.

### POST /query/impressions
Query offer impression data by offer ID and date.

### GET /health
Health check endpoint.

## 🛠️ Development

### Adding New Features

1. Create a feature branch
2. Make changes to backend/frontend
3. Test locally
4. Push to GitHub
5. Create pull request

### Updating Dependencies

Backend:
```bash
cd backend
pip freeze > requirements.txt
```

Frontend:
```bash
cd frontend
npm update
```

## 📊 Monitoring

Check logs:
```bash
# Backend logs
kubectl logs -f deployment/trustscan-backend -n analytics-tools

# Frontend logs
kubectl logs -f deployment/trustscan-frontend -n analytics-tools
```

Check resources:
```bash
kubectl top pods -n analytics-tools
```

## 🆘 Support

**Owner**: Ajay Shankar (`ajay.shankar@razorpay.com`)

**Issues**: Report on GitHub Issues

## 📝 License

Internal Razorpay tool - Not for public distribution
