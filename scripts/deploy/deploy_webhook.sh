#!/usr/bin/env bash
set -euo pipefail
# =============================================================================
# deploy_webhook.sh — Deploy src/api + src/admin to VPS
# =============================================================================
# Architecture:
#   Port 443  → nginx → serves src/admin (dist/) + proxies /api/*, /health, etc. to :3001
#   Port 3001 → src/api (API only, no HTTPS)
#
# Prerequisites (VPS):
#   - Node.js 20+
#   - PostgreSQL with mt5_bridge database
#   - nginx with SSL (trade.mozasolution.com)
#   - PM2 (npm i -g pm2)
#   - /opt/trading/src/api/.env with:
#       PORT=3001
#       MT5_STORAGE=postgres
#       MT5_POSTGRES_URL=postgresql://user:pass@127.0.0.1:5432/mt5_bridge
#       MT5_ENABLED=true
#
# Usage:
#   bash scripts/deploy/deploy_webhook.sh
#
# Env overrides:
#   BRANCH=main PUSH_FIRST=1 VPS_HOST=root@139.59.211.192
# =============================================================================

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="${BRANCH:-main}"
PUSH_FIRST="${PUSH_FIRST:-1}"
VPS_HOST="${VPS_HOST:-root@139.59.211.192}"
VPS_APP_DIR="${VPS_APP_DIR:-/opt/trading}"
SERVICE_NAME="${SERVICE_NAME:-src/api}"
REMOTE_HEALTH_BASE_URL="${REMOTE_HEALTH_BASE_URL:-https://trade.mozasolution.com}"

echo "============================================"
echo "  Deploy: ${REMOTE_HEALTH_BASE_URL}"
echo "============================================"
echo "  branch:       ${BRANCH}"
echo "  vps:          ${VPS_HOST}"
echo "  app_dir:      ${VPS_APP_DIR}"
echo "  push_first:   ${PUSH_FIRST}"
echo "============================================"

cd "${ROOT_DIR}"

# ── Step 1: Build version check ──
echo "[1/6] Build version check..."
if [[ -f "scripts/deploy/check_build_versions.sh" ]]; then
  bash scripts/deploy/check_build_versions.sh "origin/${BRANCH}" || true
fi

# ── Step 2: Build src/admin locally ──
echo "[2/6] Building src/admin..."
pnpm --dir src/admin run build

# ── Step 3: Push to origin ──
if [[ "${PUSH_FIRST}" == "1" ]]; then
  echo "[3/6] Pushing to origin/${BRANCH}..."
  git push origin "${BRANCH}"
else
  echo "[3/6] Skipping push (PUSH_FIRST=0)"
fi

# ── Step 4: Deploy to VPS ──
echo "[4/6] Deploying to VPS..."
ssh "${VPS_HOST}" bash -s << 'VPS_SCRIPT'
set -euo pipefail
cd /opt/trading

echo "  [vps] Pulling code..."
git fetch --all --prune
git checkout main
git pull --ff-only origin main

echo "  [vps] Removing local-only DB tooling..."
rm -f /opt/trading/src/db/start_db.sh

echo "  [vps] Installing deps..."
corepack pnpm install --frozen-lockfile

echo "  [vps] Building src/admin..."
corepack pnpm --dir /opt/trading/src/admin run build

echo "  [vps] Ensuring .env exists..."
if [ ! -f /opt/trading/src/api/.env ]; then
  echo "PORT=3001" > /opt/trading/src/api/.env
  echo "WARNING: .env created with defaults. Set MT5_POSTGRES_URL manually."
fi

echo "  [vps] Restarting src/api (port 3001)..."
pm2 restart src/api --update-env 2>/dev/null || pm2 start /opt/trading/src/api/server.js --name src/api

echo "  [vps] Restarting nginx (port 443)..."
systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null || true

echo "  [vps] Done."
VPS_SCRIPT

# ── Step 5: Health check ──
echo "[5/6] Health check..."
OK=0
for i in $(seq 1 20); do
  if curl -fsSk "${REMOTE_HEALTH_BASE_URL}/health" 2>/dev/null | grep -q '"ok":true'; then
    OK=1
    echo "  [health] OK (attempt ${i})"
    break
  fi
  echo "  [health] waiting... (${i}/20)"
  sleep 3
done

if [[ "${OK}" != "1" ]]; then
  echo "  [health] FAILED after 20 attempts"
  echo "  Check: ssh ${VPS_HOST} 'pm2 logs src/api --lines 5'"
  exit 1
fi

# ── Step 6: Verify ──
echo "[6/6] Verification..."
HEALTH_JSON=$(curl -fsSk "${REMOTE_HEALTH_BASE_URL}/health" 2>/dev/null || echo '{"ok":false}')
echo "  health: $(echo "$HEALTH_JSON" | grep -o '"ok":[^,}]*')"
echo "  version: $(echo "$HEALTH_JSON" | grep -o '"version":"[^"]*"')"
echo "  postgres: $(echo "$HEALTH_JSON" | grep -o '"postgres":"[^"]*"')"

echo ""
echo "============================================"
echo "  Deploy Complete"
echo "  ${REMOTE_HEALTH_BASE_URL}"
echo "============================================"
