#!/usr/bin/env bash
set -euo pipefail

# Local + VPS deploy helper for webhook server.
# Usage examples:
#   bash scripts/deploy/deploy_webhook.sh
#   PUSH_FIRST=0 VPS_APP_DIR=/opt/trading SERVICE_MODE=systemd SERVICE_NAME=webhook \
#     bash scripts/deploy/deploy_webhook.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

BRANCH="${BRANCH:-main}"
PUSH_FIRST="${PUSH_FIRST:-1}"
VPS_HOST="${VPS_HOST:-root@139.59.211.192}"
VPS_APP_DIR="${VPS_APP_DIR:-/opt/trading}"
SERVICE_MODE="${SERVICE_MODE:-pm2}"      # pm2|systemd
SERVICE_NAME="${SERVICE_NAME:-webhook}"  # pm2 process name or systemd unit name
HEALTH_PORT="${HEALTH_PORT:-443}"
REMOTE_HOST="${VPS_HOST#*@}"
REMOTE_HEALTH_BASE_URL="${REMOTE_HEALTH_BASE_URL:-https://trade.mozasolution.com}"

echo "[deploy] root=${ROOT_DIR}"
echo "[deploy] branch=${BRANCH} push_first=${PUSH_FIRST}"
echo "[deploy] vps_host=${VPS_HOST} app_dir=${VPS_APP_DIR} service_mode=${SERVICE_MODE} service_name=${SERVICE_NAME} health_port=${HEALTH_PORT}"
echo "[deploy] remote_health_base_url=${REMOTE_HEALTH_BASE_URL}"

cd "${ROOT_DIR}"

echo "[deploy] enforcing build-version rule"
if [[ -f "scripts/deploy/check_build_versions.sh" ]]; then
  bash scripts/deploy/check_build_versions.sh "origin/${BRANCH}"
elif [[ -f "scripts/check_build_versions.sh" ]]; then
  # Backward compatibility for older layout
  bash scripts/check_build_versions.sh "origin/${BRANCH}"
else
  echo "[deploy] check_build_versions script not found" >&2
  exit 1
fi

LOCAL_SERVER_VERSION="$(grep -E 'const SERVER_VERSION = envStr\(process\.env\.WEBHOOK_SERVER_VERSION, "' webhook/server.js | sed -E 's/.*"([^"]+)".*/\1/' | head -1 || true)"
LOCAL_EA_BUILD_VERSION="$(grep -E 'string EA_BUILD_VERSION = "' bridge-clients/TVBridgeEA.mq5 | sed -E 's/.*"([^"]+)".*/\1/' | head -1 || true)"

echo "[deploy] skipping local syntax check (node missing in path)"

if [[ "${PUSH_FIRST}" == "1" ]]; then
  echo "[deploy] pushing local branch to origin/${BRANCH}"
  git push origin "${BRANCH}"
fi

REMOTE_CMD=$(cat <<EOF
set -euo pipefail
cd "${VPS_APP_DIR}"
echo "[vps] cwd=\$(pwd)"
git fetch --all --prune
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"
node --check webhook/server.js
# Ensure runtime deps for webhook are present (needed for MT5 postgres mode: pg).
npm --prefix webhook install --no-audit --no-fund
# Build UI if present
if [[ -d "web-ui" ]]; then
  echo "[vps] building web-ui"
  npm --prefix web-ui install --no-audit --no-fund
  npm --prefix web-ui run build
fi

if [[ "${SERVICE_MODE}" == "pm2" ]]; then
  PORT=3001 HTTPS_ENABLED=false pm2 restart "${SERVICE_NAME}" --update-env
  pm2 logs "${SERVICE_NAME}" --lines 80 --nostream || true
elif [[ "${SERVICE_MODE}" == "systemd" ]]; then
  sudo systemctl restart "${SERVICE_NAME}"
  sudo systemctl status "${SERVICE_NAME}" --no-pager || true
  journalctl -u "${SERVICE_NAME}" -n 80 --no-pager || true
else
  echo "Unsupported SERVICE_MODE=${SERVICE_MODE} (use pm2 or systemd)" >&2
  exit 1
fi
echo "[vps] deploy success"
EOF
)

echo "[deploy] running remote deployment over ssh"
ssh "${VPS_HOST}" "${REMOTE_CMD}"

echo "[deploy] verifying remote health from local machine (${REMOTE_HEALTH_BASE_URL})"
OK=0
REMOTE_HEALTH_BODY=""
for i in {1..20}; do
  if REMOTE_HEALTH_BODY="$(curl -fsS "${REMOTE_HEALTH_BASE_URL}/health")" \
     && curl -fsS "${REMOTE_HEALTH_BASE_URL}/mt5/health" >/dev/null; then
    OK=1
    break
  fi
  sleep 2
done

if [[ "${OK}" != "1" ]]; then
  echo "[deploy] remote health check failed: ${REMOTE_HEALTH_BASE_URL}" >&2
  exit 1
fi

REMOTE_SERVER_VERSION="$(printf '%s\n' "${REMOTE_HEALTH_BODY}" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1)"

echo "[deploy] done"
echo "[deploy] build versions:"
echo "[deploy]   local SERVER_VERSION=${LOCAL_SERVER_VERSION:-unknown}"
echo "[deploy]   local EA_BUILD_VERSION=${LOCAL_EA_BUILD_VERSION:-unknown}"
echo "[deploy]   remote /health version=${REMOTE_SERVER_VERSION:-unknown}"
