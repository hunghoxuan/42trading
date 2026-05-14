#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UI_DIR="${ROOT_DIR}/web-ui"
ENV_FILE="${ROOT_DIR}/webhook/.env"
REPORT_DIR="${ROOT_DIR}/test-results"
mkdir -p "${REPORT_DIR}"

API_KEY="${API_KEY:-$(sed -n 's/^SIGNAL_API_KEY=//p' "${ENV_FILE}" | head -n 1)}"
BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
UI_URL="${UI_URL:-https://trade.mozasolution.com}"

if [[ -z "${API_KEY}" ]]; then
  echo "[ui-test] API_KEY is required (or SIGNAL_API_KEY in webhook/.env)"
  exit 1
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
UNIT_REPORT_FILE="${REPORT_DIR}/remote-ui-unit-${STAMP}.log"
E2E_REPORT_FILE="${REPORT_DIR}/remote-ui-e2e-${STAMP}.log"

echo "[ui-test] root=${ROOT_DIR}"
echo "[ui-test] ui_dir=${UI_DIR}"
echo "[ui-test] unit_log=${UNIT_REPORT_FILE}"
echo "[ui-test] e2e_log=${E2E_REPORT_FILE}"

# Unit tests
(
  cd "${UI_DIR}"
  echo "[ui-test] running unit tests first..."
  npm run test:unit
) 2>&1 | tee "${UNIT_REPORT_FILE}"
cp "${UNIT_REPORT_FILE}" "${REPORT_DIR}/remote-ui-unit-latest.log"

# E2E tests — always save latest log even on failure
E2E_EXIT=0
(
  cd "${UI_DIR}"
  echo "[ui-test] running e2e tests..."
  UI_URL="${UI_URL}" BASE_URL="${BASE_URL}" API_KEY="${API_KEY}" npx playwright test
) 2>&1 | tee "${E2E_REPORT_FILE}" || E2E_EXIT=$?
cp "${E2E_REPORT_FILE}" "${REPORT_DIR}/remote-ui-e2e-latest.log"

echo "[ui-test] unit_latest=${REPORT_DIR}/remote-ui-unit-latest.log"
echo "[ui-test] e2e_latest=${REPORT_DIR}/remote-ui-e2e-latest.log"
echo "[ui-test] e2e_exit=${E2E_EXIT}"

exit ${E2E_EXIT}
