#!/usr/bin/env bash
# =============================================================================
# start_mobile_access.sh — expose local UI/API over Tailscale and Cloudflare
# =============================================================================
# Modes:
#   tailscale   -> private tailnet UI URL only
#   cloudflare  -> public UI quick tunnel only (dev/demo use)
#   both        -> tailscale + UI quick tunnel
#   tv          -> TradingView API tunnel on :3001
#   all         -> tailscale + UI quick tunnel + TradingView API tunnel
#
# The script restarts the local stack so the UI can accept tunnel host headers
# and the API is reachable for public webhook delivery.
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MODE="${1:-both}"
WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-3001}"
TAILSCALE_HTTPS_PORT="${TAILSCALE_HTTPS_PORT:-8443}"
TAILSCALE_HOST="${TAILSCALE_HOST:-hunghx.tail02c7f8.ts.net}"
CLOUDFLARED_UI_LOG="${CLOUDFLARED_UI_LOG:-/tmp/cloudflared.ui.out}"
CLOUDFLARED_API_LOG="${CLOUDFLARED_API_LOG:-/tmp/cloudflared.api.out}"
CLOUDFLARE_ALLOWED_HOSTS="${CLOUDFLARE_ALLOWED_HOSTS:-.trycloudflare.com}"
CLOUDFLARED_BIN="${CLOUDFLARED_BIN:-$(command -v cloudflared || true)}"
CF_TV_TUNNEL_NAME="${CF_TV_TUNNEL_NAME:-42trade-tv}"
CF_TV_TUNNEL_HOSTNAME="${CF_TV_TUNNEL_HOSTNAME:-}"
CF_TV_TUNNEL_SERVICE="${CF_TV_TUNNEL_SERVICE:-http://127.0.0.1:${API_PORT}}"

usage() {
  cat <<'EOF'
Usage:
  bash scripts/start/start_mobile_access.sh [tailscale|cloudflare|both|tv|all]

Environment:
  WEB_PORT=3000
  API_PORT=3001
  TAILSCALE_HTTPS_PORT=8443
  CLOUDFLARE_ALLOWED_HOSTS=.trycloudflare.com
  CF_TV_TUNNEL_NAME=42trade-tv
  CF_TV_TUNNEL_HOSTNAME=tv.example.com
  CF_TV_TUNNEL_SERVICE=http://127.0.0.1:3001

Notes:
  - Cloudflare quick tunnels are dev-only and produce temporary URLs.
  - TradingView needs a public HTTPS URL; plain Tailscale is not enough.
  - If CF_TV_TUNNEL_HOSTNAME and ~/.cloudflared/cert.pem exist, tv/all mode
    tries a named tunnel first. Otherwise it falls back to a quick tunnel.
EOF
}

case "${MODE}" in
  tailscale|cloudflare|both|tv|all) ;;
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
need_tv=0
if [ "${MODE}" = "cloudflare" ] || [ "${MODE}" = "both" ] || [ "${MODE}" = "all" ]; then
  need_cloudflare=1
fi
if [ "${MODE}" = "tailscale" ] || [ "${MODE}" = "both" ] || [ "${MODE}" = "all" ]; then
  need_tailscale=1
fi
if [ "${MODE}" = "tv" ] || [ "${MODE}" = "all" ]; then
  need_tv=1
fi

if { [ "${need_cloudflare}" = "1" ] || [ "${need_tv}" = "1" ]; } && ! command -v cloudflared >/dev/null 2>&1; then
  echo "[mobile] cloudflared is not installed. Install it with: brew install cloudflared"
  exit 1
fi

