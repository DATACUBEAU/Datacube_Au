#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
VPS_HOST="${VPS_HOST:-your-vps-host}"
VPS_USER="${VPS_USER:-root}"
VPS_PATH="${VPS_PATH:-/opt/datacube-ai-gateway}"

echo "=== Building VPS AI Gateway ==="
cd "$PROJECT_DIR"

npm run build

echo "=== Creating distribution archive ==="
cd ..
tar -czf vps-ai-gateway.tar.gz \
  vps-ai-gateway/package.json \
  vps-ai-gateway/package-lock.json \
  vps-ai-gateway/dist \
  vps-ai-gateway/Dockerfile

echo "=== Copying to VPS ==="
scp vps-ai-gateway.tar.gz "${VPS_USER}@${VPS_HOST}:${VPS_PATH}/"

echo "=== Extracting on VPS ==="
ssh "${VPS_USER}@${VPS_HOST}" "cd ${VPS_PATH} && tar -xzf vps-ai-gateway.tar.gz && cd vps-ai-gateway && npm ci --production"

echo "=== Restarting service ==="
ssh "${VPS_USER}@${VPS_HOST}" "cd ${VPS_PATH}/vps-ai-gateway && docker build -t vps-ai-gateway . && docker stop vps-ai-gateway || true && docker rm vps-ai-gateway || true && docker run -d --name vps-ai-gateway -p 3001:3001 --restart unless-stopped vps-ai-gateway"

echo "=== Cleanup ==="
rm vps-ai-gateway.tar.gz

echo "=== Done ==="
echo "VPS AI Gateway deployed. Health check:"
echo "  curl https://${VPS_HOST}/health"
