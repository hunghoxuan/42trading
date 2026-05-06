# Ticket: Chart Snapshots Symbols Panel Filters + Favorites

## Meta
- ID: `FEAT-20260502-SYMBOL-PANEL-FILTERS`
- Status: `BACKLOG`
- Priority: `P1`
- Requested by: `User`
- Implementer: `Deepseek` (coding)
- Reviewer/Release: `Codex` (review + deploy)
- Profile: `Fullstack Developer` (primary) + `UI-Designer` (secondary) + `Tester` (secondary)
- Target area: `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` (+ small style updates if needed)

## Problem Statement
Current symbols panel on Chart Snapshots page is missing quick segmentation by asset class and favorites, and the panel header wastes space with non-essential label text.

User-required UX updates:
1. Remove text label `Symbols` from symbols header row.
2. Keep existing `+` add button.
3. Add a symbols-panel visibility toggle button after `+` with states:
   - `Open >>` when panel is collapsed.
   - `Close <<` when panel is expanded.
4. On the same row where `ALL` currently appears, add filter tabs:
   - `Favourite | All | Crypto | Forex`
5. Clicking each tab filters visible symbol tags accordingly.
6. Need fixed default symbols for each asset type.
7. `Favourite` list must come from User Settings (user-owned preferences).

## Scope
- In scope:
  - UI behavior in Chart Snapshots symbols panel.
  - Client-side filtering logic for category tabs.
  - Favorites source wiring from user preferences (compatible with existing watchlist persistence).
  - Basic responsive layout for desktop + mobile.
- Out of scope:
  - New DB table/migration.
  - Large refactor of Chart Snapshots page.
  - New backend endpoint unless strictly required.

## Existing Technical Context (must preserve)
- Existing watchlist flow:
  - Read: `api.authMe()` returns `user.metadata.watchlist`.
  - Write: `api.updateMetadata({ watchlist: nextList })`.
