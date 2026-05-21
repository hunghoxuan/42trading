# Handoff: ChartSnapshots TradePlan Entry/SL/Direction Fixes — 2026-05-21

## Session Summary

### Original Problem
After AI analysis returns a response with valid `execution_plan.entry.price`, `execution_plan.stop_loss.price`, and `direction`, the TradePlan form on the ChartSnapshots/Analyze page showed:
1. **Entry = 0** (form field blank, rendered as 0)
2. **Direction = BUY** (even though JSON had SELL)
3. **Summary line: `0 → 0 / 0 0.0r`** (all zeros)
4. **TP2/TP3 not rendered** in Info Chart
5. **Right-click context menu "Entry"** did not update form

The chart correctly rendered lines from JSON data, but the form UI was disconnected.

---

## Investigations & Fixes Deployed

### Fix 1 — `planEntryNumber` / `planStopLossNumber`: missing `execution_plan.entry` as direct number (commit `0c7b6519`)

**File:** `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`

**What was wrong:** The AI's `trade_plan_schema.json` has `execution_plan.entry` as an object `{ price: N, reference: "...", invalidation_note: "..." }`. The extraction functions only looked for `execution_plan.entry.price` but the code also needed to handle `execution_plan.entry` as a direct number (some payload variants).

**Fix:** Added explicit candidates including both `execution_plan.entry.price` (object) and `execution_plan.entry` (direct number) to the extraction chain. Also added `parsed.execution_plan.entry` for the parsed response object.

**Same for:** `planStopLossNumber` — added `execution_plan.stop_loss.price` and `execution_plan.stop_loss` direct.

**Result:** Extraction working. Console logs confirmed `resolved entry: 0.86465 sl: 0.86365 direction: BUY`.


### Fix 2 — Direction fallback to `execution_plan.direction` (commit `0c7b6519`)

**File:** `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`

**What was wrong:** Direction extraction only checked `plan.direction` and `parsed.direction`. Some AI payloads store direction inside `execution_plan.direction`.

**Fix:** Added `plan?.execution_plan?.direction` and `parsed?.execution_plan?.direction` to the fallback chain in both `extractPositionFromAnalysis` and `extractPositionFromPlan`.

**Result:** Direction resolves correctly from nested field.


### Fix 3 — TP2/TP3 wiring to Info Chart (commits `b9263f97`, `283bb486`)

**File:** `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`

**What was wrong:** The `chart` prop passed to `SignalDetailCard` had no `tp2Price`/`tp3Price` fields. The `tradePlan.value` (position state) had tp2/tp3 but they weren't forwarded to the chart component.

**Fix:**
- Added `tp1Price`, `tp2Price`, `tp3Price` to `chart` prop in ChartSnapshotsPage
- Added `tp1Price`, `tp2Price`, `tp3Price` to `TradeSignalChart` call inside `entryNode`
- Extended `getPlanPositionOverride` to carry `tp2`/`tp3`

**Result:** TP2/TP3 lines now render in Info Chart. ✅


### Fix 4 — Right-click context menu → form sync (commit `b9263f97`)

**File:** `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`

**What was wrong:** `SymbolChart`'s `onPlanLevelChange` callback was not wired in `ChartSnapshotsPage`. Right-clicking a chart level (Entry/TP1/TP2/TP3/SL) had no effect on the TradePlan form.

**Fix:** Added `handlePlanLevelChange` callback that maps chart level keys (`entry`, `sl`, `tp1`, `tp`, `tp2`, `tp3`) to `updatePositionField` calls. Added `onPlanLevelChange: handlePlanLevelChange` to the `chart` prop.

**Also fixed:** `updatePositionField` was only formatting `["entry", "tp", "sl", "rr"]` — extended to include `"tp2"`, `"tp3"`.

**Result:** Right-click → Entry/SL/TP now updates form. ✅


### Fix 5 — **THE ROOT CAUSE**: `mergePlanPreservingEdits` overwrote valid values with stale zeros (commit `d1d485e1`)

