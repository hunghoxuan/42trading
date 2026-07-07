#!/usr/bin/env bash
# =============================================================================
# start_admin.sh — Admin Vite server on :3000, with foreground/background/launchctl modes.
# =============================================================================
set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_UI_DIR="${ROOT}/src/admin"
VITE_BIN="${WEB_UI_DIR}/node_modules/.bin/vite"
PORT="${PORT:-3000}"
API_PORT="${API_PORT:-3001}"
LOG_FILE="${LOG_FILE:-/tmp/trading-web-ui-local.log}"
LABEL="${LABEL:-trading-web-ui-local}"
LAUNCH_AGENT_LABEL="${LAUNCH_AGENT_LABEL:-com.trading.web-ui.local}"
LAUNCH_AGENTS_DIR="${HOME}/Library/LaunchAgents"
LAUNCH_AGENT_PLIST="${LAUNCH_AGENT_PLIST:-${LAUNCH_AGENTS_DIR}/${LAUNCH_AGENT_LABEL}.plist}"
MODE="${1:-foreground}" # foreground | background | launchctl | serve
FORCE=0
if [ "${2:-}" = "--force" ] || [ "${1:-}" = "--force" ]; then
  FORCE=1
  if [ "${MODE}" = "--force" ]; then
    MODE="foreground"
  fi
fi

admin_url() {
  printf "http://127.0.0.1:%s/" "${PORT}"
}

port_pids() {
  lsof -ti "tcp:${PORT}" 2>/dev/null || true
}

port_in_use() {
  [ -n "$(port_pids)" ]
}

admin_healthy() {
  /usr/bin/curl -fsS --max-time 2 "$(admin_url)" >/dev/null 2>&1
}

kill_port_owner() {
  local pids
  pids="$(port_pids)"
  if [ -z "${pids}" ]; then
    return 0
  fi
  echo "[src/admin] force-killing port ${PORT}: pids=${pids}"
  echo "${pids}" | xargs kill -9 2>/dev/null || true
  sleep 1
}

ensure_admin_slot() {
  if admin_healthy; then
    if [ "${FORCE}" = "1" ]; then
      kill_port_owner
      return 0
    fi
    echo "[src/admin] healthy admin already running on :${PORT}; skipping start"
    return 10
  fi
  if port_in_use; then
    local pids
    pids="$(port_pids)"
    if [ "${FORCE}" = "1" ]; then
      kill_port_owner
      return 0
    fi
    echo "[src/admin] port ${PORT} already in use by pid(s): ${pids}"
    echo "[src/admin] refusing to kill existing owner without --force"
    return 20
  fi
  return 0
}

run_server() {
  if [ ! -x "${VITE_BIN}" ]; then
    echo "[src/admin] missing Vite binary at ${VITE_BIN}"
    echo "[src/admin] run pnpm install or npm install in src/admin first"
    exit 1
  fi
  echo "[src/admin] starting on :${PORT} (api proxy :${API_PORT})"
  cd "${WEB_UI_DIR}"
  exec env \
    VITE_API_PROXY_TARGET="http://127.0.0.1:${API_PORT}" \
    VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}" \
    __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}" \
    "${VITE_BIN}" --host 127.0.0.1 --port "${PORT}" --strictPort
}

start_background() {
  ensure_admin_slot || {
    local code="$?"
    [ "${code}" = "10" ] && return 0
    return "${code}"
  }
  if [ "${FORCE}" = "1" ]; then
    nohup env PORT="${PORT}" API_PORT="${API_PORT}" LOG_FILE="${LOG_FILE}" LABEL="${LABEL}" \
      bash "${ROOT}/scripts/start/start_admin.sh" serve --force >> "${LOG_FILE}" 2>&1 &
  else
    nohup env PORT="${PORT}" API_PORT="${API_PORT}" LOG_FILE="${LOG_FILE}" LABEL="${LABEL}" \
      bash "${ROOT}/scripts/start/start_admin.sh" serve >> "${LOG_FILE}" 2>&1 &
  fi
  echo "[ok] admin background start requested port=${PORT} log=${LOG_FILE}"
}

write_launch_agent_plist() {
  if [ ! -x "${VITE_BIN}" ]; then
    echo "[src/admin] missing Vite binary at ${VITE_BIN}"
    echo "[src/admin] run pnpm install or npm install in src/admin first"
    exit 1
  fi
  mkdir -p "${LAUNCH_AGENTS_DIR}"
  cat > "${LAUNCH_AGENT_PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${VITE_BIN}</string>
    <string>--host</string>
    <string>127.0.0.1</string>
    <string>--port</string>
    <string>${PORT}</string>
    <string>--strictPort</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key>
    <string>${PORT}</string>
    <key>API_PORT</key>
    <string>${API_PORT}</string>
    <key>LOG_FILE</key>
    <string>${LOG_FILE}</string>
    <key>LABEL</key>
    <string>${LABEL}</string>
    <key>VITE_API_PROXY_TARGET</key>
    <string>http://127.0.0.1:${API_PORT}</string>
    <key>VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS</key>
    <string>${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}</string>
    <key>__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS</key>
    <string>${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>WorkingDirectory</key>
  <string>${WEB_UI_DIR}</string>
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
EOF
  chmod 644 "${LAUNCH_AGENT_PLIST}"
}

start_launchctl() {
  ensure_admin_slot || {
    local code="$?"
    [ "${code}" = "10" ] && return 0
    return "${code}"
  }
  write_launch_agent_plist
  launchctl remove "${LABEL}" 2>/dev/null || true
  launchctl bootout "gui/$(id -u)/${LAUNCH_AGENT_LABEL}" 2>/dev/null || true
  launchctl unload "${LAUNCH_AGENT_PLIST}" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "${LAUNCH_AGENT_PLIST}" 2>/dev/null || \
    launchctl load "${LAUNCH_AGENT_PLIST}"
  echo "[ok] admin launchctl start requested label=${LAUNCH_AGENT_LABEL} port=${PORT} log=${LOG_FILE} plist=${LAUNCH_AGENT_PLIST}"
}

case "${MODE}" in
  foreground|serve)
    ensure_admin_slot || {
      code="$?"
      [ "${code}" = "10" ] && exit 0
      exit "${code}"
    }
    run_server
    ;;
  background|manual)
    start_background
    ;;
  launchctl)
    start_launchctl
    ;;
  *)
    echo "usage: bash scripts/start/start_admin.sh [foreground|background|launchctl] [--force]"
    exit 1
    ;;
esac
