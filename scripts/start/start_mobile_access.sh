#!/usr/bin/env bash
# =============================================================================
# start_mobile_access.sh — expose the local trading UI to a phone
# =============================================================================
# Modes:
#   tailscale   -> private tailnet URL only
#   cloudflare  -> public quick tunnel URL only (dev/demo use)
#   both        -> starts both routes
#
# The script restarts the local Vite + webhook stack so the UI can accept the
# host header used by each tunnel mode.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-both}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-3001}"
TAILSCALE_HTTPS_PORT="${TAILSCALE_HTTPS_PORT:-8443}"
TAILSCALE_HOST="${TAILSCALE_HOST:-hunghx.tail02c7f8.ts.net}"
CLOUDFLARED_LABEL="${CLOUDFLARED_LABEL:-trading-cloudflared-quick}"
CLOUDFLARED_LOG="${CLOUDFLARED_LOG:-/tmp/cloudflared.quick.launchd.out}"
CLOUDFLARE_ALLOWED_HOSTS="${CLOUDFLARE_ALLOWED_HOSTS:-.trycloudflare.com}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/start/start_mobile_access.sh [tailscale|cloudflare|both]

Environment:
  WEB_PORT=3000
  API_PORT=3001
  TAILSCALE_HTTPS_PORT=8443
  CLOUDFLARE_ALLOWED_HOSTS=.trycloudflare.com

Notes:
  - Cloudflare quick tunnels are dev-only and produce a temporary URL.
  - The script restarts the local stack so the UI can accept the tunnel host.
EOF
}

case "${MODE}" in
  tailscale|cloudflare|both) ;;
  -h|--help|help)
    usage
    exit 0
    ;;
  *)
    echo "[mobile] invalid mode: ${MODE}"
    usage
    exit 1
    ;;
esac

need_cloudflare=0
need_tailscale=0
if [ "${MODE}" = "cloudflare" ] || [ "${MODE}" = "both" ]; then
  need_cloudflare=1
fi
if [ "${MODE}" = "tailscale" ] || [ "${MODE}" = "both" ]; then
  need_tailscale=1
fi

if [ "${need_cloudflare}" = "1" ] && ! command -v cloudflared >/dev/null 2>&1; then
  echo "[mobile] cloudflared is not installed. Install it with: brew install cloudflared"
  exit 1
fi

cleanup() {
  if [ -n "${CLOUDFLARED_PID:-}" ] && kill -0 "${CLOUDFLARED_PID}" 2>/dev/null; then
    kill "${CLOUDFLARED_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

if [ "${need_cloudflare}" = "1" ]; then
  export VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${CLOUDFLARE_ALLOWED_HOSTS}"
else
  unset VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS 2>/dev/null || true
fi

echo "[mobile] restarting local stack..."
bash "${ROOT}/scripts/start/reset_stack_once.sh"

echo "[mobile] local UI:      http://localhost:${WEB_PORT}"
echo "[mobile] local backend: http://localhost:${API_PORT}"

if [ "${need_tailscale}" = "1" ]; then
  echo "[mobile] refreshing tailscale serve..."
  tailscale serve --https="${TAILSCALE_HTTPS_PORT}" off >/dev/null 2>&1 || true
  tailscale serve --bg --yes --https="${TAILSCALE_HTTPS_PORT}" localhost:"${WEB_PORT}" >/tmp/tailscale.serve.log 2>&1
  echo "[mobile] tailscale URL: https://${TAILSCALE_HOST}:${TAILSCALE_HTTPS_PORT}/"
fi

if [ "${need_cloudflare}" = "1" ]; then
  echo "[mobile] refreshing cloudflared quick tunnel..."
  pkill -f "cloudflared tunnel --url http://127.0.0.1:${WEB_PORT}" >/dev/null 2>&1 || true
  rm -f "${CLOUDFLARED_LOG}" >/dev/null 2>&1 || true
  "${CLOUDFLARED_BIN}" tunnel --url http://127.0.0.1:${WEB_PORT} --no-autoupdate > "${CLOUDFLARED_LOG}" 2>&1 &
  CLOUDFLARED_PID=$!

  cloudflare_url=""
  for _ in $(seq 1 40); do
    cloudflare_url="$(rg -o 'https://[^[:space:]]+trycloudflare.com' "${CLOUDFLARED_LOG}" 2>/dev/null | tail -n 1 || true)"
    if [ -n "${cloudflare_url}" ]; then
      break
    fi
    sleep 1
  done

  if [ -n "${cloudflare_url}" ]; then
    echo "[mobile] cloudflare URL: ${cloudflare_url}"
  else
    echo "[mobile] cloudflare tunnel started, but the public URL was not detected yet."
    echo "[mobile] check log: ${CLOUDFLARED_LOG}"
  fi

  echo "[mobile] keep this terminal open to keep the cloudflare tunnel alive."
  while kill -0 "${CLOUDFLARED_PID}" 2>/dev/null; do
    sleep 2
  done
  echo "[mobile] cloudflare tunnel exited"
fi

echo "[mobile] done"
