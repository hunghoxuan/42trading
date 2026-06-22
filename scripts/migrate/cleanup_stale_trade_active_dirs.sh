#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ACTIVE_DIR="${ROOT}/data/users/default/trade_active"
CLOSED_DIR="${ROOT}/data/users/default/trade_closed"
BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"

if [ ! -d "${ACTIVE_DIR}" ]; then
  echo "[info] active dir not found: ${ACTIVE_DIR}"
  exit 0
fi

mkdir -p "${CLOSED_DIR}"

moved=0
skipped=0
kept=0

tmp_keep="$(mktemp)"
tmp_ids="$(mktemp)"
trap 'rm -f "${tmp_keep}" "${tmp_ids}"' EXIT

pending_ok=1
filled_ok=1
curl -fsS "${BASE_URL}/api/trades?execution_status=PENDING&pageSize=50000" \
  | rg -o '"sid":"[^"]+"' \
  | cut -d: -f2 \
  | tr -d '"' > "${tmp_keep}" || pending_ok=0
curl -fsS "${BASE_URL}/api/trades?execution_status=FILLED&pageSize=50000" \
  | rg -o '"sid":"[^"]+"' \
  | cut -d: -f2 \
  | tr -d '"' >> "${tmp_keep}" || filled_ok=0
if [ "${pending_ok}" != "1" ] || [ "${filled_ok}" != "1" ]; then
  echo "[fail] unable to fetch keep list from ${BASE_URL}; aborting without moves"
  exit 1
fi
sort -u -o "${tmp_keep}" "${tmp_keep}"

find "${ACTIVE_DIR}" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; \
  | rg -v '-' > "${tmp_ids}" || true

while IFS= read -r sid; do
  [ -n "${sid}" ] || continue
  if rg -qx "${sid}" "${tmp_keep}"; then
    echo "[keep] ${sid} (PENDING/FILLED)"
    kept=$((kept + 1))
    continue
  fi
  if mv "${ACTIVE_DIR}/${sid}" "${CLOSED_DIR}/${sid}" 2>/dev/null; then
    echo "[move] ${sid} -> trade_closed"
    moved=$((moved + 1))
  else
    echo "[skip] ${sid} move failed"
    skipped=$((skipped + 1))
  fi
done < "${tmp_ids}"

echo "[done] kept=${kept} moved=${moved} skipped=${skipped}"
