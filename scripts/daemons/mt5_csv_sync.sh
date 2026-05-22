#!/usr/bin/env bash
set -euo pipefail

API_KEY="${API_KEY:?must set API_KEY env var for signal.mozasolution.com}"
LIMIT="${LIMIT:-5000}"
URL="http://signal.mozasolution.com/csv?apiKey=${API_KEY}&limit=${LIMIT}"
MT5_COMMON_FILES="${MT5_COMMON_FILES:-${HOME}/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/crossover/AppData/Roaming/MetaQuotes/Terminal/Common/Files}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_OUT="$SCRIPT_DIR/tvbridge_signals.csv"
MT5_OUT="$MT5_COMMON_FILES/tvbridge_signals.csv"

TMP_LOCAL="$LOCAL_OUT.tmp"
TMP_MT5="$MT5_OUT.tmp"

mkdir -p "$MT5_COMMON_FILES"

curl -fsSL --retry 3 --connect-timeout 10 "$URL" -o "$TMP_LOCAL"
if ! head -n 1 "$TMP_LOCAL" | grep -q '^timestamp;signal_id;action;symbol;volume;sl;tp;note$'; then
  echo "CSV header check failed. Response may be an error page or JSON." >&2
  rm -f "$TMP_LOCAL" "$TMP_MT5"
  exit 1
fi

cp "$TMP_LOCAL" "$TMP_MT5"
mv "$TMP_LOCAL" "$LOCAL_OUT"
mv "$TMP_MT5" "$MT5_OUT"

echo "$(date '+%F %T') updated:"
echo " - $LOCAL_OUT"
echo " - $MT5_OUT"
