#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/src/api/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[test] Missing env file: ${ENV_FILE}"
  exit 1
fi

API_KEY="${API_KEY:-$(sed -n 's/^SIGNAL_API_KEY=//p' "${ENV_FILE}" | head -n 1)}"
BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
ACCOUNT="${ACCOUNT:-remote-test}"

if [[ -z "${API_KEY}" ]]; then
  echo "[test] SIGNAL_API_KEY is empty in ${ENV_FILE}"
  exit 1
fi

cd "${ROOT_DIR}"
API_KEY="${API_KEY}" BASE_URL="${BASE_URL}" ACCOUNT="${ACCOUNT}" bash tests/test_remote_api.sh
