#!/usr/bin/env bash
# =============================================================================
# start_local.sh — Run Vite :3000 + webhook :3001 locally, auto-restart on crash
# =============================================================================
# - Self-healing: if launchd plist is missing, reinstalls it automatically.
# - Kills stale ports on first start only.
# - If port is already in use by a healthy process, skips starting.
# - Monitor loop restarts webhook on crash, but NOT Vite (it hot-reloads).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PLIST_SRC="${ROOT}/scripts/install/com.trading.bot.local.plist"
PLIST_DEST="${HOME}/Library/LaunchAgents/com.trading.bot.local.plist"
LABEL="com.trading.bot.local"

# ── Self-healing: ensure launchd service is installed and running ──
if [ ! -f "${PLIST_DEST}" ]; then
  echo "[local] launchd plist not found — reinstalling..."
  bash "${ROOT}/scripts/install/install_local_autostart.sh"
elif ! launchctl list "${LABEL}" &>/dev/null; then
  echo "[local] launchd service not running — starting..."
  launchctl kickstart "gui/$(id -u)/${LABEL}" 2>/dev/null || \
    bash "${ROOT}/scripts/install/install_local_autostart.sh"
fi

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
    while lsof -ti "tcp:${port}" 2>/dev/null; do sleep 1; done
  fi
}

port_in_use() {
  lsof -ti "tcp:$1" 2>/dev/null && return 0 || return 1
}

start_webhook() {
  local kill_first="${1:-yes}"
  [ "$kill_first" = "yes" ] && free_port "${WEBHOOK_PORT}"
  echo "[local] starting webhook on :${WEBHOOK_PORT}..."
  PORT="${WEBHOOK_PORT}" node --watch "${WEBHOOK_DIR}/server.js" &
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
  (cd "${WEB_UI_DIR}" && VITE_API_PROXY_TARGET="http://127.0.0.1:${WEBHOOK_PORT}" npx vite --port "${VITE_PORT}" --strictPort) &
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

# Monitor — only restart webhook on crash. Vite hot-reloads, never restart it.
while true; do
  if ! kill -0 "${WEBHOOK_PID}" 2>/dev/null; then
    echo "[local] webhook died, restarting..."
    start_webhook no
  fi
  sleep 5
done
