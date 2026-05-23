#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "[start] killing old..."
lsof -ti :3000 | xargs kill -9 2>/dev/null || true
lsof -ti :3001 | xargs kill -9 2>/dev/null || true
sleep 1

echo "[start] webhook API :3001..."
MT5_POSTGRES_URL="postgresql://mt5_user:d6820a26247b22feb567cbfedf7ee316674c19e5a81ad52d@127.0.0.1:5432/mt5_bridge" \
  node webhook/server.js &>/tmp/webhook.log &
sleep 2

echo "[start] Vite UI :3000 → proxy :3001..."
cd web-ui
VITE_API_PROXY_TARGET="http://localhost:3001" npx vite --port 3000 --strictPort &>/tmp/vite.log &
sleep 3

echo ""
echo "http://localhost:3000"
