#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MT5_PYTHON_BRIDGE_LABEL="${MT5_PYTHON_BRIDGE_LABEL:-trading-mt5-python-bridge-raw}"
WEBHOOK_LABEL="${WEBHOOK_LABEL:-trading-web-api-raw}"
WEBUI_LABEL="${WEBUI_LABEL:-trading-webui-raw}"
MT5_PYTHON_BRIDGE_LOG="${MT5_PYTHON_BRIDGE_LOG:-/tmp/mt5-python-bridge.raw.launchd.out}"
WEBHOOK_LOG="${WEBHOOK_LOG:-/tmp/web-api.raw.launchd.out}"
WEBUI_LOG="${WEBUI_LOG:-/tmp/web-ui.raw.launchd.out}"
VITE_ALLOWED_HOSTS="${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}"
MT5_PYTHON_BRIDGE_ENABLED="${MT5_PYTHON_BRIDGE_ENABLED:-1}"

echo "[reset] killing stale processes/ports..."
launchctl remove "${MT5_PYTHON_BRIDGE_LABEL}" 2>/dev/null || true
launchctl remove "${WEBHOOK_LABEL}" 2>/dev/null || true
launchctl remove "${WEBUI_LABEL}" 2>/dev/null || true
launchctl remove trading-web-api-local 2>/dev/null || true
launchctl remove trading-web-ui-local 2>/dev/null || true
pkill -f "/Users/macmini/Projects/moza/42trade/src/mt5-bridge/python/main.py" 2>/dev/null || true
pkill -f "/Users/macmini/Projects/moza/42trade/src/api/server.js" 2>/dev/null || true
pkill -f "vite --host 127.0.0.1 --port 3000" 2>/dev/null || true
lsof -ti tcp:3002 | xargs kill -9 2>/dev/null || true
lsof -ti tcp:3001 | xargs kill -9 2>/dev/null || true
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null || true
sleep 1

if [ "${MT5_PYTHON_BRIDGE_ENABLED}" = "1" ]; then
  echo "[reset] starting mt5-python-bridge :3002 via launchctl submit..."
  launchctl submit -l "${MT5_PYTHON_BRIDGE_LABEL}" -- /bin/zsh -lc \
    "cd ${ROOT} && MT5_BRIDGE_PORT=3002 python3 src/mt5-bridge/python/main.py >> ${MT5_PYTHON_BRIDGE_LOG} 2>&1"

  echo "[reset] verifying mt5-python-bridge..."
  ok_mt5py=0
  for i in 1 2 3 4 5 6 7 8 9 10; do
    curl -sS --max-time 4 http://127.0.0.1:3002/health >/tmp/reset_mt5py_h.json && ok_mt5py=1 && break || true
    sleep 1
  done
  if [ "${ok_mt5py}" != "1" ]; then
    echo "[reset] FAIL mt5-python-bridge did not become healthy"
    tail -n 80 "${MT5_PYTHON_BRIDGE_LOG}" 2>/dev/null || true
    exit 1
  fi
fi

echo "[reset] starting web-api :3001 via launchctl submit..."
launchctl submit -l "${WEBHOOK_LABEL}" -- /bin/zsh -lc \
  "cd ${ROOT} && PORT=3001 BARS_STORAGE_PROVIDER='${BARS_STORAGE_PROVIDER:-parquet_duckdb}' BARS_DUCKDB_PATH='${BARS_DUCKDB_PATH:-${ROOT}/data/bars.duckdb}' REMOTE_DB_AUTO_TUNNEL=1 MT5_REMOTE_DB_SSH_HOST='${MT5_REMOTE_DB_SSH_HOST:-root@139.59.211.192}' MT5_REMOTE_DB_LOCAL_PORT='${MT5_REMOTE_DB_LOCAL_PORT:-15432}' MT5_ENABLED=true SNAPSHOTS_CRON_ENABLED=0 MARKET_DATA_CRON_ENABLED=0 node src/api/server.js >> ${WEBHOOK_LOG} 2>&1"

echo "[reset] verifying web-api before UI..."
ok_webhook=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sS --max-time 4 http://127.0.0.1:3001/health >/tmp/reset_h.json && ok_webhook=1 && break || true
  sleep 1
done
if [ "${ok_webhook}" != "1" ]; then
  echo "[reset] FAIL web-api did not become healthy"
  tail -n 80 "${WEBHOOK_LOG}" 2>/dev/null || true
  exit 1
fi

echo "[reset] starting web-ui :3000 via launchctl submit..."
if [ -n "${VITE_ALLOWED_HOSTS}" ]; then
  launchctl submit -l "${WEBUI_LABEL}" -- /bin/zsh -lc \
    "cd ${ROOT} && env VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='${VITE_ALLOWED_HOSTS}' __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='${VITE_ALLOWED_HOSTS}' npm --prefix src/admin run dev -- --host 127.0.0.1 --port 3000 --strictPort >> ${WEBUI_LOG} 2>&1"
else
  launchctl submit -l "${WEBUI_LABEL}" -- /bin/zsh -lc \
    "cd ${ROOT} && npm --prefix src/admin run dev -- --host 127.0.0.1 --port 3000 --strictPort >> ${WEBUI_LOG} 2>&1"
fi

echo "[reset] verifying ui..."
ok_webui=0
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -sS --max-time 4 http://127.0.0.1:3000/ >/tmp/reset_u.html && ok_webui=1 || true
  if [ "$ok_webui" = "1" ]; then
    break
  fi
  sleep 1
done

if [ "$ok_webhook" != "1" ] || [ "$ok_webui" != "1" ]; then
  echo "[reset] FAIL mt5-python-bridge=${ok_mt5py:-skipped} web-api=$ok_webhook webui=$ok_webui"
  echo "--- mt5-python-bridge log tail ---"
  tail -n 80 "${MT5_PYTHON_BRIDGE_LOG}" 2>/dev/null || true
  echo "--- web-api log tail ---"
  tail -n 80 "${WEBHOOK_LOG}" 2>/dev/null || true
  echo "--- web-ui log tail ---"
  tail -n 80 "${WEBUI_LOG}" 2>/dev/null || true
  exit 1
fi

echo "[reset] OK"
if [ "${MT5_PYTHON_BRIDGE_ENABLED}" = "1" ]; then
  echo "[reset] mt5-python-bridge: $(head -c 120 /tmp/reset_mt5py_h.json)"
fi
echo "[reset] health: $(head -c 120 /tmp/reset_h.json)"
echo "[reset] ui: $(head -n 1 /tmp/reset_u.html)"