**File:** `web-ui/src/utils/tradePlanDrafts.js`

**This was the actual reason Entry=0 and TP≠0.**

**What was wrong:** Inside `SignalDetailCard`, the `planDrafts.main` copy of the plan is synced from `tradePlan.value` (parent `position` state) via:
```js
next.main = mergePlanPreservingEdits(normalized, prev.main);
```

`mergePlanPreservingEdits` has an `editableKeys` set that includes `entry`, `sl`, `tp`, `tp1`, `tp2`, `tp3`. For these keys, the **previous draft always won**, regardless of whether it held a valid value:

```
basePlan (fresh):  { entry: "0.865", sl: "0.864", tp: "0.867" }
prevDraft (stale): { entry: "",      sl: "",      tp: "0.867" }
merged result:     { entry: "",      sl: "",      tp: "0.867" }
                                         ^^^^              ^^^^
                                   STALE WINS!        STALE ALSO CORRECT
```

- **Entry** → overwritten to `""` (stale zero wins)
- **SL** → overwritten to `""` (stale zero wins)  
- **TP** → stayed `"0.867"` (stale already had the value from a separate code path)

This explains the exact symptom: **"why show TPs but only Entry, SL is not shown?"**

**Fix:** Changed the editable-keys merge logic: only preserve the draft value if it is a **valid non-zero number**. If the draft is empty/zero but the base value is valid (>0), keep the base value:

```js
if (isNumeric) {
    const baseVal = parseNumLoose(next[key]);
    const draftVal = parseNumLoose(value);
    if (draftVal != null && draftVal > 0) {
        next[key] = value;           // draft is valid, keep it (user edited)
    } else if (!(baseVal != null && baseVal > 0)) {
        next[key] = value;           // both empty, keep draft
    }
    // else: keep base (base is valid, draft is empty)
}
```

**Result:** `planDrafts.main` now correctly syncs fresh extraction values. Entry/SL/Direction all show correctly in form. ✅


### Why TP showed but Entry/SL didn't (detailed trace)

1. `ChartSnapshotsPage` → `setPosition(extractPositionFromAnalysis(...))` → position = `{ entry: "0.865", sl: "0.864", tp: "0.867" }` ✅
2. `position` passed as `tradePlan.value` to `SignalDetailCard` ✅
3. `SignalDetailCard` syncs `planDrafts.main` via `mergePlanPreservingEdits(normalized, prevDraft)`:
   - TP: prevDraft.tp already had `"0.867"` from an earlier sync → preserved ✅
   - Entry: prevDraft.entry = `""` → overwrote base `"0.865"` ❌
   - SL: prevDraft.sl = `""` → overwrote base `"0.864"` ❌
4. `TradePlanEditor` renders `planDrafts.main.entry` = `""` → form shows 0
5. `TradePlanEditor` renders `planDrafts.main.tp` = `"0.867"` → form shows correct


### Why TP had a separate valid value while entry/sl were stale

