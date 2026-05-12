#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://trade.mozasolution.com}"
ENDPOINT="${ENDPOINT:-/v2/chart/snapshots/analyze}"
TVB_SESSION="${TVB_SESSION:-}"
SYMBOLS_JSON="${SYMBOLS_JSON:-[\"XAGUSD\",\"US30\"]}"
TIMEFRAMES_JSON="${TIMEFRAMES_JSON:-[\"D\",\"4H\",\"15M\",\"5M\"]}"
MODEL="${MODEL:-claude-sonnet-4-0}"
PROVIDER="${PROVIDER:-claude}"
BARS_COUNT="${BARS_COUNT:-300}"
PROMPT="${PROMPT:-Analyze requested symbols. Return JSON only.}"
MAX_TOKENS="${MAX_TOKENS:-8000}"
OUT_JSON="${OUT_JSON:-/tmp/analyze_v2_response.json}"
OUT_HEADERS="${OUT_HEADERS:-/tmp/analyze_v2_headers.txt}"

if [[ -z "${TVB_SESSION}" ]]; then
  echo "[FAIL] TVB_SESSION is required"
  echo "Example:"
  echo "TVB_SESSION='<session>' bash scripts/test/test_analyze_v2_multisymbol.sh"
  exit 1
fi

cat > /tmp/analyze_v2_payload.json <<JSON
{
  "model": "${MODEL}",
  "provider": "${PROVIDER}",
  "symbols": ${SYMBOLS_JSON},
  "timeframes": ${TIMEFRAMES_JSON},
  "bars_count": ${BARS_COUNT},
  "force_refresh": true,
  "prompt": "${PROMPT}",
  "max_tokens": ${MAX_TOKENS}
}
JSON

URL="${BASE_URL%/}${ENDPOINT}"
echo "[test] URL=${URL}"
echo "[test] payload=/tmp/analyze_v2_payload.json"

HTTP_CODE="$(
  curl -sS --max-time 240 \
    -D "${OUT_HEADERS}" \
    -o "${OUT_JSON}" \
    -w "%{http_code}" \
    "${URL}" \
    -H "Accept: */*" \
    -H "Accept-Language: en-GB,en;q=0.5" \
    -H "Cache-Control: no-cache" \
    -H "Connection: keep-alive" \
    -H "Content-Type: application/json" \
    -H "Origin: ${BASE_URL%/}" \
    -H "Pragma: no-cache" \
    -H "Referer: ${BASE_URL%/}/ai/analyze/XAUUSD-CADJPY" \
    -H "Sec-Fetch-Dest: empty" \
    -H "Sec-Fetch-Mode: cors" \
    -H "Sec-Fetch-Site: same-origin" \
    -H "Sec-GPC: 1" \
    -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36" \
    -H 'sec-ch-ua: "Chromium";v="148", "Brave";v="148", "Not/A)Brand";v="99"' \
    -H "sec-ch-ua-mobile: ?0" \
    -H 'sec-ch-ua-platform: "macOS"' \
    -b "tvb_session=${TVB_SESSION}" \
    --data-binary @/tmp/analyze_v2_payload.json
)"

echo "[http] status=${HTTP_CODE}"
head -n 1 "${OUT_HEADERS}" || true

python3 - <<'PY' "${OUT_JSON}"
import json
import sys

path = sys.argv[1]
obj = json.load(open(path, "r", encoding="utf-8"))
plans = ((obj.get("parsed_json") or {}).get("trade_plan") or [])
print(f"ok={obj.get('ok')} model={obj.get('model')} parsed_trade_plan_count={len(plans)}")
for i, p in enumerate(plans, 1):
    tp = p.get("tp")
    if tp is None:
        tp = p.get("tp3")
    if tp is None:
        tp = p.get("tp2")
    if tp is None:
        tp = p.get("take_profit")
    decision = (
        p.get("trade_decision")
        or p.get("skip_recommendation")
        or ((p.get("risk_management") or {}).get("skip_decision"))
        or ""
    )
    print(
        f"{i}. symbol={p.get('symbol','')} | entry_model={p.get('entry_model','')} | "
        f"entry={p.get('entry', p.get('entry_price',''))} | sl={p.get('sl', p.get('stop_loss',''))} | "
        f"tp={tp} | decision={decision} | note={p.get('note','')}"
    )
PY

echo "[saved] response=${OUT_JSON}"
