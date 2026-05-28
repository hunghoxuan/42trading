#!/usr/bin/env bash
# =============================================================================
# start_webhook.sh — Webhook server only, managed by launchd.
# =============================================================================
# Auto-restarting via launchd KeepAlive. Independent of web-ui (vite).
# Broker clients depend on this — must survive independently.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-3001}"

# Kill any stale process on the port
free_port() {
  local pids
  pids="$(lsof -ti "tcp:${1}" 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "[webhook] killing stale port ${1}: pids=${pids}"
    echo "${pids}" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

# Check postgres
mt5_enabled="true"
if ! nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
  mt5_enabled="false"
  echo "[webhook] postgres :5432 unavailable → starting with MT5_ENABLED=false"
fi

free_port "${PORT}"

echo "[webhook] starting on :${PORT} (MT5_ENABLED=${mt5_enabled})"
exec env PORT="${PORT}" \
  MT5_ENABLED="${mt5_enabled}" \
  SNAPSHOTS_CRON_ENABLED=0 \
  MARKET_DATA_CRON_ENABLED=0 \
  node "${ROOT}/webhook/server.js"
