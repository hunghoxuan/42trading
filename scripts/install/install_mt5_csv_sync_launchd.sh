#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${LABEL:-com.local.mt5csvsync}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-300}"
SCRIPT_PATH="${SCRIPT_PATH:-${ROOT_DIR}/scripts/daemons/mt5_csv_sync.sh}"
API_KEY="${API_KEY:?must set API_KEY env var for signal.mozasolution.com}"

PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LOG_OUT="${TMPDIR:-/tmp}/mt5_csv_sync.log"
LOG_ERR="${TMPDIR:-/tmp}/mt5_csv_sync.err.log"

if [[ ! -x "${SCRIPT_PATH}" ]]; then
  echo "Script is missing or not executable: ${SCRIPT_PATH}" >&2
  echo "Run: chmod +x ${SCRIPT_PATH}" >&2
  exit 1
fi

mkdir -p "${PLIST_DIR}"

cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>

    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>${SCRIPT_PATH}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>EnvironmentVariables</key>
    <dict>
      <key>API_KEY</key>
      <string>${API_KEY}</string>
    </dict>

    <key>StartInterval</key>
    <integer>${INTERVAL_SECONDS}</integer>

    <key>StandardOutPath</key>
    <string>${LOG_OUT}</string>

    <key>StandardErrorPath</key>
    <string>${LOG_ERR}</string>
  </dict>
</plist>
EOF

launchctl unload "${PLIST_PATH}" >/dev/null 2>&1 || true
launchctl load "${PLIST_PATH}"
launchctl kickstart -k "gui/$(id -u)/${LABEL}" || true

echo "Installed launchd job:"
echo " - Label: ${LABEL}"
echo " - Interval: ${INTERVAL_SECONDS}s"
echo " - Script: ${SCRIPT_PATH}"
echo " - Plist: ${PLIST_PATH}"
echo " - Logs: ${LOG_OUT} / ${LOG_ERR}"
