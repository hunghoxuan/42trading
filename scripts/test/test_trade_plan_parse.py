#!/usr/bin/env python3
"""
Test trade plan parsing from analyze response.
Checks that every symbol in requested_symbols has at least one trade plan
with valid entry, sl, tp > 0.

Usage: python3 scripts/test/test_trade_plan_parse.py [/tmp/analyze_v2_response.json]
"""
import json, re, sys, os

RESPONSE_FILE = sys.argv[1] if len(sys.argv) > 1 else "/tmp/analyze_v2_response.json"
OUT_FILE = RESPONSE_FILE.replace(".json", "_parse_result.json")

# ── replicate server's recoverTradePlansFromRawAiText ──
def extract_balanced_array(text, start_idx):
    src = str(text or "")
    depth = 0
    in_string = False
    escaped = False
    for i in range(start_idx, len(src)):
        ch = src[i]
        if in_string:
            if escaped:
                escaped = False; continue
            if ch == "\\":
                escaped = True; continue
            if ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True; continue
        if ch == "[":
            depth += 1; continue
        if ch == "]":
            if depth > 0: depth -= 1
            if depth == 0:
                return src[start_idx:i + 1]
    return ""

def recover_trade_plans(raw_text):
    raw = str(raw_text or "")
    clean = raw.strip()
    if "```" in clean:
        m = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', clean)
        if m: clean = m.group(1)
    clean = re.sub(r'^```json', '', clean)
    clean = re.sub(r'```$', '', clean).strip()
    if not clean: return []

    out = []
    seen = set()
    for m in re.finditer(r'"symbol"\s*:\s*"([^"]+)"', clean):
        sym = str(m.group(1) or "").strip().upper()
        if not sym: continue
        lookahead = clean[m.start():min(len(clean), m.start() + 20000)]
        tp_idx = lookahead.find('"trade_plan"')
        if tp_idx < 0: continue
        bracket_idx = clean.find("[", m.start() + tp_idx)
        if bracket_idx < 0: continue
        arr_text = extract_balanced_array(clean, bracket_idx)
        if not arr_text: continue
        try:
            arr = json.loads(arr_text)
        except:
            continue
        if not isinstance(arr, list): continue
        for p in arr:
            if not isinstance(p, dict): continue
            plan = {**p}
            if not plan.get("symbol"):
                plan["symbol"] = sym
            key = json.dumps([
                str(plan.get("symbol", "")).upper(),
                str(plan.get("trade_id", "")),
                float(plan.get("entry_price") or plan.get("entry") or float("nan")),
                float(plan.get("stop_loss") or plan.get("sl") or float("nan")),
                float(plan.get("take_profit") or plan.get("tp") or plan.get("tp3") or float("nan")),
            ])
            if key in seen: continue
            seen.add(key)
            out.append(plan)
    return out

# ── main ──
print(f"[test] reading {RESPONSE_FILE}")
with open(RESPONSE_FILE) as f:
    response = json.load(f)

raw = response.get("raw_response", "")
parsed_json = response.get("parsed_json", {})

# Try normal parse + recovery
plans = parsed_json.get("trade_plan", [])
recovered = []

# If JSON parse failed (trade_plan empty/missing), try recovery
if not isinstance(plans, list) or len(plans) == 0:
    print("[test] JSON parse failed or trade_plan empty, running recovery...")
    recovered = recover_trade_plans(raw)
    if recovered:
        print(f"[test] recovered {len(recovered)} plans from raw AI text")
        plans = recovered

# ── validate ──
print(f"\n{'='*60}")
print(f"Trade plans found: {len(plans)}")
print(f"{'='*60}")

results = []
all_pass = True
for i, p in enumerate(plans):
    sym = p.get("symbol", "?")
    entry = float(p.get("entry_price") or p.get("entry") or 0)
    sl = float(p.get("stop_loss") or p.get("sl") or 0)
    tp = float(p.get("take_profit") or p.get("tp") or p.get("tp3") or 0)
    decision = p.get("trade_decision") or p.get("skip_recommendation") or ""
    model = p.get("entry_model") or ""
    
    has_prices = entry > 0 and sl > 0 and tp > 0
    is_skip = str(decision).lower() in ("skip", "no valid setup")
    
    if has_prices:
        status = "✅ PASS"
    elif is_skip:
        status = "⚠️  SKIP"  # intentional skip is OK
    else:
        status = "❌ FAIL"
        all_pass = False
    
    print(f"  [{status}] {sym}: entry={entry} sl={sl} tp={tp} | {decision} | {model}")
    results.append({
        "symbol": sym,
        "entry": entry,
        "sl": sl,
        "tp": tp,
        "decision": decision,
        "model": model,
        "has_prices": has_prices,
        "status": status,
    })

# ── summary ──
requested = response.get("used_symbols", [])
passed_plans = [r for r in results if r["has_prices"]]
passed_symbols = set(r["symbol"] for r in passed_plans)
missing = [s for s in requested if s not in passed_symbols]

print(f"\n{'='*60}")
if missing:
    print(f"❌ FAIL: symbols without valid plans: {missing}")
    all_pass = False
elif all_pass:
    print(f"✅ PASS: all symbols have valid trade plans")
else:
    print(f"❌ FAIL: some plans missing prices")

# ── save ──
output = {
    "file": RESPONSE_FILE,
    "plans_found": len(plans),
    "plans_with_prices": len(passed_plans),
    "recovered": len(recovered) > 0,
    "missing_symbols": missing,
    "passed": not missing and all_pass,
    "results": results,
}
with open(OUT_FILE, "w") as f:
    json.dump(output, f, indent=2)
print(f"[saved] {OUT_FILE}")
sys.exit(0 if output["passed"] else 1)
