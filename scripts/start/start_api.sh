#!/usr/bin/env bash
# =============================================================================
# start_api.sh — API server on :3001, with optional background/launchctl modes.
# =============================================================================
set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WEB_API_ENTRY="${ROOT}/src/api/app/server.js"
ENV_FILE="${ENV_FILE:-${ROOT}/src/api/.env}"
NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
PORT="${PORT:-3001}"
LOG_FILE="${LOG_FILE:-/tmp/trading-webhook-local.log}"
LABEL="${LABEL:-trading-webhook-local}"
LAUNCH_AGENT_LABEL="${LAUNCH_AGENT_LABEL:-com.trading.web-api.local}"
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

load_env_file() {
  if [ ! -f "${ENV_FILE}" ]; then
    return 0
  fi
  while IFS= read -r line || [ -n "${line}" ]; do
    case "${line}" in
      ''|\#*) continue ;;
    esac
    if [[ "${line}" != *=* ]]; then
      continue
    fi
    local key="${line%%=*}"
    local value="${line#*=}"
    key="$(printf '%s' "${key}" | sed 's/[[:space:]]*$//')"
    value="$(printf '%s' "${value}" | sed 's/^[[:space:]]*//')"
    export "${key}=${value}"
  done < "${ENV_FILE}"
}

load_env_file

health_url() {
  printf "http://127.0.0.1:%s/health" "${PORT}"
}

port_pids() {
  lsof -ti "tcp:${PORT}" 2>/dev/null || true
}

server_pids() {
  pgrep -f "node ${WEB_API_ENTRY}" 2>/dev/null || true
}

port_in_use() {
  [ -n "$(port_pids)" ]
}

api_healthy() {
  /usr/bin/curl -fsS --max-time 2 "$(health_url)" >/dev/null 2>&1
}

resolved_mt5_enabled() {
  local mt5_storage
  mt5_storage="${MT5_STORAGE:-sqlite}"
  if [ "${mt5_storage}" = "postgres" ] && ! nc -z 127.0.0.1 5432 >/dev/null 2>&1; then
    echo "false"
  else
    echo "true"
  fi
}

kill_port_owner() {
  local pids
  pids="$(port_pids)"
  if [ -z "${pids}" ]; then
    return 0
  fi
  echo "[src/api] force-killing port ${PORT}: pids=${pids}"
  echo "${pids}" | xargs kill -9 2>/dev/null || true
  sleep 1
}

kill_stale_server_processes() {
  local pids
  pids="$(server_pids)"
  if [ -z "${pids}" ]; then
    return 0
  fi
  echo "[src/api] force-killing stale API process(es): pids=${pids}"
  echo "${pids}" | xargs kill -9 2>/dev/null || true
  sleep 1
}

ensure_api_slot() {
  if api_healthy; then
    if [ "${FORCE}" = "1" ]; then
      kill_port_owner
      kill_stale_server_processes
      return 0
    fi
    echo "[src/api] healthy API already running on :${PORT}; skipping start"
    return 10
  fi
  if port_in_use; then
    local pids
    pids="$(port_pids)"
    if [ "${FORCE}" = "1" ]; then
      kill_port_owner
      kill_stale_server_processes
      return 0
    fi
    echo "[src/api] port ${PORT} already in use by pid(s): ${pids}"
    echo "[src/api] refusing to kill existing owner without --force"
    return 20
  fi
  if [ "${FORCE}" = "1" ]; then
    kill_stale_server_processes
  fi
  return 0
}

run_server() {
  local mt5_storage mt5_enabled
  mt5_storage="${MT5_STORAGE:-sqlite}"
  mt5_enabled="$(resolved_mt5_enabled)"
  if [ "${mt5_enabled}" != "true" ]; then
    echo "[src/api] postgres :5432 unavailable -> starting with MT5_ENABLED=false"
  fi

  echo "[src/api] starting on :${PORT} (MT5_ENABLED=${mt5_enabled})"
  exec env PORT="${PORT}" \
    MT5_STORAGE="${mt5_storage}" \
    MT5_ENABLED="${mt5_enabled}" \
    APP_ROLE="${APP_ROLE:-web}" \
    SNAPSHOTS_CRON_ENABLED=0 \
    MARKET_DATA_CRON_ENABLED=0 \
    node "${WEB_API_ENTRY}"
}

start_background() {
  ensure_api_slot || {
    local code="$?"
    [ "${code}" = "10" ] && return 0
    return "${code}"
  }
  if [ "${FORCE}" = "1" ]; then
    nohup env PORT="${PORT}" LOG_FILE="${LOG_FILE}" LABEL="${LABEL}" \
      bash "${ROOT}/scripts/start/start_api.sh" serve --force >> "${LOG_FILE}" 2>&1 &
  else
    nohup env PORT="${PORT}" LOG_FILE="${LOG_FILE}" LABEL="${LABEL}" \
      bash "${ROOT}/scripts/start/start_api.sh" serve >> "${LOG_FILE}" 2>&1 &
  fi
  echo "[ok] API background start requested port=${PORT} log=${LOG_FILE}"
}

write_launch_agent_plist() {
  local mt5_enabled mt5_storage node_path
  mt5_storage="${MT5_STORAGE:-sqlite}"
  mt5_enabled="$(resolved_mt5_enabled)"
  node_path="${NODE_BIN:-}"
  if [ -z "${node_path}" ]; then
    echo "[src/api] unable to resolve node binary for launchctl mode"
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
    <string>${node_path}</string>
    <string>${WEB_API_ENTRY}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>PORT</key>
    <string>${PORT}</string>
    <key>LOG_FILE</key>
    <string>${LOG_FILE}</string>
    <key>LABEL</key>
    <string>${LABEL}</string>
    <key>APP_ROLE</key>
    <string>${APP_ROLE:-web}</string>
    <key>MT5_STORAGE</key>
    <string>${mt5_storage}</string>
    <key>MT5_ENABLED</key>
    <string>${mt5_enabled}</string>
    <key>SNAPSHOTS_CRON_ENABLED</key>
    <string>0</string>
    <key>MARKET_DATA_CRON_ENABLED</key>
    <string>0</string>
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
  <string>${ROOT}</string>
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
  ensure_api_slot || {
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
  echo "[ok] API launchctl start requested label=${LAUNCH_AGENT_LABEL} port=${PORT} log=${LOG_FILE} plist=${LAUNCH_AGENT_PLIST}"
}

case "${MODE}" in
  foreground|serve)
    ensure_api_slot || {
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
    echo "usage: bash scripts/start/start_api.sh [foreground|background|launchctl] [--force]"
    exit 1
    ;;
esac
