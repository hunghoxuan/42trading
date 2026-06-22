#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-3001}"
LOG_FILE="${LOG_FILE:-/tmp/trading-webhook-local.log}"
MODE="${1:-manual}" # manual | launchctl
LABEL="trading-webhook-local"
VERIFY_SCRIPT="${ROOT}/tests/verify_webhook_local.sh"

start_launchctl() {
  launchctl remove "${LABEL}" 2>/dev/null || true
  launchctl submit -l "${LABEL}" -- /bin/zsh -lc "cd ${ROOT} && PORT=${PORT} bash ${ROOT}/scripts/start/start_webhook.sh >> ${LOG_FILE} 2>&1"
}

start_manual() {
  local pids
  pids="$(lsof -ti "tcp:${PORT}" 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "${pids}" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
  nohup env PORT="${PORT}" bash "${ROOT}/scripts/start/start_webhook.sh" >> "${LOG_FILE}" 2>&1 &
}

if [ "${MODE}" = "launchctl" ]; then
  start_launchctl
elif [ "${MODE}" = "manual" ]; then
  start_manual
else
  echo "usage: bash scripts/start/restart_webhook.sh [launchctl|manual]"
  exit 1
fi

echo "[ok] restart requested mode=${MODE} port=${PORT} log=${LOG_FILE}"
bash "${VERIFY_SCRIPT}"
