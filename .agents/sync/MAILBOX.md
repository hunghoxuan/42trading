# Multi-Agent Deployment Ledger (Read First)

Use this section for parallel-agent safety and deploy ordering.

## Current Deploy Lock

- lock_status: `UNLOCKED`
- deploy_owner: `NONE`
- since_utc: ``
- note: `Set lock_status=LOCKED before deploy; release after verification.`

## Required Entry Template

Copy and fill:

```md
### [YYYY-MM-DD HH:mm UTC] AGENT:<name>
- status: DOING | DONE | DEPLOYED | DEPLOY_BLOCKED
- branch: <branch>
- commit: <sha>
- scope: <files/modules>
- merge_to_main: NO | YES (sha)
- deploy:
  - owner: <name>
  - server_version: <value>
  - ea_version: <value>
  - result: PASS | FAIL
- verify:
  - /health:
  - /ui asset:
  - key endpoint:
- handoff_next: <agent/none>
```

## Parallel Agents Rule (A -> B -> C)

- Agent A merge -> deploy -> verify -> post ledger.
- Agent B must pull latest main after A deploy, then merge/deploy/verify.
- Agent C repeats only after B posts success.
- If any deploy fails, set `DEPLOY_BLOCKED` and stop next deployer.

# Handoff — 2026-05-08

> From: Codex session
> To: Next agent / Self

## What Was Done

### Broker Sync SSE Fixes
- **PnL not updating**: SDK SSE `tradeUpdates` only had `pnl_realized`, but UI reads `broker_pnl` first. Added `broker_pnl: it.pnl` to SSE payload.
- **SID mismatch**: `tradeKeyOf(r)` returned `r.id` (integer), but SSE map was keyed by `u.sid` (UUID). Fixed to match by `r.sid`.
- **Event listener churn**: `useRealtimeData` re-registered on every render. Fixed with `useRef`.

### Per-Value Flash Animation
- CSS `.value-flash` — very subtle accent pulse (`rgba(accent, 0.06)`, 0.8s fade)
- Tracks per-field changes via `changedFields` Map<sid, Set<fieldName>>
- `StatusPnlCell` accepts `flashFields` prop, applies `.value-flash` to pips/PnL divs

### Toast Fix (Add Trade from Signal)
- Root cause: `mt5Log` key was `event_type` but function checks `metadata.event`
- Fix: Changed `event_type` → `event` so `NotificationManager.handle` fires

### Signal Auto-Close
- After `+Trade` from signal, queries `execution_profiles` for other subscribers
- If none → `UPDATE signals SET status = 'CLOSED'`
- UI: `showAddTradeButton` hidden for CLOSED/FILLED/CANCELLED/etc signals

### Claude Files Cleanup
- 0 files on Anthropic API — already clean
- Cleared 373 stale entries from `.claude-files.json` + `.claude-context-files.json`

### Logs Page UI
- TYPE filter moved to same row as "Logs" title, right-aligned
- Bottom-sticky TickerBar added to Logs page

### ChartSnapshotsPage Refactor
- Removed Snapshots button + warming process (~350 lines)
- Removed status text display
- AI provider/model selects + Analyze button moved to right side
- Toolbar: `flexWrap: "nowrap"` keeps all controls on one row

### GPT-4o 404 Fix
- Backend: `gpt4o` → `openai` provider alias in `callAiProvider()`
- Frontend: `aiSourceFromModel` returns `"ai_gpt4o"` for GPT models

### Async Multi-Image Upload
- `attachedTradeImage` → `attachedTradeImages` (single to array)
- `attachTradeImageFile` → `addTradeImageFiles` (multi-file support)
- File input: `multiple` attribute
- Each image has individual `x` remove, + "Clear all" button
- `payload.attached_images` array sent to AI analyze endpoint

### Desktop Auth Fix
- Backend: `getUiSessionFromReq` reads `x-session-token` header in addition to cookies
- Login endpoint returns `token` in JSON response
- v3 API client bridges `tvbridge_api_base` + `tvbridge_api_key` localStorage keys

### V3 Desktop App (Phase 1)
- Tauri v2 + React + TypeScript in `app/ui/`
- Imports all v2 pages via `@v2/*` alias (Trades, Signals, Logs, Analyze, Settings)
- API URL + admin key inputs in header
- HomePage: dual auth (API key tab + Login tab)
- Health check with green/red dot
- 8.2MB bundle size
- Zed tasks: `.zed/tasks.json` (Launch, Restart, Build, Deploy, V3 Dev)
- Build script: `scripts/build_desktop.sh`
- Restart script: `scripts/restart_desktop.sh`

## Key Files Changed

| File | What |
|---|---|
| `webhook/server.js` | broker_pnl SSE, session token header, toast fix, signal auto-close, gpt4o fix |
| `web-ui/src/pages/trades/TradesPage.jsx` | SID matching, value-flash, changedFields |
| `web-ui/src/hooks/useRealtimeData.js` | useRef stabilization |
| `web-ui/src/components/TradeSignalListCells.jsx` | flashFields prop |
| `web-ui/src/styles.css` | .value-flash animation |
| `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` | Multi-image, remove snapshots/warmup, UI layout |
| `web-ui/src/pages/signals/SignalsPage.jsx` | showAddTradeButton conditional |
| `web-ui/src/pages/system/LogsPage.jsx` | TYPE filter move, bottom TickerBar |
| `app/ui/*` | New V3 desktop app |

## VPS Status
- Webhook: `v2026.05.08 18:38 - 45b9d87` — online, PM2
- Desktop app: built at `app/ui/src-tauri/target/release/bundle/macos/Antigravity.app`

## Outstanding / Next
- [ ] CHART_API logging (event type button exists, no code emits it)
- [ ] Desktop app "Disconnected" issue — CORS or Tauri WebView fetch problem, try `credentials: "omit"` + API key
- [ ] Tauri DMG bundling fails (`.app` works, need `create-dmg` or similar)
- [ ] Windows/Linux Tauri cross-compile
- [ ] V3 Phase 2: Hono + Drizzle backend migration (only if needed)
