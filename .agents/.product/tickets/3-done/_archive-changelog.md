# Changelog (Latest first)

## 2026.04.30
- [x] [11:20] [Web-UI/UX] [Author: Antigravity] Task: **Navigation & Settings Consolidation**.
  - **Unified Profile**: Merged Preferences (Language/Timezone), Security (Password), and Execution (Routing/Accounts) into a single, sectioned Profile page.
  - **Unified Settings**: Integrated technical "System Settings" (Market Data Cron, AI Analysis Cron) and "User Settings" (API Keys, Watchlists) into a single, sidebar-driven Settings hub.
  - **Menu Reorganization**: Renamed "Settings" to "User", moved "Logout" and "Accounts" under the "User" dropdown, and simplified the "System" menu to infrastructure-only tools.
  - **Routing Stability**: Updated SPA fallback in `server.js` to handle dynamic system paths correctly on page refresh.
- Version: 2026.04.30-1120

## 2026.04.27
- [x] [13:36] [Web-UI/AI] [Author: Gemini] Task: **Signal & Trade Detail Data Restoration**.
  - **Data Integrity**: Restored missing detail fields (Entry Model, Strategy, Signal SID, Note, Account, Ticket) to `metaItems` in Signal and Trade detail views.
  - **Analysis UI**: Added a dedicated text section in the "Analysis" tab to display the full AI rationale rationale alongside trend/bias metrics.
  - **History Logs**: Fixed timeframe selection logic for detail charts to ensure fallback to `{ signal_TF, 15m, 4H, 1D }` with proper sorting/deduplication.
  - **Date Formatting**: Implemented "Today" and "Yesterday" labels in `showDateTime` utility for better readability in lists.
  - **Header Cleanup**: Consolidated duplicate headers in `SignalDetailCard` to save space.
- Version: 2026.04.27-1336

- [x] [13:35] [Web-UI/AI] [Author: Gemini] Task: **Symbol Search & Profile Sync Hardening**.
  - **Search Box**: Decoupled `searchTerm` from `cfg.symbol`; search results filter as you type, but charts only update on selection or Enter. Removed 'UK100' as default.
  - **Symbol Chips**: Preserve visibility of other chips when one is selected; clicking a chip updates the selected symbol without narrowing the list to only that chip.
  - **Profile Sync**: `SignalDetailCard` now strictly initializes its chart timeframes (Tabs) to match the selected strategy profile (HTF, Exec, Conf).
  - **Chart Rendering**: Improved plan deduplication in `TradeSignalChart` to prevent showing 3 plans when only 2 exist (fixed price proximity matching).
- Version: 2026.04.27-1335

- [x] [12:55] [Web-UI/AI] [Author: Gemini] Task: **AI Analysis UI & Prompt Hardening**.

## 2026.04.26
- [x] [16:22] [Web-UI/Charts] [Author: Gemini] Task: **Multi-TF Chart UI Hardening**. 
  - Overhauled `SignalDetailCard` with side-by-side Chart/Live view.
  - Enforced 3:2 aspect ratio for all charts and removed redundant footers.
  - Improved tab visibility logic: "Analysis" and "Json" tabs are now hidden until AI response is received.
  - Defaulted to Live-only mode before analysis, auto-enabling static charts post-analysis.
  - Removed redundant "Snapshots" tab.
- [x] [14:00] [Backend/Sync] [Author: Gemini] Task: **Trade Volume Sync Fix**. Resolved issue where MT5 reported lots were being ignored; volume is now correctly updated on broker sync.
- [x] [14:05] [Database/Perf] [Author: Gemini] Task: **Trades API Speedup**. Added indexes to `trades` table (symbol, account, signal, broker_id).
- Version: 2026.04.26-1622

## 2026.04.20
- [x] [13:38] [Scripts/AI] [Author: Gemini] Task: **Multi-Model AI CLI Gateway**. Implemented `scripts/ai.js` for manual selection and querying of DeepSeek and Qwen (Ollama). Added VS Code tasks (`.vscode/tasks.json`) for IDE-level model selection and prompting. Removed experimental auto-audit from webhook server to honor manual-use preference.
- [x] [13:41] [Docs/AI] [Author: Gemini] Task: **AI Model Guidelines & Global Config**. Created `docs/AI_GUIDE.md` for model selection/verification instructions. Expanded `provider_config.yaml` with templates for GPT-4o, Claude 3.5, and OpenRouter. Enabled global configuration support via `~/.gemini/antigravity/provider_config.yaml`.
- Version: 2026.04.20-1141


