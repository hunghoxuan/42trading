#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VPS_HOST="${VPS_HOST:-root@139.59.211.192}"
REMOTE_APP_DIR="${REMOTE_APP_DIR:-/opt/trading}"
REMOTE_SCRIPT_PATH="${REMOTE_APP_DIR}/scripts/daemons/ctrader_executor_bridge.js"
REMOTE_ENV_PATH="${REMOTE_APP_DIR}/scripts/daemons/ctrader_executor_bridge.env"
PM2_NAME="${PM2_NAME:-ctrader-executor}"
PORT="${CTRADER_EXECUTOR_PORT:-8099}"
API_KEY="${CTRADER_EXECUTOR_API_KEY:-}"

if [[ -z "${API_KEY}" ]]; then
  API_KEY="$(openssl rand -hex 24)"
  echo "[install] generated CTRADER_EXECUTOR_API_KEY=${API_KEY}"
fi

echo "[install] uploading bridge script to ${VPS_HOST}:${REMOTE_SCRIPT_PATH}"
cat "${ROOT_DIR}/scripts/daemons/ctrader_executor_bridge.js" \
  | ssh "${VPS_HOST}" "cat > '${REMOTE_SCRIPT_PATH}' && chmod +x '${REMOTE_SCRIPT_PATH}'"

echo "[install] writing env file ${REMOTE_ENV_PATH}"
ssh "${VPS_HOST}" "cat > '${REMOTE_ENV_PATH}' <<'EOF'
CTRADER_EXECUTOR_PORT=${PORT}
CTRADER_EXECUTOR_API_KEY=${API_KEY}
CTRADER_MODE=demo
CTRADER_ACCOUNT_ID=
CTRADER_ACCOUNT_NUMBER=
CTRADER_ACCOUNT_API_KEY=
CTRADER_BROKER_BASE_URL=https://127.0.0.1
CTRADER_BROKER_POLL_MS=2000
CTRADER_BROKER_PULL_MAX_ITEMS=5
CTRADER_DOWNSTREAM_URL=
CTRADER_DOWNSTREAM_API_KEY=
CTRADER_CLIENT_ID=
CTRADER_CLIENT_SECRET=
CTRADER_ACCESS_TOKEN=
CTRADER_REFRESH_TOKEN=
EOF"

echo "[install] starting pm2 process ${PM2_NAME}"
ssh "${VPS_HOST}" "set -euo pipefail
pm2 delete '${PM2_NAME}' >/dev/null 2>&1 || true
set -a; source '${REMOTE_ENV_PATH}'; set +a
pm2 start '${REMOTE_SCRIPT_PATH}' --name '${PM2_NAME}' --update-env
pm2 save
pm2 describe '${PM2_NAME}' | sed -n '1,120p'
"

echo "[install] done"
echo "[install] next:"
echo "  1) Set webhook env:"
echo "     CTRADER_MODE=demo"
echo "     CTRADER_EXECUTOR_URL=http://127.0.0.1:${PORT}/execute"
echo "     CTRADER_EXECUTOR_API_KEY=${API_KEY}"
echo "     CTRADER_ACCOUNT_API_KEY=<account-api-key-for-/api/broker/pull>"
echo "  2) Restart webhook: pm2 restart webhook"
