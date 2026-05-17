## Handoff - 2026-05-14

### Merge / Sync status
- Branch: `main`
- HEAD: `f298869d`
- `origin/main`: `f298869d`
- Result: local `main` is fully synced with remote, no unmerged commits pending between `HEAD` and `origin/main`.

### Conflict status
- No merge conflict markers found in latest pushed history.
- No left/right commit delta in `git log --left-right --cherry-pick --no-merges HEAD...origin/main`.

### Uncommitted local workspace state (not part of pushed code)
- Modified/deleted/untracked local files exist, but they are unrelated workspace artifacts:
  - `.agents/.obsidian/workspace.json` (modified)
  - `HANDOFF_2026-05-08_AI_BROWSER.md` (deleted)
  - `.agents/sync/HANDOFF_2026-05-08_AI_BROWSER.md` (untracked)
  - `test-results/response1-parsed.json` (untracked)
  - `test-results/response1-raw.txt` (untracked)
  - `test-results/response2-parsed.json` (untracked)
  - `test-results/response2-raw.txt` (untracked)

### Recent pushed commits (latest first)
- `f298869d` fix: profile not defined
- `e8d92423` ui: force 4-TF detail layout and lock active tf on hover
- `9a74f8d8` fix: re-add profile bars
- `221ae549` feat: profile-based dynamic bars
- `54c170ee` chart: stabilize active tf, unify price field, and add P1/P2 quick-plan routing
- `351a1586` hotfix: remove SymbolChart TDZ by reordering latestCachedPrice memo
- `5efedc3d` hotfix: define barsCount defaults and pass bars count to chart data hook
- `19c0de22` chart: active tf debug, cursor price fallback, and out-of-range object hide

### Production status
- Last confirmed deployed version during prior checks: `v2026.05.13 21:32 - 9a74f8d8` (from `/health`).
- Note: commit `f298869d` is pushed; if no later deploy happened, deploy may still be needed for this commit to appear in server version.

### Known functional follow-up from user feedback
1. Buy/Sell still sometimes not writing Entry correctly.
2. Active TF may still drift under some hover/crosshair updates.
3. User expects stable 4-chart equal layout (d/4h/15m/5m) always visible.

### Suggested next actions
1. Bind quick action price strictly to right-click payload when it exists.
2. Freeze `activeChartId` while context menu is open; unfreeze after action/cancel.
3. Add debug line for `ctxMenu.chartId`, `ctxMenu.price`, `activeChartId`, `hoverInfo.price`.
4. Re-test `/ai/trade/BTCUSD` manually for Buy/Sell -> entry update path.
