#!/usr/bin/env bash
# =============================================================================
# uninstall_local_autostart.sh — Remove the macOS login launchd service
# =============================================================================
set -euo pipefail

LABEL="com.trading.bot.local"
PLIST="${HOME}/Library/LaunchAgents/${LABEL}.plist"

echo "━━━ Uninstalling ${LABEL} ━━━━━━━━━━━━━━━━━━━━━━━━━"

launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || \
  launchctl unload "${PLIST}" 2>/dev/null || true
rm -f "${PLIST}"

echo "  ✅ removed"
echo "━━━ Done ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
