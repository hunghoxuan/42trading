#!/usr/bin/env bash
# Test AI analysis with selected provider/model and extract debug logs.
# Requires SIGNAL_API_KEY from user_settings.
#
# Usage:
#   API_KEY=xxx bash scripts/test_ai_analysis.sh BTCUSD openrouter "openai/gpt-4o"
#   API_KEY=xxx bash scripts/test_ai_analysis.sh EURUSD claude "claude-sonnet-4-0"
#
# Output: prints the full API response. Saves raw JSON to test_ai_out.json.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYMBOL="${1:-BTCUSD}"
PROVIDER="${2:-openrouter}"
MODEL="${3:-openai/gpt-4o}"
API_KEY="${API_KEY:-}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: Set API_KEY env var (get from user_settings type=api_key name=SIGNAL_API_KEY)"
  exit 1
fi

echo "=== Test AI Analysis ==="
echo "Symbol:   $SYMBOL"
echo "Provider: $PROVIDER"
echo "Model:    $MODEL"
echo ""

# Health check
echo "[1] Health:"
curl -fsS "https://trade.mozasolution.com/health" 2>&1 | python3 -m json.tool
echo ""

# Send AI generate request
echo "[2] Sending to /v2/ai/generate..."

PAYLOAD=$(cat <<EOF
{
  "model": "$MODEL",
  "provider": "$PROVIDER",
  "symbol": "$SYMBOL",
  "timeframes": ["15m","1h","4h","D"],
  "bars_count": 300,
  "prompt": "Analyze $SYMBOL for a trade setup. Return valid JSON ONLY with fields: trade_plan array containing objects with direction (BUY/SELL), entry_price, stop_loss, take_profits (array of {price}), risk_reward, confidence_pct, entry_model, strategy, note.",
  "files": [],
  "max_tokens": 3000
}
EOF
)

echo "Payload:"
echo "$PAYLOAD" | python3 -m json.tool
echo ""

RESPONSE=$(curl -s -X POST "https://trade.mozasolution.com/v2/ai/generate" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $API_KEY" \
  -d "$PAYLOAD" 2>&1)

echo "$RESPONSE" > "$ROOT_DIR/scripts/test_ai_out.json"
echo "=== RAW RESPONSE ==="
echo "$RESPONSE"
echo ""
echo "Saved to: scripts/test_ai_out.json"
echo ""

# Parse and validate
python3 << 'PYEOF' 2>&1 || true
import sys, json

with open("scripts/test_ai_out.json") as f:
    raw = f.read()

try:
    d = json.loads(raw)
except json.JSONDecodeError as e:
    print(f"JSON PARSE ERROR: {e}")
    print(f"Raw preview: {raw[:500]}")
    sys.exit(0)

if "error" in d:
    print(f"API ERROR: {d['error']}")
    if "details" in d:
        print(f"DETAILS: {d['details']}")
    sys.exit(0)

# Try finding trade_plan in various locations
tp = d.get("trade_plan") or d.get("parsed_json", {}).get("trade_plan") or d.get("parsed_json", {}).get("tradePlan") or []
if not tp and "raw_response" in d:
    print("No trade_plan parsed. Raw response preview:")
    print(d["raw_response"][:500])
    sys.exit(0)

if isinstance(tp, list) and len(tp) > 0:
    p = tp[0]
elif isinstance(tp, dict):
    p = tp
else:
    print(f"trade_plan type: {type(tp).__name__}, value: {tp}")
    sys.exit(0)

print("=== EXTRACTED TRADE PLAN ===")
print(f"Direction:    {p.get('direction','-')}")
print(f"Entry:        {p.get('entry') or p.get('entry_price') or '-'}")
print(f"Stop Loss:    {p.get('sl') or p.get('stop_loss') or '-'}")
print(f"Take Profit:  {p.get('tp') or '-'}")
print(f"RR:           {p.get('rr') or p.get('risk_reward') or '-'}")
print(f"Confidence:   {p.get('confidence_pct','-')}")
print(f"Entry Model:  {p.get('entry_model','-')}")
print(f"Strategy:     {p.get('strategy','-')}")
print(f"Note:         {p.get('note','-')}")

# Check for partial TPs
partials = p.get("partial_tps") or p.get("take_profits") or []
if partials and isinstance(partials, list):
    for i, pt in enumerate(partials):
        print(f"  Partial TP {i+1}: price={pt.get('price','-')} rr={pt.get('reward_to_risk','-')} size={pt.get('close_position_pct','-')}%")

print("")
print("=== RESPONSE METADATA ===")
for k in ["model", "provider", "source", "claude_files_mode"]:
    if k in d:
        print(f"{k}: {d[k]}")

print(f"Response keys: {list(d.keys())}")
PYEOF

echo ""
echo "=== LOGS (pm2 tail) ==="
ssh root@139.59.211.192 "pm2 logs webhook --lines 30 --nostream 2>&1" 2>/dev/null | grep -iE "ai|analyze|openrouter|claude|gpt|model|model" | tail -10 || echo "(cannot ssh)"
