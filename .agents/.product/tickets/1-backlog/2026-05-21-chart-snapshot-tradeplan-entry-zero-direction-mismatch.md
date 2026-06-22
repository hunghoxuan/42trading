# Chart Snapshot TradePlan Entry Zero + Direction Mismatch

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `Plan`
- Owner: `DeepSeek`
- Updated: `2026-05-21 15:41 UTC`

## Problem

On the Chart Snapshots Analyze page, after AI returns a response with valid `execution_plan.entry` data, the TradePlan form shows:
1. **Entry = 0** — even though JSON shows a valid entry price (e.g. `213.35`)
2. **Direction = BUY** — even though `raw_json` has `direction: "SELL"`
3. **Summary line**: `0 → 0 / 0 0.0r` — all zeros

The chart correctly renders the entry/SL/TP lines from JSON data, but the form state does not reflect the values.

### Context
- This is a follow-up to two prior deploy rounds (commit `b9263f97` + `283bb486`) which fixed TP2/TP3 wiring and added a context-menu level sync, but the entry/direction extraction still has a gap for certain AI payload shapes.

## Investigation

### Affected Functions (all in `src/ui/src/pages/ai/ChartSnapshotsPage.jsx`)

#### 1. `planEntryNumber` (L581-594)
Current candidate order:
```
plan?.execution_plan?.entry?.price  ← expects entry as object { price: N }
plan?.entry
plan?.entry_price
parsed?.execution_plan?.entry?.price
parsed?.entry
parsed?.price
```

**Missing:** `plan?.execution_plan?.entry` as a direct number value. In some AI payload shapes, `execution_plan.entry` is the price number directly (e.g., `213.35`), NOT an object `{ price: 213.35 }`. When `execution_plan.entry === 213.35`, then `execution_plan.entry?.price` is `undefined` → falls through all candidates → returns NaN → form shows 0.

**Fix:** Add `plan?.execution_plan?.entry` (raw, before `.price`) and `parsed?.execution_plan?.entry` to the candidates array.

#### 2. `planStopLossNumber` (L597-610)
Same issue. `execution_plan.stop_loss` may be a direct number, not an object.

**Missing:** `plan?.execution_plan?.stop_loss` and `parsed?.execution_plan?.stop_loss`.

#### 3. `extractPositionFromAnalysis` direction fallback (L1679-1690)
Direction is read from `plan.direction` or `parsed.direction`. In some payloads, direction lives in `execution_plan.direction` or inside nested objects.

Current: `String(plan.direction || parsed?.direction || "")`

**Missing fallbacks:**
- `parsed?.raw_json?.direction` or `parsed?.__raw_plan?.direction`
- Check if the plan has a canonical direction in `execution_plan.direction`

### Supporting Evidence
- TP2/TP3 now correctly show in info chart (prior deploy fixed this).
- Context-menu right-click → Entry now wires to form (prior deploy fixed this).
- The symptom "0 → 0 / 0 0.0r" means `parseNum` returned NaN for entry, sl, and tp — pointing to the raw plan extraction, not the UI mapping.
- The direction mismatch "BUY vs SELL" confirms the extraction chain is not reaching the canonical direction field.

## Solution

### Fix 1 — Add direct-number fallbacks to `planEntryNumber`

```/dev/null/planEntryNumber-fix.js#L1-10
function planEntryNumber(plan = {}, parsed = {}) {
  const candidates = [
    plan?.execution_plan?.entry?.price,
    plan?.execution_plan?.entry,           // ★ NEW: direct number
    plan?.entry,
    plan?.entry_price,
    parsed?.execution_plan?.entry?.price,
    parsed?.execution_plan?.entry,         // ★ NEW: direct number
    parsed?.entry,
    parsed?.price,
  ];
  for (const c of candidates) {
    const n = parseNum(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return parseNum(plan?.entry ?? plan?.entry_price ?? parsed?.entry ?? parsed?.price);
}
```

### Fix 2 — Add direct-number fallbacks to `planStopLossNumber`

```/dev/null/planStopLossNumber-fix.js#L1-10
function planStopLossNumber(plan = {}, parsed = {}) {
  const candidates = [
    plan?.execution_plan?.stop_loss?.price,
    plan?.execution_plan?.stop_loss,       // ★ NEW: direct number
    plan?.sl,
    plan?.stop_loss,
    parsed?.execution_plan?.stop_loss?.price,
    parsed?.execution_plan?.stop_loss,     // ★ NEW: direct number
    parsed?.sl,
    parsed?.stop_loss,
  ];
  for (const c of candidates) {
    const n = parseNum(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return parseNum(plan?.sl ?? plan?.stop_loss ?? parsed?.sl ?? parsed?.stop_loss);
}
```

### Fix 3 — Broaden direction extraction

In `extractPositionFromAnalysis` (L1679), add fallbacks:

```/dev/null/direction-fallback.js
const directionRaw = String(
  plan.direction ||
  plan?.execution_plan?.direction ||     // ★ NEW
  parsed?.direction ||
  parsed?.execution_plan?.direction ||   // ★ NEW
  ""
).trim().toUpperCase();
```

Same pattern in `extractPositionFromPlan` (L1792).

### Fix 4 — Add console.log for debugging

In `extractPositionFromAnalysis`, add a diagnostic log so we can confirm what values are resolved during extraction:

```/dev/null/debug-log.js
console.log('[extractPositionFromAnalysis] plan keys:', Object.keys(plan || {}).slice(0,15));
console.log('[extractPositionFromAnalysis] resolved entry:', entry, 'sl:', sl, 'direction:', direction);
```

Remove after verification.

## Expected Output / Verification

- [ ] AI response JSON with `execution_plan.entry` as direct number (not `{price}` object) → form ENTRY shows the value
- [ ] AI response JSON with `direction: "SELL"` in nested fields → form shows SELL
- [ ] Summary line below symbol shows real values (e.g. `213.35 → 214.80 / 212.90 2.4r`)
- [ ] No regression: entry still works for payloads with `execution_plan.entry` as object `{price: N}`
- [ ] Console shows debug log with resolved values on mount
- [ ] Deploy + verify /health, /ui, and in-page smoke

## Notes for DeepSeek

- Two prior deploy rounds already applied: `b9263f97` (context-menu + tp2/tp3 wiring) and `283bb486` (initial entry hydration). These are on `origin/main`.
- The `parseNum` function handles comma decimals (`"213,35"` → `213.35`) — no issue there.
- The `effectiveParsed` → `useEffect(L4700)` → `extractPositionFromAnalysis` chain is correct; the bug is inside `planEntryNumber`/`planStopLossNumber` missing raw `execution_plan.entry` (direct number) as fallback.
- Work on branch: `2026-05-21-chart-tradeplan-entry-direction-fix`
- See also: `.agents/sync/MAILBOX.md` for full deploy history.
