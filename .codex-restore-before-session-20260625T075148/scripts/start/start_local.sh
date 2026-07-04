#!/usr/bin/env bash
# =============================================================================
# start_local.sh — Run Vite :3000 + src/api :3001 locally (manual mode)
# =============================================================================
# - Self-healing: if launchd plist is missing, reinstalls it automatically.
# - Kills stale ports on first start only.
# - If port is already in use by a healthy process, skips starting.
# - No supervisor loop: if src/api/vite dies, script exits and reports it.
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

WEB_API_DIR="${ROOT}/src/api"
WEB_UI_DIR="${ROOT}/src/admin"
MT5_PYTHON_BRIDGE_DIR="${ROOT}/src/mt5-bridge/python"
VITE_PORT=3000
WEBHOOK_PORT=3001
MT5_PYTHON_BRIDGE_PORT=3002
VITE_ALLOWED_HOSTS="${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}"
MT5_PYTHON_BRIDGE_ENABLED="${MT5_PYTHON_BRIDGE_ENABLED:-1}"

cleanup() {
  echo "[local] shutting down..."
  kill "${MT5_PYTHON_BRIDGE_PID:-}" 2>/dev/null || true
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

start_mt5_python_bridge() {
  if [ "${MT5_PYTHON_BRIDGE_ENABLED}" != "1" ]; then
    echo "[local] mt5-python-bridge disabled"
    MT5_PYTHON_BRIDGE_PID=
    return
  fi
  free_port "${MT5_PYTHON_BRIDGE_PORT}"
  echo "[local] starting mt5-python-bridge on :${MT5_PYTHON_BRIDGE_PORT}..."
  MT5_BRIDGE_PORT="${MT5_PYTHON_BRIDGE_PORT}" \
    python3 "${MT5_PYTHON_BRIDGE_DIR}/main.py" &
  MT5_PYTHON_BRIDGE_PID=$!
}

start_webhook() {
  # Kill dev watchers that can respawn src/api and fight for :3001
  pkill -f "node --watch .*src/api/server.js" 2>/dev/null || true
  pkill -f "nodemon .*src/api/server.js" 2>/dev/null || true
  pkill -f "node .*src/api/server.js" 2>/dev/null || true
  launchctl remove trading-web-api-raw 2>/dev/null || true
  # Always free the port first before starting
  free_port "${WEBHOOK_PORT}"
  local mt5_enabled="true"
  local mt5_storage="${MT5_STORAGE:-sqlite}"
  if [ "${mt5_storage}" = "postgres" ] && ! nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
    mt5_enabled="false"
    echo "[local] postgres :5432 unavailable -> starting src/api with MT5_ENABLED=false"
  fi
  echo "[local] starting src/api on :${WEBHOOK_PORT}..."
  PORT="${WEBHOOK_PORT}" \
    BARS_STORAGE_PROVIDER="${BARS_STORAGE_PROVIDER:-parquet_duckdb}" \
    BARS_DUCKDB_PATH="${BARS_DUCKDB_PATH:-${ROOT}/data/bars.duckdb}" \
    MT5_STORAGE="${mt5_storage}" \
    REMOTE_DB_AUTO_TUNNEL=1 \
    MT5_REMOTE_DB_SSH_HOST="${MT5_REMOTE_DB_SSH_HOST:-root@139.59.211.192}" \
    MT5_REMOTE_DB_LOCAL_PORT="${MT5_REMOTE_DB_LOCAL_PORT:-15432}" \
    MT5_ENABLED="${mt5_enabled}" \
    APP_ROLE="${APP_ROLE:-web}" \
    AUTOMATION_PROVIDER="${AUTOMATION_PROVIDER:-bullmq}" \
    RUNTIME_STRICT_PROCESS_GUARD="${RUNTIME_STRICT_PROCESS_GUARD:-1}" \
    RUNTIME_FOLLOWER_POLICY="${RUNTIME_FOLLOWER_POLICY:-exit}" \
    SNAPSHOTS_CRON_ENABLED=0 \
    MARKET_DATA_CRON_ENABLED=0 \
    node --watch "${WEB_API_DIR}/server.js" &
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
  if [ -n "${VITE_ALLOWED_HOSTS}" ]; then
    (cd "${WEB_UI_DIR}" && VITE_API_PROXY_TARGET="http://127.0.0.1:${WEBHOOK_PORT}" VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS}" __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS}" npx vite --host 127.0.0.1 --port "${VITE_PORT}" --strictPort) &
  else
    (cd "${WEB_UI_DIR}" && VITE_API_PROXY_TARGET="http://127.0.0.1:${WEBHOOK_PORT}" npx vite --host 127.0.0.1 --port "${VITE_PORT}" --strictPort) &
  fi
  VITE_PID=$!
}

# Initial start
start_mt5_python_bridge
start_webhook yes
sleep 2
start_vite yes

echo ""
echo "  open:     http://localhost:${VITE_PORT}"
echo "  backend:  http://localhost:${WEBHOOK_PORT}"
echo "  mt5-py:   http://localhost:${MT5_PYTHON_BRIDGE_PORT}"
echo ""

# Manual mode: keep foreground attached and exit on first child death.
while true; do
  if [ -n "${MT5_PYTHON_BRIDGE_PID:-}" ] && ! kill -0 "${MT5_PYTHON_BRIDGE_PID}" 2>/dev/null; then
    wait "${MT5_PYTHON_BRIDGE_PID}" 2>/dev/null || true
    echo "[local] mt5-python-bridge exited. manual mode will not auto-restart."
    exit 1
  fi
  if ! kill -0 "${WEBHOOK_PID}" 2>/dev/null; then
    wait "${WEBHOOK_PID}" 2>/dev/null || true
    echo "[local] src/api exited. manual mode will not auto-restart."
    exit 1
  fi
  if [ -n "${VITE_PID:-}" ] && ! kill -0 "${VITE_PID}" 2>/dev/null; then
    wait "${VITE_PID}" 2>/dev/null || true
    echo "[local] vite exited. manual mode will not auto-restart."
    exit 1
  fi
  sleep 1
done
