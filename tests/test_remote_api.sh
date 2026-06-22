#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="${ROOT_DIR}/tests/results"
mkdir -p "${REPORT_DIR}"

BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
API_KEY="${API_KEY:-}"
ACCOUNT="${ACCOUNT:-remote-test}"

if [[ -z "${API_KEY}" ]]; then
  echo "[test] API_KEY is required"
  echo "[test] Example:"
  echo "API_KEY=\"\$(sed -n 's/^SIGNAL_API_KEY=//p' webhook/.env | head -n 1)\" BASE_URL=\"https://trade.mozasolution.com/webhook\" bash tests/test_remote_api.sh"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
REPORT_FILE="${REPORT_DIR}/remote-api-${STAMP}.log"

echo "[test] BASE_URL=${BASE_URL}"
echo "[test] report=${REPORT_FILE}"

(
  cd "${ROOT_DIR}"
  BASE_URL="${BASE_URL}" API_KEY="${API_KEY}" ACCOUNT="${ACCOUNT}" \
    node --test --test-reporter=spec tests/remote/mt5-remote.test.mjs
) 2>&1 | tee "${REPORT_FILE}"

cp "${REPORT_FILE}" "${REPORT_DIR}/remote-api-latest.log"
echo "[test] latest=${REPORT_DIR}/remote-api-latest.log"