cleanup() {
  if [ -n "${CLOUDFLARED_UI_PID:-}" ] && kill -0 "${CLOUDFLARED_UI_PID}" 2>/dev/null; then
    kill "${CLOUDFLARED_UI_PID}" 2>/dev/null || true
  fi
  if [ -n "${CLOUDFLARED_API_PID:-}" ] && kill -0 "${CLOUDFLARED_API_PID}" 2>/dev/null; then
    kill "${CLOUDFLARED_API_PID}" 2>/dev/null || true
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

start_cloudflare_ui_quick_tunnel() {
  echo "[mobile] refreshing cloudflared UI quick tunnel..."
  pkill -f "cloudflared tunnel --url http://127.0.0.1:${WEB_PORT}" >/dev/null 2>&1 || true
  rm -f "${CLOUDFLARED_UI_LOG}" >/dev/null 2>&1 || true
  "${CLOUDFLARED_BIN}" tunnel --url "http://127.0.0.1:${WEB_PORT}" --no-autoupdate > "${CLOUDFLARED_UI_LOG}" 2>&1 &
  CLOUDFLARED_UI_PID=$!

  cloudflare_url=""
  for _ in $(seq 1 40); do
    cloudflare_url="$(rg -o 'https://[^[:space:]]+trycloudflare.com' "${CLOUDFLARED_UI_LOG}" 2>/dev/null | tail -n 1 || true)"
    if [ -n "${cloudflare_url}" ]; then
      break
    fi
    sleep 1
  done

  if [ -n "${cloudflare_url}" ]; then
    echo "[mobile] cloudflare UI URL: ${cloudflare_url}"
  else
    echo "[mobile] cloudflare UI tunnel started, but the public URL was not detected yet."
    echo "[mobile] check log: ${CLOUDFLARED_UI_LOG}"
  fi
}

start_tradingview_tunnel() {
  echo "[mobile] preparing TradingView API tunnel for ${CF_TV_TUNNEL_SERVICE}..."
  rm -f "${CLOUDFLARED_API_LOG}" >/dev/null 2>&1 || true

  if [ -n "${CF_TV_TUNNEL_HOSTNAME}" ] && [ -f "${HOME}/.cloudflared/cert.pem" ]; then
    echo "[mobile] attempting named tunnel '${CF_TV_TUNNEL_NAME}' for ${CF_TV_TUNNEL_HOSTNAME}..."
    if "${CLOUDFLARED_BIN}" tunnel list 2>/dev/null | rg -q "\\b${CF_TV_TUNNEL_NAME}\\b"; then
      :
    else
      "${CLOUDFLARED_BIN}" tunnel create "${CF_TV_TUNNEL_NAME}" >> "${CLOUDFLARED_API_LOG}" 2>&1
    fi
    "${CLOUDFLARED_BIN}" tunnel route dns "${CF_TV_TUNNEL_NAME}" "${CF_TV_TUNNEL_HOSTNAME}" >> "${CLOUDFLARED_API_LOG}" 2>&1
    "${CLOUDFLARED_BIN}" tunnel run --url "${CF_TV_TUNNEL_SERVICE}" "${CF_TV_TUNNEL_NAME}" > "${CLOUDFLARED_API_LOG}" 2>&1 &
    CLOUDFLARED_API_PID=$!
    echo "[mobile] TradingView URL: https://${CF_TV_TUNNEL_HOSTNAME}/signal/<SIGNAL_API_KEY>"
    echo "[mobile] named tunnel started; install as a login service later with: cloudflared service install"
    return
  fi

  echo "[mobile] named tunnel not ready yet; starting quick tunnel fallback"
  echo "[mobile] stable mode later needs: cloudflared tunnel login + CF_TV_TUNNEL_HOSTNAME"
  pkill -f "cloudflared tunnel --url http://127.0.0.1:${API_PORT}" >/dev/null 2>&1 || true
  "${CLOUDFLARED_BIN}" tunnel --url "http://127.0.0.1:${API_PORT}" --no-autoupdate > "${CLOUDFLARED_API_LOG}" 2>&1 &
  CLOUDFLARED_API_PID=$!

  tv_url=""
  for _ in $(seq 1 40); do
    tv_url="$(rg -o 'https://[^[:space:]]+trycloudflare.com' "${CLOUDFLARED_API_LOG}" 2>/dev/null | tail -n 1 || true)"
    if [ -n "${tv_url}" ]; then
      break
    fi
    sleep 1
  done

  if [ -n "${tv_url}" ]; then
    echo "[mobile] TradingView URL: ${tv_url}/signal/<SIGNAL_API_KEY>"
  else
    echo "[mobile] TradingView quick tunnel started, but the public URL was not detected yet."
    echo "[mobile] check log: ${CLOUDFLARED_API_LOG}"
  fi
}

if [ "${need_cloudflare}" = "1" ]; then
  start_cloudflare_ui_quick_tunnel
fi

if [ "${need_tv}" = "1" ]; then
  start_tradingview_tunnel
fi

if [ "${need_cloudflare}" = "1" ] || [ "${need_tv}" = "1" ]; then
  echo "[mobile] keep this terminal open to keep quick tunnels alive."
  while true; do
    ui_alive=1
    api_alive=1
    if [ "${need_cloudflare}" = "1" ] && [ -n "${CLOUDFLARED_UI_PID:-}" ] && ! kill -0 "${CLOUDFLARED_UI_PID}" 2>/dev/null; then
      ui_alive=0
    fi
    if [ "${need_tv}" = "1" ] && [ -n "${CLOUDFLARED_API_PID:-}" ] && ! kill -0 "${CLOUDFLARED_API_PID}" 2>/dev/null; then
      api_alive=0
    fi
    if [ "${need_cloudflare}" = "1" ] && [ "${need_tv}" = "1" ] && [ "${ui_alive}" = "0" ] && [ "${api_alive}" = "0" ]; then
      break
    fi
    if [ "${need_cloudflare}" = "1" ] && [ "${need_tv}" = "0" ] && [ "${ui_alive}" = "0" ]; then
      break
    fi
    if [ "${need_cloudflare}" = "0" ] && [ "${need_tv}" = "1" ] && [ "${api_alive}" = "0" ]; then
      break
    fi
    sleep 2
  done
  echo "[mobile] cloudflare tunnel helper exited"
fi

echo "[mobile] done"
