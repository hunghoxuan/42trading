#!/usr/bin/env bash
set -euo pipefail

PORT="${PORT:-3001}"
BASE_URL="${BASE_URL:-http://127.0.0.1:${PORT}}"
TIMEOUT_SEC="${TIMEOUT_SEC:-15}"
SLEEP_SEC="${SLEEP_SEC:-1}"

deadline=$((SECONDS + TIMEOUT_SEC))

check_once() {
  local body
  body="$(curl -fsS "${BASE_URL}/health" 2>/dev/null || true)"
  if [ -z "${body}" ]; then
    return 1
  fi
  echo "${body}" | rg -q '"ok"\s*:\s*true'
}

while [ "${SECONDS}" -lt "${deadline}" ]; do
  if check_once; then
    echo "[PASS] webhook healthy at ${BASE_URL}/health"
    exit 0
  fi
  sleep "${SLEEP_SEC}"
done

echo "[FAIL] webhook not healthy within ${TIMEOUT_SEC}s: ${BASE_URL}/health"
exit 1