## 2026.04.18
- Fully decoupled **Signals** (Reference Feed) from **Trades** (Execution Ledger) in Web-UI.
- Linked Signals UI strictly to `signals` DB table and Trades UI strictly to `trades` V2 ledger.
- Standardized UI Toolbar layouts: "Create" button position now follows "Apply" rule on all pages.
- Implemented Dedicated Detail Pages for both Signals (`SignalDetailPage.jsx`) and Trades (`V2TradeDetailPage.jsx`).
- Fixed rendering race conditions and `TypeError` crashes on V2 Trades list.
- Version: 2026.04.17-48 (Stable)

## 2026.04.17
- Added V2 Broker Registry UI and Backend API.
- Implemented Account Detail Drawer in Accounts V2 page (Subscriptions + Recent Trades + Heartbeat).
- Standardized Timeframe display across all dashboard pages (1m, 15m, 1h, etc).
- Enforced 'Create' button positioning after 'Apply BulkAction' across all pages.
- Restored missing onBulkOk and BULK_ACTIONS constants to resolve dashboard crashes.
- Version: 2026.04.17-48
- [x] Unify Timeframe format to numeric in DB, string labels in UI.
- [x] Standardize Dashboard Toolbar layout (Create button position).
- [x] Implement Account Detail Drawer (Subscriptions + Trade History).
- [x] Implement Broker Registry UI (Brokers Table + Mapping).
- [ ] Implement V2 Broker Sync (Pull/Ack) Protocol.
- [ ] Implement V2 Multi-Account Dispatcher Fan-out.
- [x] [22:46] [webhook + web-ui] [Author: Codex] Task: Added guarded account archive flow (`DELETE /v2/accounts/{id}`) with open/pending trade protection and `ARCHIVE` action in Accounts V2 UI. Live smoke verified: archive success on empty account and blocked response with `blocking_open_trades` on active account.
- [x] [22:42] [webhook + web-ui] [Author: Codex] Task: Execution Hub V2 account management completed. Added `/v2/accounts` POST + `/v2/accounts/{id}` PUT, `Accounts V2` admin page (create/edit/status toggle/rotate key), and deployed live bundle `index-12fYXWHN.js` with production smoke verification.
- [x] [22:42] [webhook] [Author: Codex] Task: Fixed nullable account balance regression in v2 account update flow (omitted balance no longer coerces `null -> 0`). Verified via live API create/update regression smoke.
- [x] [22:18] [webhook + web-ui] [Author: Codex] Task: Execution Hub V2 source security lifecycle completed. Added source auth-secret rotate/revoke APIs, `source_events` audit table/API, and Sources UI controls/audit viewer. Deployed live (`index-BKaMxoxM.js`) and verified with `/webhook/v2/sources/{id}/auth-secret/*` + `/webhook/v2/sources/{id}/events`.
- [x] [22:32] [webhook + web-ui] [Author: Codex] Task: Execution Hub V2 trade observability completed. Added admin read APIs `/v2/trades` and `/v2/trades/{id}/events`, plus `Execution V2` page for filters/list/detail events. Deployed live (`index-BWHjpCJz.js`) and verified via production smoke calls.

## 2026-04-16
- [x] [14:02] [webhook + EA] [Author: Gemini] Task: **Full State Reconciliation System**. Implemented `/mt5/ea/sync` and `/mt5/ea/bulk-sync` in server.js, added `SyncWithVps()` 5-min reconciliation loop in `TVBridgeEA.mq5`, and resolved VPS deployment conflicts (untracked node_modules). Server v04 / EA v12.

