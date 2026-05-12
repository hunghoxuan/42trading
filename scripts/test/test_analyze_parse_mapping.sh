#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_DIR="${ROOT_DIR}/test-results"
mkdir -p "${REPORT_DIR}"

BASE_URL="${BASE_URL:-https://trade.mozasolution.com/webhook}"
ENDPOINT="${ENDPOINT:-/v2/chart/snapshots/analyze}"
API_KEY="${API_KEY:-}"
SYMBOL="${SYMBOL:-US30}"
MODEL="${MODEL:-claude-sonnet-4-0}"
PROVIDER="${PROVIDER:-claude}"
BARS_COUNT="${BARS_COUNT:-300}"
TIMEFRAMES="${TIMEFRAMES:-D,4H,15M,5M}"
PAYLOAD_FILE="${PAYLOAD_FILE:-}"

if [[ -z "${API_KEY}" ]]; then
  echo "[FAIL] API_KEY is required"
  echo "Example:"
  echo "API_KEY=\"<key>\" SYMBOL=\"US30\" bash scripts/test/test_analyze_parse_mapping.sh"
  exit 1
fi

IFS=',' read -r -a TF_ARR <<< "${TIMEFRAMES}"
TF_JSON="["
for tf in "${TF_ARR[@]}"; do
  tf_trimmed="$(echo "${tf}" | tr -d ' ')"
  [[ -z "${tf_trimmed}" ]] && continue
  if [[ "${TF_JSON}" != "[" ]]; then
    TF_JSON+=","
  fi
  TF_JSON+="\"${tf_trimmed}\""
done
TF_JSON+="]"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT_JSON="${REPORT_DIR}/analyze-parse-${SYMBOL}-${STAMP}.json"

if [[ -n "${PAYLOAD_FILE}" ]]; then
  if [[ ! -f "${PAYLOAD_FILE}" ]]; then
    echo "[FAIL] PAYLOAD_FILE not found: ${PAYLOAD_FILE}"
    exit 1
  fi
  PAYLOAD="$(cat "${PAYLOAD_FILE}")"
else
  PAYLOAD="$(cat <<EOF
{
  "model": "${MODEL}",
  "provider": "${PROVIDER}",
  "symbol": "${SYMBOL}",
  "symbols": ["${SYMBOL}"],
  "timeframes": ${TF_JSON},
  "bars_count": ${BARS_COUNT},
  "force_refresh": true,
  "prompt": "Analyze ${SYMBOL}. Return JSON only.",
  "max_tokens": 4500
}
EOF
)"
fi

URL="${BASE_URL%/}${ENDPOINT}"
echo "[test] URL=${URL}"
echo "[test] SYMBOL=${SYMBOL} MODEL=${MODEL} PROVIDER=${PROVIDER}"
echo "[test] writing=${OUT_JSON}"

HTTP_CODE="$(
  curl -sS -o "${OUT_JSON}" -w "%{http_code}" \
    -X POST "${URL}" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${API_KEY}" \
    -d "${PAYLOAD}"
)"

if [[ "${HTTP_CODE}" != "200" ]]; then
  echo "[FAIL] HTTP ${HTTP_CODE}"
  echo "[info] response preview:"
  head -c 1200 "${OUT_JSON}" || true
  echo
  exit 1
fi

python3 - <<'PY' "${OUT_JSON}" "${SYMBOL}"
import json
import re
import sys
from typing import Any, Dict, List, Optional

path = sys.argv[1]
symbol = sys.argv[2].upper().strip()

def parse_json_loose(text: str) -> Optional[Dict[str, Any]]:
    text = (text or "").strip()
    if not text:
        return None
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    m = re.search(r"\{.*\}", text, flags=re.S)
    if m:
        try:
            obj = json.loads(m.group(0))
            if isinstance(obj, dict):
                return obj
        except Exception:
            return None
    return None

def pick_first_plan_for_symbol(plans: Any, sym: str) -> Optional[Dict[str, Any]]:
    if not isinstance(plans, list):
        return None
    norm = []
    for p in plans:
        if isinstance(p, dict):
            ps = str(p.get("symbol", "")).upper().strip()
            norm.append((ps, p))
    for ps, p in norm:
        if ps == sym:
            return p
    return norm[0][1] if norm else None

def pick_numeric(d: Dict[str, Any], keys: List[str]) -> Optional[float]:
    for k in keys:
        if k in d and d[k] is not None:
            v = d[k]
            if isinstance(v, (int, float)):
                return float(v)
    return None

def extract_raw_plan(raw_plan: Dict[str, Any]) -> Dict[str, Optional[float]]:
    entry = pick_numeric(raw_plan, ["entry_price", "entry"])
    sl = pick_numeric(raw_plan, ["stop_loss", "sl"])
    tp = None
    tps = raw_plan.get("take_profits")
    if isinstance(tps, list) and len(tps) > 0:
        cand = tps[-1]
        if isinstance(cand, dict):
            tp = pick_numeric(cand, ["price"])
        elif isinstance(cand, (int, float)):
            tp = float(cand)
    if tp is None:
        mx = raw_plan.get("multiple_exits") or {}
        if isinstance(mx, dict):
            full_tp = mx.get("full_tp") or {}
            if isinstance(full_tp, dict):
                tp = pick_numeric(full_tp, ["price"])
        if tp is None:
            tp = pick_numeric(raw_plan, ["take_profit", "tp3", "tp2", "tp1", "tp"])
    return {"entry": entry, "sl": sl, "tp": tp}

