#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_API_DIR="${ROOT_DIR}/src/api"
WEB_UI_DIR="${ROOT_DIR}/src/admin"
WEBHOOK_ENV="${WEB_API_DIR}/.env"
WEB_UI_ENV="${WEB_UI_DIR}/.env"

if [[ ! -f "${WEBHOOK_ENV}" ]]; then
  echo "[local-db] missing ${WEBHOOK_ENV}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${WEBHOOK_ENV}"
set +a

if [[ -z "${MT5_POSTGRES_URL_LOCAL:-}" ]]; then
  echo "[local-db] MT5_POSTGRES_URL_LOCAL missing in ${WEBHOOK_ENV}" >&2
  exit 1
fi

cleanup() {
  if [[ -n "${WEBHOOK_PID:-}" ]]; then
    kill "${WEBHOOK_PID}" 2>/dev/null || true
  fi
  if [[ -n "${UI_PID:-}" ]]; then
    kill "${UI_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "[local-db] src/api: http://127.0.0.1:3001"
echo "[local-db] src/admin:  http://127.0.0.1:5174"
echo "[local-db] db:      local postgres"

(
  cd "${WEB_API_DIR}"
  MT5_POSTGRES_URL="${MT5_POSTGRES_URL_LOCAL}" npm run start
) &
WEBHOOK_PID="$!"

(
  cd "${WEB_UI_DIR}"
  set -a
  # shellcheck disable=SC1090
  . "${WEB_UI_ENV}"
  set +a
  VITE_API_BASE="${VITE_API_BASE:-http://localhost:3001}" \
  VITE_API_KEY="${VITE_API_KEY:-}" \
  VITE_API_PROXY_TARGET="${VITE_API_PROXY_TARGET:-http://localhost:3001}" \
    npm run dev
) &
UI_PID="$!"

wait
