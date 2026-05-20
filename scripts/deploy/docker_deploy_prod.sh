#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VPS_HOST="${VPS_HOST:-root@139.59.211.192}"
IMAGE_NAME="${IMAGE_NAME:-trading-webhook}"
TAG="${TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
CONTAINER_NAME="${CONTAINER_NAME:-webhook-prod}"
APP_PORT="${APP_PORT:-80}"
ENV_FILE="${ENV_FILE:-/opt/trading/webhook/.env}"
HEALTH_URL="${HEALTH_URL:-https://trade.mozasolution.com/health}"

echo "[prod] host=${VPS_HOST} image=${IMAGE_NAME}:${TAG} port=${APP_PORT}"

REMOTE_CMD=$(cat <<EOF
set -euo pipefail
docker image inspect "${IMAGE_NAME}:${TAG}" >/dev/null 2>&1
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --env-file "${ENV_FILE}" \
  -e NODE_ENV=production \
  -p "${APP_PORT}:80" \
  "${IMAGE_NAME}:${TAG}"
EOF
)

ssh "${VPS_HOST}" "${REMOTE_CMD}"

OK=0
for i in {1..20}; do
  if curl -fsS "${HEALTH_URL}" >/dev/null; then
    OK=1
    break
  fi
  sleep 2
done

if [[ "${OK}" != "1" ]]; then
  echo "[prod] health check failed: ${HEALTH_URL}" >&2
  exit 1
fi

echo "[prod] deploy success"
echo "[prod] health=${HEALTH_URL}"