def extract_parsed_plan(parsed_plan: Dict[str, Any]) -> Dict[str, Optional[float]]:
    entry = pick_numeric(parsed_plan, ["entry", "entry_price"])
    sl = pick_numeric(parsed_plan, ["sl", "stop_loss"])
    tp = pick_numeric(parsed_plan, ["tp", "tp3", "tp2", "take_profit"])
    return {"entry": entry, "sl": sl, "tp": tp}

def is_skip_plan(plan: Dict[str, Any]) -> bool:
    decision = str(
        plan.get("skip_recommendation")
        or plan.get("trade_decision")
        or (plan.get("risk_management") or {}).get("skip_decision")
        or ""
    ).strip().lower()
    return decision == "skip"

with open(path, "r", encoding="utf-8") as f:
    api = json.load(f)

if api.get("ok") is False:
    print("[FAIL] API returned ok=false")
    print(json.dumps(api, ensure_ascii=False)[:1200])
    sys.exit(1)

raw_text = str(api.get("raw_response", "") or "")
raw_obj = parse_json_loose(raw_text)
if not raw_obj:
    print("[FAIL] Cannot parse raw_response as JSON")
    sys.exit(1)

parsed = api.get("parsed_json")
if not isinstance(parsed, dict):
    print("[FAIL] parsed_json missing or invalid")
    sys.exit(1)

raw_plans = raw_obj.get("trade_plan")
if not isinstance(raw_plans, list) and isinstance(raw_obj.get("analysis_data"), list):
    merged = []
    for e in raw_obj["analysis_data"]:
        if isinstance(e, dict) and isinstance(e.get("trade_plan"), list):
            for p in e["trade_plan"]:
                if isinstance(p, dict):
                    if not p.get("symbol"):
                        p = {**p, "symbol": e.get("symbol", "")}
                    merged.append(p)
    raw_plans = merged
if not isinstance(raw_plans, list) and isinstance(raw_obj.get("analyses"), list):
    merged = []
    for e in raw_obj["analyses"]:
        if isinstance(e, dict) and isinstance(e.get("trade_plan"), list):
            for p in e["trade_plan"]:
                if isinstance(p, dict):
                    if not p.get("symbol"):
                        p = {**p, "symbol": e.get("symbol", "")}
                    merged.append(p)
    raw_plans = merged
if not isinstance(raw_plans, list) and isinstance(raw_obj.get("symbols"), list):
    merged = []
    for e in raw_obj["symbols"]:
        if isinstance(e, dict) and isinstance(e.get("trade_plan"), list):
            for p in e["trade_plan"]:
                if isinstance(p, dict):
                    if not p.get("symbol"):
                        p = {**p, "symbol": e.get("symbol", "")}
                    merged.append(p)
    raw_plans = merged

parsed_plans = parsed.get("trade_plan")

raw_plan = pick_first_plan_for_symbol(raw_plans, symbol)
parsed_plan = pick_first_plan_for_symbol(parsed_plans, symbol)

if not raw_plan:
    print("[FAIL] raw_response has no trade_plan")
    sys.exit(1)
if not parsed_plan:
    print("[FAIL] parsed_json has no trade_plan")
    sys.exit(1)

raw_symbol = str(raw_plan.get("symbol", "")).upper().strip()
parsed_symbol = str(parsed_plan.get("symbol", "")).upper().strip()
if symbol and parsed_symbol and parsed_symbol != symbol:
    print(f"[FAIL] parsed symbol mismatch: expected={symbol} got={parsed_symbol}")
    sys.exit(1)

raw_vals = extract_raw_plan(raw_plan)
parsed_vals = extract_parsed_plan(parsed_plan)

checks = ["entry", "sl", "tp"]
failed = []
for key in checks:
    if raw_vals[key] is not None and parsed_vals[key] is None:
        failed.append(key)

fallback_note = str(parsed_plan.get("note", ""))
fallback_model = str(parsed_plan.get("entry_model", ""))
fallback_hit = "Auto-added by server" in fallback_note or fallback_model == "No valid setup"

print("[info] raw symbol:", raw_symbol or "(empty)")
print("[info] parsed symbol:", parsed_symbol or "(empty)")
print("[info] raw values:", raw_vals)
print("[info] parsed values:", parsed_vals)
print("[info] fallback_detected:", fallback_hit)

if failed:
    print("[FAIL] parsed_json dropped mapped fields:", ", ".join(failed))
    sys.exit(1)

if fallback_hit and any(v is not None for v in raw_vals.values()):
    print("[FAIL] fallback plan replaced valid parsed plan")
    sys.exit(1)

if not is_skip_plan(parsed_plan):
    missing_numeric = [k for k in checks if parsed_vals[k] is None]
    if missing_numeric:
        print(
            "[FAIL] parsed non-Skip plan has non-numeric entry/sl/tp:",
            ", ".join(missing_numeric),
        )
        sys.exit(1)

print("[PASS] parse mapping looks correct (raw_response -> parsed_json)")
sys.exit(0)
PY

echo "[test] done: ${OUT_JSON}"