- Current panel file:
  - `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
- Current default symbol source:
  - `DEFAULT_WATCHLIST` constant in same file.

## Required UX/Behavior Spec

### A) Header Row
- Remove `<span className="panel-label">Symbols</span>`.
- Keep search input and `+`.
- Add button after `+`:
  - Expanded state text: `Close <<`
  - Collapsed state text: `Open >>`
  - Must toggle a boolean state, e.g. `isSymbolPanelOpen`.

### B) Symbol List Visibility
- When `isSymbolPanelOpen = false`:
  - Hide symbol tags area (`ALL`, `Favourite`, `Crypto`, `Forex`, symbol chips).
  - Keep search + add + toggle row visible.
- When `isSymbolPanelOpen = true`:
  - Show full symbols/tabs area.

### C) Filter Tabs
- Replace current single `🌐 ALL` behavior with tab group:
  - `Favourite`
  - `All`
  - `Crypto`
  - `Forex`
- Default selected tab: `All`.
- Active tab style must reuse existing active button visual pattern (`snapshot-tag-v2 active`).
- Symbol chips shown under tabs must follow selected tab + search filter.

### D) Asset Type Classification Rules
- Implement deterministic local classifier function:
  - `Crypto`: symbols containing USD/USDT pairs commonly used as crypto in this app (e.g. `BTCUSD`, `ETHUSD`, `ADAUSD`, `XTIUSD` is NOT crypto).
  - `Forex`: standard FX pairs (e.g. `EURUSD`, `GBPJPY`, `AUDNZD`, etc.).
  - Any symbol not in `Crypto` or `Forex` still appears in `All` and can appear in `Favourite` if user selected it.
- Keep simple, explicit rules in code comments (1 short comment only where needed).

### E) Fixed Default Symbol Sets
- Add constants near `DEFAULT_WATCHLIST`:
  - `DEFAULT_CRYPTO_SYMBOLS` (fixed list, starter set)
  - `DEFAULT_FOREX_SYMBOLS` (fixed list, starter set)
- These lists drive tab content even for new users with empty metadata.
- `All` should still be union of current watchlist + existing defaults (deduplicated).

### F) Favourite Source of Truth
- Primary source: User Setting metadata, key `watchlist` (already persisted via `/auth/metadata`).
- On load:
  - `favourites = authMe.user.metadata.watchlist` normalized.
  - `Favourite` tab displays exactly this set (after normalization + dedupe).
- Backward compatibility:
  - If metadata missing/invalid -> fallback to empty array, do not crash.
- Existing `+` action:
  - Add symbol into favorites/watchlist and persist with existing `updateMetadata`.

### G) Search Behavior
- Search input continues to filter currently selected tab result.
- Keep current Enter-to-select behavior intact.

## Implementation Notes (Deepseek)
1. In `ChartSnapshotsPage.jsx`, add new state:
   - `isSymbolPanelOpen` default `true`.
   - `symbolFilterTab` default `"ALL"` (or enum string).
2. Add helper selectors:
   - `favoriteSymbols` from user metadata (existing watchlist state).
   - `allSymbols`, `cryptoSymbols`, `forexSymbols`.
   - `visibleSymbols` based on tab + search.
3. Keep data normalized with existing `normalizeWatchSymbol`.
4. Avoid touching unrelated chart logic, prompt generation, trade-plan flows.
5. Preserve current add/remove watchlist persistence behavior.

## Suggested Default Lists
- `DEFAULT_CRYPTO_SYMBOLS`: `BTCUSD`, `ETHUSD`, `ADAUSD`
- `DEFAULT_FOREX_SYMBOLS`: `EURUSD`, `GBPUSD`, `USDJPY`, `AUDUSD`, `USDCAD`, `USDCHF`, `NZDUSD`, `EURJPY`, `GBPJPY`, `AUDJPY`

## Acceptance Criteria
1. No `Symbols` label shown in the header row.
2. `+` button is still present and functional.
3. New toggle button appears after `+` and correctly collapses/expands symbol panel.
4. Tab row includes exactly `Favourite | All | Crypto | Forex`.
5. Clicking tabs filters symbols correctly.
6. Favorites load from user metadata watchlist and persist via existing flow.
7. Page works on desktop and mobile without layout break.
8. No regression in selecting symbol for analysis.

## Test Plan (Deepseek must run)
- UI build:
  - `rtk npm --prefix web-ui run build`
- Targeted behavior checks (manual):
  - Toggle open/close panel.
  - Add new symbol with `+`, verify appears in `Favourite`.
  - Switch tabs and verify symbol lists.
  - Refresh page and verify favorites persist.
  - Verify search filters current tab only.

## Reviewer Gate (Codex)
Review checklist before merge/deploy:
1. Confirm tab filter logic is deterministic and no stale state bug.
2. Confirm no accidental mutation of unrelated snapshot/analysis state.
3. Confirm no auth/session regressions around `authMe` or `updateMetadata`.
4. Confirm mobile layout remains usable.
5. Confirm build passes.

## Deploy Plan (Codex after review)
1. Re-run checks:
   - `rtk npm --prefix web-ui run build`
   - `rtk node --check webhook/server.js` (safety baseline)
2. If only UI changed, still follow project deploy rule if any backend/EA/script touched.
3. Deploy using standard script if approved:
   - `rtk bash scripts/deploy/deploy_webhook.sh`
4. Post-deploy smoke:
   - `https://trade.mozasolution.com/health`
   - `https://trade.mozasolution.com/ui/`
   - Verify symbols panel behavior in production UI.

## Risks
- Misclassification of non-FX/non-crypto symbols (indices/metals) if logic too broad.
- Accidental overwrite of watchlist semantics if tab logic mutates list.

## Mitigations
- Keep classifier explicit and conservative.
- Do not auto-write metadata except on explicit add/remove actions.
- Keep fallback to existing `DEFAULT_WATCHLIST`.
