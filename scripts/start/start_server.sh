#!/usr/bin/env bash
# =============================================================================
# start_server.sh — Redeploy on production VPS
# =============================================================================
# Usage:
#   bash start_server.sh              # redeploy main branch
#   bash start_server.sh feature-branch  # deploy a feature branch
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="${1:-main}"
VPS_HOST="root@139.59.211.192"
VPS_APP_DIR="/opt/trading"

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${CYAN}━━━ Deploy ${BRANCH} to VPS ━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo -e "${CYAN}[1/6] pushing ${BRANCH} to origin...${NC}"
git push origin "${BRANCH}"

echo -e "${CYAN}[2/6] pulling latest on VPS...${NC}"
ssh "${VPS_HOST}" "cd ${VPS_APP_DIR} && git fetch origin && git checkout ${BRANCH} && git pull --ff-only origin ${BRANCH}"

echo -e "${CYAN}[3/6] installing dependencies...${NC}"
ssh "${VPS_HOST}" "cd ${VPS_APP_DIR} && corepack pnpm install --frozen-lockfile"

echo -e "${CYAN}[4/6] building src/admin...${NC}"
ssh "${VPS_HOST}" "cd ${VPS_APP_DIR} && corepack pnpm --dir src/admin run build"

echo -e "${CYAN}[5/6] restarting src/api...${NC}"
ssh "${VPS_HOST}" "cd ${VPS_APP_DIR} && PORT=3001 HTTPS_ENABLED=false pm2 restart src/api --update-env"

echo -e "${CYAN}[5b/6] reloading nginx...${NC}"
ssh "${VPS_HOST}" "nginx -t && nginx -s reload" 2>/dev/null || echo -e "${YELLOW}  nginx not running, skipping${NC}"

echo -e "${CYAN}[6/6] verifying health...${NC}"
OK=0
for i in $(seq 1 15); do
  BODY="$(curl -fsS "https://trade.mozasolution.com/health" 2>/dev/null || true)"
  VERSION="$(echo "${BODY}" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p' | head -1)"
  if echo "${BODY}" | grep -q '"ok":true'; then
    echo -e "  ${GREEN}✅ healthy — version ${VERSION}${NC}"
    OK=1
    break
  fi
  sleep 2
done

if [ "${OK}" != "1" ]; then
  echo -e "${RED}  ❌ health check failed${NC}"
  exit 1
fi

echo -e "${GREEN}━━━ Deploy complete ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
