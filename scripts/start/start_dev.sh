#!/usr/bin/env bash
# =============================================================================
# start_dev.sh — Run admin :3000 + api :3001 locally.
# =============================================================================
# - Starts api :3001 only when no healthy API is already running.
# - Keeps admin :3000 in the foreground with HMR.
# - Keeps mt5-python-bridge :3002 in the foreground for local development.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
API_START_SCRIPT="${ROOT}/scripts/start/start_api.sh"
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
      echo "[dev] force mode: terminating existing owner pid=${owner_pid}"
      kill "${owner_pid}" 2>/dev/null || true
      sleep 1
      kill -9 "${owner_pid}" 2>/dev/null || true
      rm -rf "${LOCK_DIR}" 2>/dev/null || true
      mkdir "${LOCK_DIR}" 2>/dev/null || true
      echo "$$" > "${LOCK_PID_FILE}"
      return 0
    fi
    echo "[dev] another start_dev.sh is already running (pid=${owner_pid}), skip"
    echo "[dev] if server is down, run: bash scripts/start/start_dev.sh --force"
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

WEB_UI_DIR="${ROOT}/src/admin"
MT5_PYTHON_BRIDGE_DIR="${ROOT}/src/mt5-bridge/python"
VITE_PORT=3000
API_PORT=3001
MT5_PYTHON_BRIDGE_PORT=3002
VITE_ALLOWED_HOSTS="${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}"
MT5_PYTHON_BRIDGE_ENABLED="${MT5_PYTHON_BRIDGE_ENABLED:-1}"

cleanup() {
  echo "[dev] shutting down..."
  kill "${MT5_PYTHON_BRIDGE_PID:-}" 2>/dev/null || true
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

api_healthy() {
  /usr/bin/curl -fsS --max-time 2 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1
}

start_mt5_python_bridge() {
  if [ "${MT5_PYTHON_BRIDGE_ENABLED}" != "1" ]; then
    echo "[dev] mt5-python-bridge disabled"
    MT5_PYTHON_BRIDGE_PID=
    return
  fi
  free_port "${MT5_PYTHON_BRIDGE_PORT}"
  echo "[dev] starting mt5-python-bridge on :${MT5_PYTHON_BRIDGE_PORT}..."
  MT5_BRIDGE_PORT="${MT5_PYTHON_BRIDGE_PORT}" \
    python3 "${MT5_PYTHON_BRIDGE_DIR}/main.py" &
  MT5_PYTHON_BRIDGE_PID=$!
}

start_api() {
  local mt5_enabled="true"
  local mt5_storage="${MT5_STORAGE:-postgres}"
  if [ "${mt5_storage}" = "postgres" ] && ! nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
    mt5_enabled="false"
    echo "[dev] postgres :5432 unavailable -> starting src/api with MT5_ENABLED=false"
  fi
  if api_healthy; then
    echo "[dev] healthy src/api already running on :${API_PORT}, skipping API start"
    return
  fi
  echo "[dev] starting src/api on :${API_PORT} via start_api.sh launchctl..."
  env \
    PORT="${API_PORT}" \
    BARS_STORAGE_PROVIDER="${BARS_STORAGE_PROVIDER:-parquet_duckdb}" \
    BARS_DUCKDB_PATH="${BARS_DUCKDB_PATH:-${ROOT}/data/bars.duckdb}" \
    MT5_STORAGE="${mt5_storage}" \
    REMOTE_DB_AUTO_TUNNEL=1 \
    MT5_REMOTE_DB_SSH_HOST="${MT5_REMOTE_DB_SSH_HOST:-root@139.59.211.192}" \
    MT5_REMOTE_DB_LOCAL_PORT="${MT5_REMOTE_DB_LOCAL_PORT:-15432}" \
    MT5_ENABLED="${mt5_enabled}" \
    SNAPSHOTS_CRON_ENABLED=0 \
    MARKET_DATA_CRON_ENABLED=0 \
    bash "${API_START_SCRIPT}" launchctl
}

start_admin() {
  if port_in_use "${VITE_PORT}"; then
    echo "[dev] port ${VITE_PORT} already in use, skipping admin start"
    VITE_PID=
    return
  fi
  free_port "${VITE_PORT}"
  echo "[dev] starting admin on :${VITE_PORT}..."
  if [ -n "${VITE_ALLOWED_HOSTS}" ]; then
    (cd "${WEB_UI_DIR}" && VITE_API_PROXY_TARGET="http://127.0.0.1:${API_PORT}" VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS}" __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS}" npx vite --host 127.0.0.1 --port "${VITE_PORT}" --strictPort) &
  else
    (cd "${WEB_UI_DIR}" && VITE_API_PROXY_TARGET="http://127.0.0.1:${API_PORT}" npx vite --host 127.0.0.1 --port "${VITE_PORT}" --strictPort) &
  fi
  VITE_PID=$!
}

start_mt5_python_bridge
start_api
start_admin

echo ""
echo "  open:     http://localhost:${VITE_PORT}"
echo "  backend:  http://localhost:${API_PORT}"
echo "  mt5-py:   http://localhost:${MT5_PYTHON_BRIDGE_PORT}"
echo ""

while true; do
  if [ -n "${MT5_PYTHON_BRIDGE_PID:-}" ] && ! kill -0 "${MT5_PYTHON_BRIDGE_PID}" 2>/dev/null; then
    wait "${MT5_PYTHON_BRIDGE_PID}" 2>/dev/null || true
    echo "[dev] mt5-python-bridge exited. dev mode will not auto-restart."
    exit 1
  fi
  if [ -n "${VITE_PID:-}" ] && ! kill -0 "${VITE_PID}" 2>/dev/null; then
    wait "${VITE_PID}" 2>/dev/null || true
    echo "[dev] admin exited. dev mode will not auto-restart."
    exit 1
  fi
  sleep 1
done
