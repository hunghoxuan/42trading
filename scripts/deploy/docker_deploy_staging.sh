#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VPS_HOST="${VPS_HOST:-root@139.59.211.192}"
IMAGE_NAME="${IMAGE_NAME:-trading-src/api}"
TAG="${TAG:-$(git -C "${ROOT_DIR}" rev-parse --short HEAD)}"
BUNDLE_FILE="${BUNDLE_FILE:-/tmp/${IMAGE_NAME}-${TAG}.tar.gz}"
REMOTE_TMP="${REMOTE_TMP:-/tmp/${IMAGE_NAME}-${TAG}.tar.gz}"
CONTAINER_NAME="${CONTAINER_NAME:-src/api-staging}"
APP_PORT="${APP_PORT:-8081}"
ENV_FILE="${ENV_FILE:-/opt/trading/src/api/.env}"
HEALTH_URL="${HEALTH_URL:-http://139.59.211.192:${APP_PORT}/health}"

echo "[staging] host=${VPS_HOST} image=${IMAGE_NAME}:${TAG} port=${APP_PORT}"
echo "[staging] bundle=${BUNDLE_FILE}"

if [[ ! -f "${BUNDLE_FILE}" ]]; then
  echo "[staging] bundle not found: ${BUNDLE_FILE}" >&2
  echo "[staging] run: bash scripts/deploy/docker_build_bundle.sh TAG=${TAG}" >&2
  exit 1
fi

scp "${BUNDLE_FILE}" "${VPS_HOST}:${REMOTE_TMP}"

REMOTE_CMD=$(cat <<EOF
set -euo pipefail
docker load -i "${REMOTE_TMP}"
docker rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
docker run -d \
  --name "${CONTAINER_NAME}" \
  --restart unless-stopped \
  --env-file "${ENV_FILE}" \
  -e NODE_ENV=production \
  -p "${APP_PORT}:80" \
  "${IMAGE_NAME}:${TAG}"
rm -f "${REMOTE_TMP}"
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
  echo "[staging] health check failed: ${HEALTH_URL}" >&2
  exit 1
fi

echo "[staging] deploy success"
echo "[staging] health=${HEALTH_URL}"
