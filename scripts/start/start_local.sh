#!/usr/bin/env bash
# =============================================================================
# start_local.sh — Run Vite :3000 + webhook :3001 locally, auto-restart on crash
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEBHOOK_DIR="${ROOT}/webhook"
WEB_UI_DIR="${ROOT}/web-ui"
VITE_PORT=3000
WEBHOOK_PORT=3001

cleanup() {
  echo "[local] shutting down..."
  kill "${WEBHOOK_PID:-}" 2>/dev/null || true
  kill "${VITE_PID:-}" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "${pids}" | xargs kill -9 2>/dev/null || true
    # Wait until port is actually free (OS may hold it after kill)
    while lsof -ti "tcp:${port}" 2>/dev/null; do
      sleep 1
    done
  fi
}

start_webhook() {
  free_port "${WEBHOOK_PORT}"
  echo "[local] starting webhook on :${WEBHOOK_PORT}..."
  PORT="${WEBHOOK_PORT}" node --watch "${WEBHOOK_DIR}/server.js" &
  WEBHOOK_PID=$!
}

start_vite() {
  free_port "${VITE_PORT}"
  echo "[local] starting Vite on :${VITE_PORT}..."
  (cd "${WEB_UI_DIR}" && VITE_API_PROXY_TARGET="http://127.0.0.1:${WEBHOOK_PORT}" npx vite --port "${VITE_PORT}" --strictPort) &
  VITE_PID=$!
}

# Initial start
start_webhook
sleep 2
start_vite

echo ""
echo "  open:     http://localhost:${VITE_PORT}"
echo "  backend:  http://localhost:${WEBHOOK_PORT}"
echo ""

# Monitor and restart on crash — kills port first to avoid EADDRINUSE
while true; do
  if ! kill -0 "${WEBHOOK_PID}" 2>/dev/null; then
    echo "[local] webhook died, restarting..."
    start_webhook
  fi
  if ! kill -0 "${VITE_PID}" 2>/dev/null; then
    echo "[local] Vite died, restarting..."
    start_vite
  fi
  sleep 5
done
