#!/usr/bin/env bash
set -euo pipefail
# Restart the Antigravity desktop app

echo "Killing Antigravity..."
killall Antigravity 2>/dev/null || true
sleep 1

APP="app/ui/src-tauri/target/release/bundle/macos/Antigravity.app"
if [[ -d "$APP" ]]; then
  echo "Starting Antigravity..."
  open "$APP"
  echo "Done."
else
  echo "App not found at $APP. Build first: bash scripts/build_desktop.sh"
fi
