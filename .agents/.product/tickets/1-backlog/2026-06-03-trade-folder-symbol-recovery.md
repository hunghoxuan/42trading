# Fix Bug: Trade Folders Created Without Symbol Suffix

## Meta
- Ticket Type: `Fix bug`
- Ticket Status: `In progress`
- Severity: `P1`
- Owner: `Codex`
- Updated: `2026-06-03`
- Related Area: `webhook/server.js`, trade folder filesystem routing

---

## Problem
Trade folders appeared as bare `{sid}` or `{sid}-UNKNOWN` instead of the required `{sid}-{symbol}` format.

Examples investigated:
- `data/default/trade_active/TG0VX4QAG` -> DB symbol `XAUUSD`
- `data/default/trade_active/TG0VZIBRD` -> DB symbol `ETHUSD`
- `data/default/trade_active/TG17ANAJL` -> DB symbol `GBPAUD`
- older closed folders including bare `TFU...` folders and `TG1KW5LQ9-UNKNOWN`

Expected:
- Every folder under `data/default/trade_active`, `data/default/trade_files`, and `data/default/trade_closed` must include a symbol suffix: `{sid}-{symbol}`.
- If code finds a bare `{sid}` folder, it must recover the symbol and rename/merge the folder before returning/using it.

---

## Investigation Summary

### 1. `ensureTradeDir()` had a bare fallback
`ensureTradeDir(sid, symbol, category)` tried:
1. supplied symbol -> `{sid}-{symbol}`
2. existing `{sid}-*` in the requested category
3. `inferSymbolFromTradeFolder()` across all categories
4. last fallback -> `{sid}`

The user explicitly rejected changing this fallback to `{sid}-UNKNOWN`. The fallback remains bare, but creator paths are now guarded so they should not create through it when symbol can be found.

### 2. `resolveTradeDir()` could return an exact bare `{sid}` folder unchanged
Before patch, if `resolveTradeDir()` found exact folder `{sid}` and no symbol argument was passed, it returned the bare folder path.

Required behavior:
- If exact `{sid}` exists, find symbol from DB first.
- If DB lookup fails, read `{sid}/logs/payload.json`.
- If symbol is found, rename/merge folder to `{sid}-{symbol}`.
- Return fixed folder path.

### 3. Some actual creators reached folder helpers with no symbol
Actual creator chain:
- `fileLog()` -> `resolveLogFile()` -> `resolveTradeDir()` -> `mkdir logs`
- `tradeLogsDir()` -> `resolveTradeDirForCreate()` -> `mkdir logs`
- `tradeSnapshotDir()` -> `resolveTradeDirForCreate()` -> `mkdir snapshots`
- `chartObjectsPath()` -> `ensureTradeFilesDir()`/`resolveTradeDirForCreate()` -> `mkdir`
- `copySnapshotsToTradeSidFolder()` -> `tradeSnapshotDir()`
- `persistTradeSnapshotFiles()` metadata used symbol-less fallback before patch
- `moveTradeFolder()` could move a bare folder into another category without adding symbol

### 4. Existing filesystem had more symbolless folders than the initial three
A full sweep found and fixed/deleted folders under all three roots:
- `trade_active`
- `trade_files`
- `trade_closed`

Folders with recoverable symbol were renamed/merged. Folders with no symbol in DB or local payload files were deleted.

---

## Implemented Solution

### A. Recovery inside `resolveTradeDir()` and `findExistingTradeDir()`
Added helpers:
- `readTradeSymbolFromDbSync(safeSid)`
- `readTradeSymbolFromPayloadFileSync(tradeDir)`
- `mergeTradeFolderSync(src, dst)`
- `repairBareTradeDirSync(baseDir, safeSid, bareDir)`

When exact `{sid}` is found:
1. Query DB synchronously by `sid`.
2. If no DB symbol, read `{sid}/logs/payload.json`.
3. If symbol found, rename/merge to `{sid}-{symbol}`.
4. Return repaired path.

### B. Creator guard
Added `resolveTradeDirForCreate(sid, symbol, category)`.

It tries:
1. supplied symbol
2. symbol inferred from existing `{sid}-*`
3. existing folder by SID
4. throw `trade folder symbol not found for sid ...`

This prevents new symbolless trade folders from being created by log/snapshot/chart-object routes.

### C. Existing folder sweep
Ran a full sweep over:
```text
data/default/trade_active
data/default/trade_files
data/default/trade_closed
```

Actions:
- Rename/merge when symbol could be recovered from DB or payload files.
- Delete when no symbol was recoverable.

Final scan result:
```json
{ "folders_without_symbol": [] }
```

---

## Current Important Code Points
- `webhook/server.js`
  - `findExistingTradeDir()` prefers `{sid}-*`, repairs exact `{sid}`
  - `resolveTradeDir()` repairs exact `{sid}` via DB then payload
  - `resolveTradeDirForCreate()` guards creators
  - `tradeLogsDir()` and `tradeSnapshotDir()` use guarded create path
  - `chartObjectsPath()` uses guarded create path
  - `copySnapshotsToTradeSidFolder()` skips if no symbol can be inferred
  - `persistTradeSnapshotFiles()` resolves symbol by SID internally
  - `moveTradeFolder()` accepts symbol and renames bare source folders during move

---

## Verification Run
Commands passed:
```bash
rtk node --check webhook/server.js
rtk node --test scripts/test/syncGuards.test.mjs
rtk bash scripts/start/reset_stack_once.sh
rtk bash scripts/test/verify_webhook_local.sh
```

Filesystem verification:
```json
{ "folders_without_symbol": [] }
```

---

## If This Happens Again
1. Run a full scan of trade folder roots, not only `trade_active`.
2. For each bad folder:
   - derive SID from folder name
   - look up `trades.symbol` by SID
   - if DB misses, inspect `logs/payload.json`
   - rename/merge to `{sid}-{symbol}` or delete if no symbol exists
3. Check for new creator paths that bypass:
   - `resolveTradeDirForCreate()`
   - `tradeLogsDir()`
   - `tradeSnapshotDir()`
   - `chartObjectsPath()`
   - `copySnapshotsToTradeSidFolder()`
4. Search for direct mkdir/copy paths under:
   - `TRADE_FILES_DIR`
   - `TRADE_ACTIVE_DIR`
   - `TRADE_CLOSED_DIR`
5. Any new route that accepts only `{sid}` must resolve the DB trade row before writing files.

Suggested scan script:
```js
const fs = require("fs");
const roots = [
  "data/default/trade_active",
  "data/default/trade_files",
  "data/default/trade_closed",
];
function isSymbolFolder(name) {
  const idx = name.lastIndexOf("-");
  if (idx <= 0) return false;
  const suffix = name.slice(idx + 1).toUpperCase();
  return /^[A-Z0-9]{2,20}$/.test(suffix) && suffix !== "UNKNOWN";
}
const bad = [];
for (const root of roots) {
  if (!fs.existsSync(root)) continue;
  for (const name of fs.readdirSync(root)) {
    const full = `${root}/${name}`;
    if (!fs.statSync(full).isDirectory()) continue;
    if (!isSymbolFolder(name)) bad.push(full);
  }
}
console.log(JSON.stringify({ folders_without_symbol: bad }, null, 2));
```

---

## Acceptance Criteria
- [x] No existing folders without symbol suffix in trade roots.
- [x] Exact bare `{sid}` folders are repaired by `resolveTradeDir()` when symbol can be found.
- [x] DB lookup is attempted before `{sid}/logs/payload.json`.
- [x] Creator paths do not create new symbolless trade folders.
- [x] Local webhook verification passes after patch.

