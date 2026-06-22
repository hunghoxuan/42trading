#!/usr/bin/env bash
# =============================================================================
# start_docker.sh — Run everything locally via Docker
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT}/docker/docker-compose.yml"

echo "━━━ Building images ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
docker compose -f "${COMPOSE_FILE}" build

echo "━━━ Starting services (db + src/api + src/admin) ━━━━━"
docker compose -f "${COMPOSE_FILE}" up -d

echo ""
echo "  src/admin:   http://localhost:8080"
echo "  src/api: http://localhost:3100/health"
echo "  db:       postgres://trading:trading@localhost:5433/trading"
echo ""

echo "━━━ Waiting for health check..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    echo "  ✅ healthy"
    exit 0
  fi
  sleep 2
done

echo "  ❌ health check timed out"
exit 1
