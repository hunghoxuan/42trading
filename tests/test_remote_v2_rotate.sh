#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
ADMIN_API_KEY="${ADMIN_API_KEY:-}"
ACCOUNT_ID="${ACCOUNT_ID:-}"

if [[ -z "${ADMIN_API_KEY}" || -z "${ACCOUNT_ID}" ]]; then
  echo "[ERR] ADMIN_API_KEY and ACCOUNT_ID are required"
  exit 1
fi

RESP="$(curl -sS --max-time 15 \
  -H "x-api-key: ${ADMIN_API_KEY}" \
  -H "content-type: application/json" \
  -X POST "${BASE_URL}/api/accounts/${ACCOUNT_ID}/api-key/rotate" \
  -d '{}')"

echo "${RESP}" | sed -n '1,120p'
