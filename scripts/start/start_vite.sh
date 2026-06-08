#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PORT="${PORT:-3000}"
VITE_ALLOWED_HOSTS="${VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS:-}"
free_port() { lsof -ti "tcp:${1}" 2>/dev/null | xargs kill -9 2>/dev/null || true; sleep 1; }
free_port "${PORT}"
if [ -n "${VITE_ALLOWED_HOSTS}" ]; then
  export VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS}"
  export __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS="${VITE_ALLOWED_HOSTS}"
fi
exec npx vite --port "${PORT}" --strictPort --host 127.0.0.1
