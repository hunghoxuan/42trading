#!/usr/bin/env bash
# Install cTrader bars fetcher as a LaunchAgent (runs every hour)
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LABEL="${LABEL:-com.local.ctraderbars}"
INTERVAL_SECONDS="${INTERVAL_SECONDS:-3600}"
SCRIPT_PATH="${SCRIPT_PATH:-${ROOT_DIR}/scripts/daemons/fetch_ctrader_bars.sh}"

PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
LOG_OUT="${TMPDIR:-/tmp}/ctrader_bars.log"
LOG_ERR="${TMPDIR:-/tmp}/ctrader_bars.err.log"

[ -f "${SCRIPT_PATH}" ] || { echo "Script not found: ${SCRIPT_PATH}"; exit 1; }
chmod +x "${SCRIPT_PATH}"
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

echo "Installed cTrader bars fetcher:"
echo "  Label: ${LABEL}"
echo "  Interval: ${INTERVAL_SECONDS}s (every $((INTERVAL_SECONDS/60))min)"
echo "  Script: ${SCRIPT_PATH}"
echo ""
echo "Run once manually:"
echo "  bash ${SCRIPT_PATH}"
