#!/usr/bin/env bash
# =============================================================================
# install_local_autostart.sh — Register start_local.sh as a macOS login service
# =============================================================================
# Installs a launchd user agent that runs Vite + webhook on login.
# Both services auto-restart on crash (handled inside start_local.sh).
# If the script itself dies, launchd KeepAlive restarts the whole thing.
#
# Usage:
#   bash scripts/install/install_local_autostart.sh
#
# To remove:
#   bash scripts/uninstall/uninstall_local_autostart.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMPLATE="${ROOT}/scripts/install/com.trading.bot.local.plist"
DEST="${HOME}/Library/LaunchAgents/com.trading.bot.local.plist"
LABEL="com.trading.bot.local"

mkdir -p "${HOME}/Library/LaunchAgents"

# Replace placeholder path with actual repo path
sed "s|/ABSOLUTE/PATH/TO/trading|${ROOT}|g" "${TEMPLATE}" > "${DEST}"
chmod 644 "${DEST}"

# Unload old version first (ignore errors)
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl unload "${DEST}" 2>/dev/null || true

# Load new version
launchctl bootstrap "gui/$(id -u)" "${DEST}" 2>/dev/null || \
  launchctl load "${DEST}"

echo "✅ Installed. Services will start on next login."
echo "   To start now: launchctl kickstart gui/$(id -u)/${LABEL}"
echo "   Logs: ${ROOT}/.local/start_local.*.log"
