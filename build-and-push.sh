#!/bin/bash

# Build and Push Script for VPA Ecosystem Checker
# Usage: ./build-and-push.sh <registry-url> <version>
# Example: ./build-and-push.sh gcr.io/razorpay-project v1.0.0

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

if [ -z "$1" ]; then
    echo -e "${RED}Error: Registry URL required${NC}"
    echo "Usage: $0 <registry-url> [version]"
    echo "Example: $0 gcr.io/razorpay-project v1.0.0"
    exit 1
fi

REGISTRY=$1
VERSION=${2:-latest}
IMAGE_NAME="vpa-ecosystem-checker"
FULL_IMAGE="${REGISTRY}/${IMAGE_NAME}:${VERSION}"

echo -e "${YELLOW}Building Docker image...${NC}"
docker build -t ${IMAGE_NAME}:${VERSION} .

echo -e "${YELLOW}Tagging image...${NC}"
docker tag ${IMAGE_NAME}:${VERSION} ${FULL_IMAGE}

# Also tag as latest if specific version provided
if [ "$VERSION" != "latest" ]; then
    docker tag ${IMAGE_NAME}:${VERSION} ${REGISTRY}/${IMAGE_NAME}:latest
fi

echo -e "${YELLOW}Pushing to registry...${NC}"
docker push ${FULL_IMAGE}

if [ "$VERSION" != "latest" ]; then
    docker push ${REGISTRY}/${IMAGE_NAME}:latest
fi

echo -e "${GREEN}✓ Successfully built and pushed:${NC}"
echo -e "  ${FULL_IMAGE}"
if [ "$VERSION" != "latest" ]; then
    echo -e "  ${REGISTRY}/${IMAGE_NAME}:latest"
fi

echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update kubernetes/deployment.yaml with:"
echo -e "   ${GREEN}image: ${FULL_IMAGE}${NC}"
echo ""
echo "2. Deploy to Kubernetes:"
echo -e "   ${GREEN}kubectl apply -f kubernetes/ -n analytics-tools${NC}"
echo ""
echo "3. Check deployment:"
echo -e "   ${GREEN}kubectl get pods -n analytics-tools${NC}"
