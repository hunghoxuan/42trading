#!/usr/bin/env bash
set -euo pipefail
# Build the Antigravity desktop app (Tauri + React)
# Prerequisites: Rust + Tauri CLI installed

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/app/ui"

echo "=== Building Antigravity Desktop ==="
echo ""

# Ensure Rust env
source "$HOME/.cargo/env" 2>/dev/null || true

# Build React frontend
echo "[1/2] Building UI..."
npm run build

# Build Tauri app
echo "[2/2] Building desktop app..."
npx tauri build --bundles app 2>&1 | tail -5

echo ""
echo "=== Done ==="
APP_PATH="src-tauri/target/release/bundle/macos/Antigravity.app"
if [[ -d "$APP_PATH" ]]; then
  SIZE=$(du -sh "$APP_PATH" | cut -f1)
  echo "App: $APP_PATH ($SIZE)"
  echo ""
  echo "To run: open $APP_PATH"
fi
