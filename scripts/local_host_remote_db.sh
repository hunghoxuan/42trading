#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBHOOK_DIR="${ROOT_DIR}/webhook"
WEB_UI_DIR="${ROOT_DIR}/web-ui"
WEBHOOK_ENV="${WEBHOOK_DIR}/.env"
WEB_UI_ENV="${WEB_UI_DIR}/.env"

REMOTE_HOST="${REMOTE_HOST:-root@139.59.211.192}"
REMOTE_DB_LOCAL_PORT="${REMOTE_DB_LOCAL_PORT:-15432}"

if [[ ! -f "${WEBHOOK_ENV}" ]]; then
  echo "[remote-db] missing ${WEBHOOK_ENV}" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "${WEBHOOK_ENV}"
set +a

if [[ -z "${MT5_POSTGRES_URL_REMOTE:-}" ]]; then
  echo "[remote-db] MT5_POSTGRES_URL_REMOTE missing in ${WEBHOOK_ENV}" >&2
  exit 1
fi

TUNNEL_PID=""
WEBHOOK_PID=""
UI_PID=""

cleanup() {
  if [[ -n "${WEBHOOK_PID}" ]]; then
    kill "${WEBHOOK_PID}" 2>/dev/null || true
  fi
  if [[ -n "${UI_PID}" ]]; then
    kill "${UI_PID}" 2>/dev/null || true
  fi
  if [[ -n "${TUNNEL_PID}" ]]; then
    kill "${TUNNEL_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if nc -z 127.0.0.1 "${REMOTE_DB_LOCAL_PORT}" >/dev/null 2>&1; then
  echo "[remote-db] tunnel already listening on 127.0.0.1:${REMOTE_DB_LOCAL_PORT}"
else
  echo "[remote-db] opening tunnel 127.0.0.1:${REMOTE_DB_LOCAL_PORT} -> VPS postgres"
  ssh -N -L "${REMOTE_DB_LOCAL_PORT}:127.0.0.1:5432" "${REMOTE_HOST}" &
  TUNNEL_PID="$!"
  sleep 1
fi

echo "[remote-db] webhook: http://127.0.0.1:3001"
echo "[remote-db] web-ui:  http://127.0.0.1:5174"
echo "[remote-db] db:      remote postgres via tunnel"

(
  cd "${WEBHOOK_DIR}"
  MT5_POSTGRES_URL="${MT5_POSTGRES_URL_REMOTE}" npm run start
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
