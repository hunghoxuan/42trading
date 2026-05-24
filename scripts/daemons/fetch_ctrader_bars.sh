#!/usr/bin/env bash
# Fetch ALL bars from cTrader broker for ALL symbols + ALL TFs
# Run anytime — bars deduplicate by time.
set -euo pipefail

DOWNSTREAM_URL="${DOWNSTREAM_URL:-http://127.0.0.1:8110}"
SYMBOLS="${SYMBOLS:-ADAUSD,BTCUSD,ETHUSD,EURUSD,GBPUSD,USDJPY,AUDUSD,NZDUSD,USDCAD,USDCHF,GBPJPY,XAUUSD,US30,NAS100,SPX500}"
TFS="${TFS:-1m,5m,15m,1h,4h,1D}"
BARS="${BARS:-500}"
ACCOUNT_ID="${ACCOUNT_ID:-45899489}"

SYM_JSON=$(echo "$SYMBOLS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | sed 's/.*/"&"/' | paste -sd, -)
TFS_JSON=$(echo "$TFS" | tr ',' '\n' | sed 's/^ *//;s/ *$//' | grep -v '^$' | sed 's/.*/"&"/' | paste -sd, -)

echo "[fetch-bars] symbols=$SYMBOLS tfs=$TFS bars=$BARS"

curl -s -X POST "${DOWNSTREAM_URL}/fetch-bars" \
  -H "content-type: application/json" \
  -d "{\"account_id\":\"${ACCOUNT_ID}\",\"symbols\":[${SYM_JSON}],\"timeframes\":[${TFS_JSON}],\"bars\":${BARS}}" \
  | python3 -m json.tool 2>/dev/null || cat

echo ""
echo "[fetch-bars] Done."
