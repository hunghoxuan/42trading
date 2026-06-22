#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
API_KEY="${API_KEY:-}"
SYMBOL="${SYMBOL:-EURUSD}"
SIDE="${SIDE:-BUY}"

if [[ -z "${API_KEY}" ]]; then
  echo "[ERR] API_KEY is required"
  exit 1
fi

echo "[1] heartbeat"
HB='{"broker_id":"mt5_smoke","name":"MT5 Smoke","broker_type":"mt5_ea","metadata":{"via":"test_remote_v2_broker_full.sh"}}'
curl -sS --max-time 15 -H "x-api-key: ${API_KEY}" -H "content-type: application/json" -X POST "${BASE_URL}/api/broker/heartbeat" -d "${HB}" | sed -n '1,120p'

echo "[2] broker-originated trade create"
CREATE="$(cat <<JSON
{
  "symbol":"${SYMBOL}",
  "side":"${SIDE}",
  "execution_status":"PENDING",
  "event_type":"SMOKE_CREATE",
  "payload_json":{"via":"test_remote_v2_broker_full.sh"}
}
JSON
)"
curl -sS --max-time 15 -H "x-api-key: ${API_KEY}" -H "content-type: application/json" -X POST "${BASE_URL}/api/broker/trades/create" -d "${CREATE}" | sed -n '1,120p'

echo "[DONE]"
