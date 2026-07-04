#!/usr/bin/env bash
set -euo pipefail

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-3001}"
LABEL="${LABEL:-trading-webhook-local}"
LOG_FILE="${LOG_FILE:-/tmp/trading-webhook-local.log}"
MODE="${1:-inspect}" # inspect | repair

health_url() {
  printf "http://127.0.0.1:%s/health" "${PORT}"
}

port_pids() {
  lsof -ti "tcp:${PORT}" 2>/dev/null || true
}

health_ok() {
  /usr/bin/curl -fsS --max-time 2 "$(health_url)" >/dev/null 2>&1
}

print_section() {
  printf "\n=== %s ===\n" "$1"
}

show_status() {
  local pids
  pids="$(port_pids)"

  print_section "time"
  date

  print_section "port ${PORT}"
  if [ -n "${pids}" ]; then
    lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN || true
    echo
    ps -p "${pids//$'\n'/,}" -o pid=,ppid=,command= 2>/dev/null || true
  else
    echo "no listener on ${PORT}"
  fi

  print_section "health"
  if /usr/bin/curl -s -o /tmp/fix_3001_health.out -w 'code=%{http_code} total=%{time_total}\n' "$(health_url)"; then
    head -c 200 /tmp/fix_3001_health.out 2>/dev/null || true
    echo
  else
    echo "health request failed"
  fi

  print_section "launchctl"
  launchctl print "gui/$(id -u)/${LABEL}" 2>/dev/null | sed -n '1,90p' || echo "launchctl job not found: ${LABEL}"

  print_section "recent log"
  tail -n 80 "${LOG_FILE}" 2>/dev/null || echo "no log at ${LOG_FILE}"
}

repair() {
  print_section "repair"
  if health_ok; then
    echo "API already healthy on :${PORT}; nothing to repair"
    return 0
  fi
  echo "API unhealthy on :${PORT}; restarting via start_api.sh launchctl --force"
  bash "${ROOT}/scripts/start/start_api.sh" launchctl --force
  echo
  echo "post-repair verification:"
  bash "${ROOT}/tests/verify_webhook_local.sh"
}

case "${MODE}" in
  inspect)
    show_status
    ;;
  repair)
    show_status
    repair
    ;;
  *)
    echo "usage: bash scripts/start/fix_3001_being_killed.sh [inspect|repair]"
    exit 1
    ;;
esac
