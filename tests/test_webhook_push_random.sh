#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/src/api/.env"

# Defaults baked in so user runs this file directly with no params.
BASE_URL="http://139.59.211.192"
VPS_HOST="139.59.211.192"
VPS_USER="root"
VPS_APP_DIR="${VPS_APP_DIR:-/opt/trading}"
PUSH_COUNT=5
TEST_SYMBOL="${TEST_SYMBOL:-TEST}"

if [[ "${TEST_SYMBOL}" != "TEST" ]]; then
  echo "[error] Safety guard: TEST_SYMBOL must be TEST, got '${TEST_SYMBOL}'"
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[error] Missing env file: ${ENV_FILE}"
  exit 1
fi

API_KEY="$(sed -n 's/^SIGNAL_API_KEY=//p' "${ENV_FILE}" | head -n 1)"
if [[ -z "${API_KEY}" ]]; then
  echo "[error] SIGNAL_API_KEY is empty in ${ENV_FILE}"
  exit 1
fi

TS="$(date +%Y%m%d-%H%M%S)"
REPORT_DIR="${ROOT_DIR}/tests/results"
REPORT_FILE="${REPORT_DIR}/webhook-push-random-${TS}.log"
mkdir -p "${REPORT_DIR}"

log() {
  echo "$*" | tee -a "${REPORT_FILE}"
}

rand_in_range() {
  local min="$1" max="$2"
  awk -v min="${min}" -v max="${max}" 'BEGIN{srand(); printf "%.2f", min+rand()*(max-min)}'
}

cleanup_remote_test_rows() {
  log "[1/3] Cleaning old test rows (tvtest_*) from remote Postgres..."

  ssh "${VPS_USER}@${VPS_HOST}" bash -s -- "${VPS_APP_DIR}" <<'EOSSH'
set -euo pipefail
APP_DIR="$1"
ENV_FILE="${APP_DIR}/src/api/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[warn] remote env not found; skip cleanup"
  exit 0
fi

DB_URL="$(sed -n 's/^MT5_POSTGRES_URL=//p' "${ENV_FILE}" | head -n 1)"
if [[ -z "${DB_URL}" ]]; then
  DB_URL="$(sed -n 's/^POSTGRES_URL=//p' "${ENV_FILE}" | head -n 1)"
fi
if [[ -z "${DB_URL}" ]]; then
  DB_URL="$(sed -n 's/^POSTGRE_URL=//p' "${ENV_FILE}" | head -n 1)"
fi
if [[ -z "${DB_URL}" ]]; then
  echo "[warn] MT5_POSTGRES_URL/POSTGRES_URL not set; skip cleanup"
  exit 0
fi

psql "${DB_URL}" -v ON_ERROR_STOP=1 \
  -c "DELETE FROM signal_events WHERE signal_id LIKE 'tvtest_%';" \
  -c "DELETE FROM signals WHERE signal_id LIKE 'tvtest_%';"
echo "[ok] cleanup done"
EOSSH
}

push_random_signals() {
  log "[2/3] Pushing ${PUSH_COUNT} random signals via /mt5/tv/webhook ..."

  local i signal_id action symbol volume sl tp note payload res
  for i in $(seq 1 "${PUSH_COUNT}"); do
    signal_id="tvtest_${TS}_${i}_$((RANDOM % 100000))"
    if (( RANDOM % 2 )); then action="BUY"; else action="SELL"; fi
    symbol="${TEST_SYMBOL}"

    volume="0.01"
    sl="$(rand_in_range 60000 74000)"
    tp="$(rand_in_range 65000 78000)"
    note="AUTO_TEST random webhook push #${i}"

    payload="{\"id\":\"${signal_id}\",\"action\":\"${action}\",\"symbol\":\"${symbol}\",\"volume\":${volume},\"sl\":${sl},\"tp\":${tp},\"note\":\"${note}\",\"apiKey\":\"${API_KEY}\"}"

    res="$(curl -sS --max-time 20 -X POST "${BASE_URL}/mt5/tv/webhook" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${API_KEY}" \
      --data "${payload}")"

    if [[ "${res}" != *'"ok":true'* ]] || [[ "${res}" != *"\"signal_id\":\"${signal_id}\""* ]]; then
      log "[fail] push ${i} failed: ${res}"
      exit 1
    fi

    log "[ok] pushed: ${signal_id} ${action} ${symbol}"
    echo "${signal_id}" >> "${REPORT_DIR}/webhook-push-random-last.ids"
    sleep 0.2
  done
}

verify_signals_exist() {
  log "[3/3] Verifying pushed signals are queryable..."

  local signal_id out
  while IFS= read -r signal_id; do
    [[ -z "${signal_id}" ]] && continue
    out="$(curl -sS --max-time 20 \
      -H "x-api-key: ${API_KEY}" \
      "${BASE_URL}/mt5/trades/${signal_id}?apiKey=${API_KEY}")"

    if [[ "${out}" != *'"ok":true'* ]] || [[ "${out}" != *"\"signal_id\":\"${signal_id}\""* ]]; then
      log "[fail] verification failed for ${signal_id}: ${out}"
      exit 1
    fi

    log "[ok] verified: ${signal_id}"
  done < "${REPORT_DIR}/webhook-push-random-last.ids"
}

: > "${REPORT_DIR}/webhook-push-random-last.ids"
log "[start] ${TS}"
log "BASE_URL=${BASE_URL}"
log "VPS=${VPS_USER}@${VPS_HOST}:${VPS_APP_DIR}"

cleanup_remote_test_rows
push_random_signals
verify_signals_exist

cp "${REPORT_FILE}" "${REPORT_DIR}/webhook-push-random-latest.log"
log "[done] PASS"
log "report=${REPORT_FILE}"
log "latest=${REPORT_DIR}/webhook-push-random-latest.log"