## 2026-04-15
- [x] [17:38] [webhook + webhook-ui] [Author: Codex] Task: Implemented dashboard v2 metric simplification (removed PnL toggle, enforced trade scope TP/SL/START/OK, strict winrate TP/(TP+SL), redesigned KPI/period cards, removed summary tiers/status breakdown, and added direction-aware top tables with Name|W|L|WR|PnL|RR).
- [x] [16:31] [.agents tracking] [Author: Codex] Task: Synced cross-agent docs after FE completion (cleaned stale backlog items, replaced mailbox handoff, and updated architecture with implemented dashboard status + remaining gap).
- [x] [16:20] [webhook + webhook-ui] [Author: Codex] Task: Completed FE-02 Advanced Dashboard. Added backend `/mt5/dashboard/advanced` (account/symbol/strategy filters, metric mode total/avg, summary tiers, status breakdown, period totals today/week/month/year, top winrate tables by symbol/entry-model/account, filtered pnl series), upgraded dashboard UI controls/tables/charts, and deployed-ready version bumps.
- [x] [15:54] [webhook-ui] [Author: Codex] Task: Completed FE-01 Phase 1 (Trade Card + Status badge standardization). Implemented badge mapping (`OK->PLACED`, `LOCKED`, `START`, `TP`, `SL`, `OTHER`), rigid metric row (`Price|TP|SL|RR|Volume|PnL`), removed `PnL:` label, and added safe fallback formatting for legacy/zeroed fields.
- [x] [15:46] [Backend] [Author: Gemini] Task: `BE-01` Database schema `entry_model` ingestion complete. Added Postgres/SQLite schema hooks and `/signal` webhook parser.
- [x] [15:41] [.agents/workflows] [Author: Codex] Task: Standardized SOP workflows 10-17 and added 18 (update docs), 19 (list roadmap/tasks), 20 (smoke test), plus workflow intent index.
- [x] [12:20] [Schema Docs] [Author: Codex] Task: Synced DB schema docs with current `server.js` and clarified `accounts` concept + heartbeat upsert TODO.
- [x] [12:05] [TVBridgeEA.mq5] [Author: Gemini] Feature: Implemented EA Client-to-VPS Sync feature (PENDING ack tracking in OnTradeTransaction, and OnTimer heartbeat payload).
- [x] [12:05] [webhook/server.js] [Author: Gemini] Feature: Multi-Account support and DB Schema update (`accounts` table, JSON `metadata` columns, Account ID routing).
- [x] [11:25] [.agents] [Author: Gemini] Refactored legacy `roadmap.md` into segmented Sprint/Backlog/Bugs/Changelog system using Markdown Kanban SOPs.
- [x] [09:00] [.agents] [Author: Gemini] Restructured `.agents/` to a flat, 4-entry-file system with minimal supporting subdirectories. Archived unused folders.
- [x] [08:50] [rules.md] [Author: Gemini] Migrated global coding constraints strictly into a single `.agents/rules.md` file.
- [x] [08:30] [GEMINI.md] [Author: Gemini] Updated root `GEMINI.md` to point strictly to the single source of truth in `.agents/rules.md`.

## 2026-04-14
- [x] [18:00] [Performance] [Author: User] Core: strategy-meta per-bar cache + reduced duplicate target lookups.
- [x] [18:00] [Performance] [Author: User] MSS: reduced duplicate strategy-meta calls in Sweep->MSS->FVG path.
- [x] [18:00] [Performance] [Author: User] SMC: invariant extraction in add-entry loop.
- [x] [17:00] [EntryModel] [Author: User] Added shared-shape local dynamic config/checker methods in Core/SMC/MSS.
- [x] [17:00] [EntryModel] [Author: User] Wired model-level RR/risk/bias checks through config bridge from legacy Trade Config.
- [x] [16:00] [EntryModel] [Author: User] Replaced bridge defaults with per-model config maps (Core/SMC/MSS). Added tokenized `required_previous_events` parser + per-model lookback window.
- [x] [14:00] [EntryModel] [Author: User] Extended `EntryModelDef` with dynamic trade fields and moved defaults into model init entries. Replaced switch-based config with schema lookup.
- [x] [11:00] [Dashboard] [Author: User] Enabled SMC realtime intrabar execution (`calc_on_every_tick = true`) so dashboard updates do not wait for candle close.

## 2026-04-24
- [x] [14:10] [Web-UI/API] [Author: Gemini] Task: [COMPLETED] Update DB Page with table schema + data view.
- [x] [14:10] [Web-UI/API] [Author: Gemini] Task: [COMPLETED] Add System Storage Page with cleanup metrics/actions.
