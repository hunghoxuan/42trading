#!/usr/bin/env bash
set -euo pipefail

# One-command demo mode switcher on VPS.
# Modes:
#   ea      -> MT5 EA consumes (v2 daemon stopped, cTrader disabled)
#   v2      -> v2 daemon consumes account queue (EA should be OFF, cTrader disabled)
#   ctrader -> cTrader bridge receives signal execution (v2 daemon stopped)
#
# Usage:
#   bash scripts/daemons/switch_demo_mode.sh ea
#   bash scripts/daemons/switch_demo_mode.sh v2
#   bash scripts/daemons/switch_demo_mode.sh ctrader

MODE="${1:-}"
if [[ -z "${MODE}" ]]; then
  echo "Usage: bash scripts/daemons/switch_demo_mode.sh <ea|v2|ctrader>" >&2
  exit 1
fi

VPS_HOST="${VPS_HOST:-root@139.59.211.192}"
APP_DIR="${APP_DIR:-/opt/trading}"

# Fixed accounts created on 2026-04-19
ACC_ORIGINAL="1d67c110-9c7f-4233-9db3-d3e82a7a74bb"
ACC_EA="acc_demo_ea_1776598125"
ACC_V2="acc_demo_v2_1776598125"
ACC_CTRADER="acc_demo_ctrader_1776598125"

# Fixed API keys from account creation time
EA_API_KEY="acc_abb0cef0545021e210e9bfdad701cba214e2"
V2_API_KEY="acc_1faec2a5d2e2873c7b9d315f73cb4af8b9fb"
CTRADER_ACCOUNT_API_KEY="acc_506cb604d10644736df6a7bf77c79fd30731"

ssh "${VPS_HOST}" "MODE='${MODE}' \
ACC_ORIGINAL='${ACC_ORIGINAL}' ACC_EA='${ACC_EA}' ACC_V2='${ACC_V2}' ACC_CTRADER='${ACC_CTRADER}' \
EA_API_KEY='${EA_API_KEY}' V2_API_KEY='${V2_API_KEY}' CTRADER_ACCOUNT_API_KEY='${CTRADER_ACCOUNT_API_KEY}' \
APP_DIR='${APP_DIR}' \
bash -s" <<'EOSSH'
set -euo pipefail

BASE="https://127.0.0.1:443"
WEBHOOK_ENV="${APP_DIR}/src/api/.env"
V2_ENV="${APP_DIR}/scripts/v2_broker_executor.env"

API_KEY="$(grep '^SIGNAL_API_KEY=' "${WEBHOOK_ENV}" | head -n 1 | cut -d'=' -f2-)"
if [[ -z "${API_KEY}" ]]; then
  echo "SIGNAL_API_KEY missing in ${WEBHOOK_ENV}" >&2
  exit 1
fi

put_subs() {
  local account_id="$1"
  local on="$2"
  if [[ "${on}" == "1" ]]; then
    curl -ksS "${BASE}/api/accounts/${account_id}/subscriptions" \
      -H "x-api-key: ${API_KEY}" -H "content-type: application/json" -X PUT \
      -d '{"items":[{"source_id":"signal","is_active":true},{"source_id":"tradingview","is_active":true}]}' >/dev/null
  else
    curl -ksS "${BASE}/api/accounts/${account_id}/subscriptions" \
      -H "x-api-key: ${API_KEY}" -H "content-type: application/json" -X PUT \
      -d '{"items":[]}' >/dev/null
  fi
}

set_env_value() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "${WEBHOOK_ENV}"; then
    sed -i "s|^${key}=.*$|${key}=${value}|" "${WEBHOOK_ENV}"
  else
    echo "${key}=${value}" >> "${WEBHOOK_ENV}"
  fi
}

case "${MODE}" in
  ea)
    put_subs "${ACC_ORIGINAL}" 0
    put_subs "${ACC_V2}" 0
    put_subs "${ACC_CTRADER}" 0
    put_subs "${ACC_EA}" 1

    set_env_value "CTRADER_MODE" ""
    pm2 stop v2-broker-executor >/dev/null 2>&1 || true
    pm2 restart webhook >/dev/null

    echo "MODE=ea"
    echo "EA_ACCOUNT_ID=${ACC_EA}"
    echo "EA_API_KEY=${EA_API_KEY}"
    ;;

  v2)
    put_subs "${ACC_ORIGINAL}" 0
    put_subs "${ACC_EA}" 0
    put_subs "${ACC_CTRADER}" 0
    put_subs "${ACC_V2}" 1

    # cTrader path off in v2 mode
    set_env_value "CTRADER_MODE" ""

    if [[ -f "${V2_ENV}" ]]; then
      if grep -q '^V2_BROKER_ACCOUNT_API_KEY=' "${V2_ENV}"; then
        sed -i "s|^V2_BROKER_ACCOUNT_API_KEY=.*$|V2_BROKER_ACCOUNT_API_KEY=${V2_API_KEY}|" "${V2_ENV}"
      else
        echo "V2_BROKER_ACCOUNT_API_KEY=${V2_API_KEY}" >> "${V2_ENV}"
      fi
    else
      cat > "${V2_ENV}" <<EOF
V2_BROKER_BASE_URL=https://trade.mozasolution.com/webhook
V2_BROKER_ACCOUNT_API_KEY=${V2_API_KEY}
V2_BROKER_POLL_MS=2000
V2_BROKER_PULL_MAX_ITEMS=1
EOF
    fi

    # reload daemon env
    set -a
    source "${V2_ENV}"
    set +a
    pm2 start v2-broker-executor >/dev/null 2>&1 || true
    pm2 restart v2-broker-executor --update-env >/dev/null
    pm2 restart webhook >/dev/null

    echo "MODE=v2"
    echo "V2_ACCOUNT_ID=${ACC_V2}"
    echo "V2_API_KEY=${V2_API_KEY}"
    ;;

  ctrader)
    put_subs "${ACC_ORIGINAL}" 0
    put_subs "${ACC_EA}" 0
    put_subs "${ACC_V2}" 0
    put_subs "${ACC_CTRADER}" 1

    set_env_value "CTRADER_MODE" "demo"
    pm2 stop v2-broker-executor >/dev/null 2>&1 || true
    pm2 restart ctrader-executor >/dev/null
    pm2 restart webhook >/dev/null

    echo "MODE=ctrader"
    echo "CTRADER_ACCOUNT_ID=${ACC_CTRADER}"
    echo "CTRADER_ACCOUNT_API_KEY=${CTRADER_ACCOUNT_API_KEY}"
    ;;

  *)
    echo "Invalid mode: ${MODE}. Use ea|v2|ctrader" >&2
    exit 1
    ;;
esac

echo "---HEALTH"
curl -ksS --max-time 12 "${BASE}/health" | sed -n '1,120p'
echo
echo "---PM2"
pm2 ls
EOSSH

echo
echo "[local] done: switched mode '${MODE}'"
