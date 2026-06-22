#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
API_KEY="${API_KEY:-}"

if [[ -z "${API_KEY}" ]]; then
  echo "[ERR] API_KEY is required"
  exit 1
fi

echo "[1] Pulling v2 broker trades..."
PULL_JSON="$(curl -sS --max-time 15 \
  -H "content-type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -X POST "${BASE_URL}/api/broker/pull" \
  -d '{"max_items":1}')"

echo "${PULL_JSON}" | sed -n '1,120p'

TRADE_ID="$(echo "${PULL_JSON}" | sed -n 's/.*"trade_id":"\([^"]*\)".*/\1/p' | head -n1)"
LEASE_TOKEN="$(echo "${PULL_JSON}" | sed -n 's/.*"lease_token":"\([^"]*\)".*/\1/p' | head -n1)"

if [[ -z "${TRADE_ID}" || -z "${LEASE_TOKEN}" ]]; then
  echo "[OK] No queued v2 trades to ack."
  exit 0
fi

echo "[2] Acking pulled trade ${TRADE_ID}..."
ACK_BODY="$(cat <<JSON
{
  "trade_id":"${TRADE_ID}",
  "lease_token":"${LEASE_TOKEN}",
  "execution_status":"OPEN",
  "event_type":"SMOKE_ACK",
  "idempotency_key":"smoke_$(date +%s)",
  "payload_json":{"via":"test_remote_v2_broker.sh"}
}
JSON
)"

ACK_JSON="$(curl -sS --max-time 15 \
  -H "content-type: application/json" \
  -H "x-api-key: ${API_KEY}" \
  -X POST "${BASE_URL}/api/broker/ack" \
  -d "${ACK_BODY}")"

echo "${ACK_JSON}" | sed -n '1,120p'

echo "[DONE] v2 broker smoke test completed."
