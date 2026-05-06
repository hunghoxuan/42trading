# Common Errors & Bug Log

Record confirmed bugs here after fixing. Format per entry:
`## [Category] Short title` → Cause → Fix → Prevention.

> **Rule:** After removing any input, grep ALL occurrences before committing — there may be multiple call sites across different functions in the same file.

---

## [Pine Compile] `strategy.*` variables cannot be passed to imported library functions

**Date:** 2026-04-07
**Files:** Hung - SMC/MSS/Core.pine
**Impacts:** `strategy.equity`, `strategy.opentrades`, `strategy.closedtrades`

**Cause:** Pine strictly treats calls to imported library functions (`KitCore.xxx()`) as `request.*()` calls. Therefore, passing any variable that evaluates `strategy.*` scope state (e.g. `orderQty` via `strategy.equity`, or `orderId` via `strategy.opentrades`) will trace back to the strategy scope and break compilation.
Furthermore, `strategy.entry()`, `strategy.exit()`, and `strategy.cancel()` should NOT be delegated to library modules, as any IDs passed back and forth will cause scope chain tracking errors.

**Fix:** Keep all `strategy.*` evaluations AND strategy state-mutators (`strategy.entry`, etc.) LOCAL to the indicator:
```pine
// WRONG:
KitCore.submit_strategy_trade_order(orderId, dir, orderQty, ...) // orderId tracks strategy.opentrades!

// CORRECT — use local clones:
CORE_submit_strategy_trade_order(orderId, dir, orderQty, ...)
```

**Prevention:** Never pass `strategy.*` derived variables (`orderQty`, `orderId`, `propDayState[0]`) as arguments to imported library functions. Keep `track_`, `submit_`, and `cancel_` trade helper shells as local functions.

---

## [Pine Compile] Multiline `input.string()` with unicode chars causes "end of line without line continuation"

**Date:** 2026-04-07
**Files:** Hung - MSS.pine L505, Hung - SMC.pine L268, Hung - Core.pine L386

**Cause:** Pine parser fails when `input.string()` (or any `input.*()`) is split across multiple lines using named args AND the `tooltip` string contains unicode characters (`→`, `⚠`, `≤`, etc.) or `\n` escape sequences. The parser loses the line continuation context.

**Fix:** Collapse to a single line. Replace unicode chars with ASCII equivalents (`->`, `!`, `<=`). Remove `\n` from tooltip strings or simplify tooltip text.
```pine
// WRONG — multiline with unicode:
propPreset = input.string("None", "Trade Rules",
    options = [...],
    tooltip = "text → with → arrows\n⚠ warning",
    group = GROUP_TRADES_CONFIG)

// CORRECT — single line, ASCII only:
propPreset = input.string("None", "Trade Rules", options = [...], tooltip = "text -> with arrows | warning", group = GROUP_TRADES_CONFIG)
```

**Prevention:** Never use multiline `input.*()` calls at global scope. Always keep `input.*()` on one line.

---

## [Pine Compile] Orphan variable reference after input removal

**Date:** 2026-04-07
**Files:** Hung - SMC.pine

**Cause:** Removed `tradeMaxActive` and `gateUseMaxActive` input declarations but left downstream references inside `process_data_add_entry` at callsite `gateUseMaxActive ? math.max(tradeMaxActive, 1) : ...`.

**Fix:** Replace entire expression with `math.max(maxActiveCfg, 1)` — fall back to model-level config only.

**Prevention:**
- After removing any input/variable, grep entire file for all uses before committing.
- Run: `grep -n "tradeMaxActive\|gateUseMaxActive" "src/Hung - SMC.pine"`

---

## [Pine Compile] `@file-version` vs `@lib-version` header format mismatch

**Date:** 2026-04-07
**Files:** Kit - Core.pine, Kit - SMC.pine, Kit - UI.pine

**Cause:** Used `@file-version` format in KIT library file instead of `@lib-version: N`.

**Fix:** KIT files: `@lib-version: N` (integer). Indicator/strategy files: `@file-version: MMDD-NN`.

**Prevention:** See `rules/coding-standards.md` §1 version header policy.

---

## [Backup] Wrong backup directory used

**Date:** 2026-04-07

**Cause:** Backed up to `src-versions/0407-01/` instead of `backups/YYYYMMDD-index-note/`.

**Fix:** The correct backup command is:
```bash
mkdir -p "backups/20260407-01-prop-risk" && cp -R "src" "backups/20260407-01-prop-risk/"
```

**Prevention:** Always read `rules/backup.md` — backup dir is strictly `backups/`, not `src-versions/`.

---

## [KIT Policy] Direct KIT edit without local clone validation

**Date:** 2026-04-07

**Cause:** Added new types/functions directly to `Kit - Core.pine` without creating local clone in indicator first.

**Context:** User explicitly requested "đưa vào KIT" — treated as explicit promotion approval. Acceptable in this case but policy normally requires local clone → validate → promote.

**Prevention:** Always note in plan: "User explicitly approved direct KIT edit" when bypassing local-clone step.
