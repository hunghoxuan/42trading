#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
API_KEY="${API_KEY:-}"

if [[ -z "${API_KEY}" ]]; then
  echo "[ERR] API_KEY is required"
  exit 1
fi

BODY='{"positions":[],"orders":[],"resolve_missing":false,"create_orphans":false}'
RESP="$(curl -sS --max-time 15 \
  -H "x-api-key: ${API_KEY}" \
  -H "content-type: application/json" \
  -X POST "${BASE_URL}/api/broker/sync" \
  -d "${BODY}")"

echo "${RESP}" | sed -n '1,160p'
