#!/usr/bin/env bash
set -euo pipefail

# Deploy one git branch to isolated staging runtime on VPS.
# This script does NOT touch main/prod process by default.
#
# Example:
#   BRANCH=feature/chart-objects STAGING_PORT=18081 \
#   VPS_HOST=root@139.59.211.192 bash scripts/deploy/deploy_branch_staging.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

BRANCH="${BRANCH:-}"
if [[ -z "${BRANCH}" ]]; then
  echo "[staging] BRANCH is required" >&2
  exit 1
fi

VPS_HOST="${VPS_HOST:-root@139.59.211.192}"
VPS_ROOT_DIR="${VPS_ROOT_DIR:-/opt}"
REPO_URL="${REPO_URL:-https://github.com/hunghoxuan/trading.git}"
STAGING_PORT="${STAGING_PORT:-18080}"
STAGING_NAME="${STAGING_NAME:-$(echo "${BRANCH}" | tr '/._' '-' | tr -cd '[:alnum:]-' | tr '[:upper:]' '[:lower:]')}"
VPS_APP_DIR="${VPS_APP_DIR:-${VPS_ROOT_DIR}/trading-staging-${STAGING_NAME}}"
PM2_NAME="${PM2_NAME:-src/api-${STAGING_NAME}}"
HEALTH_PATH="${HEALTH_PATH:-/health}"

echo "[staging] root=${ROOT_DIR}"
echo "[staging] branch=${BRANCH}"
echo "[staging] host=${VPS_HOST}"
echo "[staging] app_dir=${VPS_APP_DIR}"
echo "[staging] pm2_name=${PM2_NAME}"
echo "[staging] port=${STAGING_PORT}"

cd "${ROOT_DIR}"

echo "[staging] ensure branch exists on origin"
git fetch origin "${BRANCH}:${BRANCH}" >/dev/null 2>&1 || true
if ! git ls-remote --exit-code --heads origin "${BRANCH}" >/dev/null 2>&1; then
  echo "[staging] branch not found on origin: ${BRANCH}" >&2
  exit 1
fi

echo "[staging] push local branch tip to origin/${BRANCH} (if local exists)"
if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  git push origin "${BRANCH}"
fi

REMOTE_CMD=$(cat <<EOF
set -euo pipefail

mkdir -p "${VPS_ROOT_DIR}"
if [[ ! -d "${VPS_APP_DIR}/.git" ]]; then
  echo "[vps-staging] clone fresh repo into ${VPS_APP_DIR}"
  git clone "${REPO_URL}" "${VPS_APP_DIR}"
fi

cd "${VPS_APP_DIR}"
git fetch --all --prune
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

node --check src/api/server.js
corepack pnpm install --frozen-lockfile

if [[ -d "src/admin" ]]; then
  corepack pnpm --dir src/admin run build
fi

if pm2 describe "${PM2_NAME}" >/dev/null 2>&1; then
  echo "[vps-staging] restart ${PM2_NAME}"
  PORT="${STAGING_PORT}" NODE_ENV=staging BRANCH_NAME="${BRANCH}" pm2 restart "${PM2_NAME}" --update-env
else
  echo "[vps-staging] start ${PM2_NAME}"
  PORT="${STAGING_PORT}" NODE_ENV=staging BRANCH_NAME="${BRANCH}" pm2 start src/api/server.js --name "${PM2_NAME}" --cwd "${VPS_APP_DIR}" --time
fi

pm2 save >/dev/null 2>&1 || true
sleep 2
curl -fsS "http://127.0.0.1:${STAGING_PORT}${HEALTH_PATH}" >/dev/null
echo "[vps-staging] OK http://127.0.0.1:${STAGING_PORT}${HEALTH_PATH}"
EOF
)

echo "[staging] run remote deploy"
ssh "${VPS_HOST}" "${REMOTE_CMD}"

echo "[staging] done"
echo "[staging] branch=${BRANCH}"
echo "[staging] pm2=${PM2_NAME}"
echo "[staging] local-check-url=http://127.0.0.1:${STAGING_PORT}${HEALTH_PATH} (on VPS)"