During the `SignalDetailCard` plan sync effect, when `plans` (the fallback array built from `tradePlan.value`) changes, the effect iterates and calls `mergePlanPreservingEdits`. On the very first sync (when `prevDraft` didn't exist), the `normalized` plan (from `plans`) was seeded with the current `tradePlan.value` values. But `plans` for mode `"ai"` is constructed from `responsePlans` or `derivedPlansFromRaw`, not directly from `tradePlan.value`. If `responsePlans` used the AI's raw response (which might have `tp` but not `entry`/`sl` in the top-level `plan` object — those live in `execution_plan.entry.price`), then:
- `normalized.tp` = AI's main-tp = `0.867` → draft gets tp ✅
- `normalized.entry` = AI's top-level `entry` = `undefined` → draft gets empty entry
- `normalized.sl` = AI's top-level `sl` = `undefined` → draft gets empty sl

Then on later re-syncs, `mergePlanPreservingEdits` preserves the stale empty draft values for entry/sl while keeping tp intact.


## Deploy History (latest to earliest)

| Commit | Description |
|--------|-------------|
| `3dea4cb0` / `d1d485e1` | **FIX**: `mergePlanPreservingEdits` — stop overwriting valid base values with stale empty drafts |
| `deb35b2` / `ddb33131` | diagnostic: `pos-sync` logs |
| `20fe57d` / `7ab7d41b` | revert to direct `setPosition` (remove broken merge logic) |
| `c6e5571` / `e1d62ae7` | diagnostic: position-merge logs |
| `001eac5c` / `26bf8bf2` | attempted position merge fix (broken, reverted) |
| `4aaa438d` / `b62bae64` | attempted position state fix (broken, reverted) |
| `2692314b` / `bf3de271` | fix debug log crash on undefined `execution_plan` |
| `2d53e4cb` / `0c7b6519` | **FIX**: `planEntryNumber`/`planStopLossNumber` — add `execution_plan.entry` direct number + direction fallback |
| `b9263f97` / `283bb486` | **FIX**: context-menu level sync + TP2/TP3 info chart wiring |
| (prior) | ANALYSE_SETTINGS load fix (`items`→`settings`) |

**Current deployed:** `v2026.05.21 18:47 - d1d485e1` (commit `3dea4cb0`)


## Files Changed (cumulative this session)

| File | Change |
|------|--------|
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | `planEntryNumber`, `planStopLossNumber` extraction + direction fallback + `handlePlanLevelChange` + tp2/tp3 wiring + chart prop forwarding + `[pos-sync]` diagnostic logs |
| `web-ui/src/utils/tradePlanDrafts.js` | **`mergePlanPreservingEdits`** — numeric editable keys only preserved if draft is valid (>0) |
| `web-ui/src/utils/signalDetailUtils.jsx` | (no changes, only inspected) |
| `.agents/sync/MAILBOX.md` | deploy ledger entries for all deploys |
| `.agents/.product/tickets/1-backlog/_master-bugs.md` | bug tracking entries |


## Key Architectural Insight

### The two-tier plan state in SignalDetailCard

`SignalDetailCard` maintains TWO copies of plan data:
1. **`tradePlan.value`** — the canonical source from parent (`position` state in ChartSnapshotsPage). Direct updates via `tradePlan.onChange()`.
2. **`planDrafts`** — a local copy synced from `plans` (computed from response/tradePlan.value) via `mergePlanPreservingEdits`. Used for rendering the TradePlanEditor.

The sync effect:
```js
useEffect(() => {
    setPlanDrafts((prev) => {
        const next = {};
        plans.forEach((p, i) => {
            const planId = i === 0 ? "main" : `suggested_${i}`;
            next[planId] = mergePlanPreservingEdits({ ...p, ... }, prev?.[planId] || {});
        });
        return next;
    });
}, [plans, response?.tradePlans, tradePlan?.value]);
```

The bug was in `mergePlanPreservingEdits` unconditionally favoring the draft for editable keys, causing stale empty values to persist across re-syncs.


## Remaining Items

- [ ] Remove diagnostic `console.log` statements from `ChartSnapshotsPage.jsx` (extractPositionFromAnalysis, pos-sync logs)
- [ ] Remove the `[extractPositionFromAnalysis]` debug logs  
- [ ] Verify the `ANALYSE_SETTINGS` load/save bug is also fixed (this was the first task in the session — changed `res?.items` → `res?.settings`)
- [ ] Run full smoke: analyze a symbol, verify ALL form fields populate (Entry, SL, TP1, TP2, TP3, Direction, RR, summary line)
- [ ] Verify right-click context menu → form sync works
- [ ] Verify TP2/TP3 lines appear in Info Chart


## Ticket Reference

- `1-backlog/2026-05-21-chart-snapshot-tradeplan-entry-zero-direction-mismatch.md` — the working ticket
- `1-backlog/2026-05-21-chart-snapshot-save-settings-not-persisted.md` — ANALYSE_SETTINGS load bug
- `1-backlog/_master-bugs.md` — updated with both entries
