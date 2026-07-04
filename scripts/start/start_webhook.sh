#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
echo "[deprecated] use: bash scripts/start/start_api.sh${1:+ $1}"
exec bash "${ROOT}/scripts/start/start_api.sh" "$@"
