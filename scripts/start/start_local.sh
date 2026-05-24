#!/usr/bin/env bash
# =============================================================================
# start_local.sh — Run Vite :3000 + webhook :3001 locally (manual mode)
# =============================================================================
# - Self-healing: if launchd plist is missing, reinstalls it automatically.
# - Kills stale ports on first start only.
# - If port is already in use by a healthy process, skips starting.
# - No supervisor loop: if webhook/vite dies, script exits and reports it.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST_SRC="${ROOT}/scripts/install/com.trading.bot.local.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/com.trading.bot.local.plist"
LABEL="com.trading.bot.local"
LOCK_DIR="/tmp/com.trading.bot.local.lock"
LOCK_PID_FILE="${LOCK_DIR}/pid"
FORCE_RECLAIM=0
if [ "${1:-}" = "--force" ]; then
  FORCE_RECLAIM=1
fi

acquire_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    echo "$$" > "${LOCK_PID_FILE}"
    return 0
  fi
  local owner_pid=""
  owner_pid="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
  if [ -n "${owner_pid}" ] && kill -0 "${owner_pid}" 2>/dev/null; then
    if [ "${FORCE_RECLAIM}" = "1" ]; then
      echo "[local] force mode: terminating existing owner pid=${owner_pid}"
      kill "${owner_pid}" 2>/dev/null || true
      sleep 1
      kill -9 "${owner_pid}" 2>/dev/null || true
      rm -rf "${LOCK_DIR}" 2>/dev/null || true
      mkdir "${LOCK_DIR}" 2>/dev/null || true
      echo "$$" > "${LOCK_PID_FILE}"
      return 0
    fi
    echo "[local] another start_local.sh is already running (pid=${owner_pid}), skip"
    echo "[local] if server is down, run: bash scripts/start/start_local.sh --force"
    exit 0
  fi
  rm -rf "${LOCK_DIR}" 2>/dev/null || true
  mkdir "${LOCK_DIR}" 2>/dev/null || true
  echo "$$" > "${LOCK_PID_FILE}"
}

release_lock() {
  local owner_pid=""
  owner_pid="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
  if [ "${owner_pid}" = "$$" ]; then
    rm -rf "${LOCK_DIR}" 2>/dev/null || true
  fi
}

acquire_lock

# Do not self-bootout via launchctl from inside this script.
# `XPC_SERVICE_NAME` is not a reliable discriminator for launchd context and
# can trigger accidental self-termination loops. Single-instance ownership is
# handled by LOCK_DIR/LOCK_PID_FILE above.

WEBHOOK_DIR="${ROOT}/webhook"
WEB_UI_DIR="${ROOT}/web-ui"
VITE_PORT=3000
WEBHOOK_PORT=3001

cleanup() {
  echo "[local] shutting down..."
  kill "${WEBHOOK_PID:-}" 2>/dev/null || true
  kill "${VITE_PID:-}" 2>/dev/null || true
  wait 2>/dev/null || true
  release_lock
}
trap cleanup EXIT INT TERM

free_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti "tcp:${port}" 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "${pids}" | xargs kill -9 2>/dev/null || true
    while lsof -ti "tcp:${port}" 2>/dev/null; do sleep 1; done
  fi
}

port_in_use() {
  lsof -ti "tcp:$1" >/dev/null 2>&1 && return 0 || return 1
}

start_webhook() {
  # Kill dev watchers that can respawn webhook and fight for :3001
  pkill -f "node --watch .*webhook/server.js" 2>/dev/null || true
  pkill -f "nodemon .*webhook/server.js" 2>/dev/null || true
  # Always free the port first before starting
  free_port "${WEBHOOK_PORT}"
  local mt5_enabled="true"
  if ! nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
    mt5_enabled="false"
    echo "[local] postgres :5432 unavailable -> starting webhook with MT5_ENABLED=false"
  fi
  echo "[local] starting webhook on :${WEBHOOK_PORT}..."
  PORT="${WEBHOOK_PORT}" \
    MT5_ENABLED="${mt5_enabled}" \
    SNAPSHOTS_CRON_ENABLED=0 \
    MARKET_DATA_CRON_ENABLED=0 \
    node "${WEBHOOK_DIR}/server.js" &
  WEBHOOK_PID=$!
}

start_vite() {
  # If port already in use by a healthy process, skip — don't touch it
  if port_in_use "${VITE_PORT}"; then
    echo "[local] port ${VITE_PORT} already in use, skipping Vite start"
    VITE_PID=
    return
  fi
  local kill_first="${1:-yes}"
  [ "$kill_first" = "yes" ] && free_port "${VITE_PORT}"
  echo "[local] starting Vite on :${VITE_PORT}..."
  (cd "${WEB_UI_DIR}" && VITE_API_PROXY_TARGET="http://127.0.0.1:${WEBHOOK_PORT}" npx vite --host 127.0.0.1 --port "${VITE_PORT}" --strictPort) &
  VITE_PID=$!
}

# Initial start
start_webhook yes
sleep 2
start_vite yes

echo ""
echo "  open:     http://localhost:${VITE_PORT}"
echo "  backend:  http://localhost:${WEBHOOK_PORT}"
echo ""

# Manual mode: keep foreground attached and exit on first child death.
while true; do
  if ! kill -0 "${WEBHOOK_PID}" 2>/dev/null; then
    wait "${WEBHOOK_PID}" 2>/dev/null || true
    echo "[local] webhook exited. manual mode will not auto-restart."
    exit 1
  fi
  if [ -n "${VITE_PID:-}" ] && ! kill -0 "${VITE_PID}" 2>/dev/null; then
    wait "${VITE_PID}" 2>/dev/null || true
    echo "[local] vite exited. manual mode will not auto-restart."
    exit 1
  fi
  sleep 1
done
