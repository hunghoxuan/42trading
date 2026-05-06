# Worklog: Session Continuity

# Session Log: 2026-05-01 19:46
- **Discovery: System Log Types & Architecture**:
  - Identified 16+ distinct event types used in the MT5 Broker-link and AI-link systems.
  - **Key Events**:
    - `SIGNAL_FANOUT` / `DIRECT_TRADE_CREATE`: Trade instantiation.
    - `TRADE_ACK` / `TRADE_ACK_FAILED`: MT5 execution feedback.
    - `ACCOUNT_SYNC` / `ACCOUNT_HEARTBEAT`: MT5 connectivity and status.
    - `TRADE_SYNC_UPDATE` / `TRADE_SYNC_CLOSE`: Broker-side state reconciliation.
    - `AI_ANALYSIS` / `AI_RESPONSE`: AI context and signal generation audit.
  - **Logic Flow**:
    - Webhook API (`/mt5/ea/*`) -> `server.js` handlers -> `logs` table (metadata JSONB).
    - AI API (`/v2/ai/*`) -> `mt5Backend.log` -> `logs` table.
  - **Code References**:
    - Handlers: `webhook/server.js:4800-5500` (Broker) and `10500-11500` (AI).

# Session Log: 2026-05-01 10:38
- **Starting Task**:
  - Update Settings page layout and standardise setting names/types in DB and code.
- **Work Accomplished**:
  - Validated digital time toggle is already completely frontend local timezone toggle.
  - Profile layout already uses 2 columns from earlier refactor.
  - Ran DB migration script to change types `SYMBOLS` -> `trade` and `ai_analysis_cron`/`market_data_cron` -> `cron`.
  - Renamed names `ai_analysis_cron:default` -> `cron:ANALYSIS_CRON` and `market_data_cron:default` -> `cron:MARKET_DATA_CRON`.
  - Removed `enabled` field from cron settings JSON data (status field handles it at DB level).
  - Updated `SettingsPage.jsx` to reflect new layout: single "CONFIGURATIONS" grouping, inline ACTIVE/INACTIVE dropdown, and universal DELETE (except system).
  - Updated `webhook/server.js` queries to use `cron` type and the new `ANALYSIS_CRON`/`MARKET_DATA_CRON` names.
  - Bumped server/EA versions to `v2026.05.01 08:38 - 5c630e7`.
- **Verification**:
  - `node --check webhook/server.js`
  - `npm --prefix web-ui run build`
  - `bash scripts/bump_build_versions.sh`

# Session Log: 2026-04-30 18:26
- **Starting Task**:
  - Fix Claude Files View/Download error for non-downloadable Claude files.
- **Work Accomplished**:
  - Merged Claude snapshot and AI context file maps for the Files page.
  - Added VPS-local fallback for `/v2/ai/claude/files/:id/content` when Claude returns non-downloadable.
  - View/Download now streams local AI context files when Claude refuses `/content`.
  - Bumped server/EA versions to `v2026.04.30 16:26 - 02fca99`.
- **Verification**:
  - staged `webhook/server.js` syntax check
  - `npm --prefix web-ui run build`
  - staged `git diff --check`

# Session Log: 2026-04-30 13:29
- **Starting Task**:
  - Fix Claude AI error: unsupported document file format `application/json`.
- **Work Accomplished**:
  - Changed AI context `.json` files to use `text/plain` MIME for future Claude Files uploads.
  - Reupload context files when cached MIME differs.
  - Stop attaching JSON context files as Claude `document` blocks.
  - Inject bars/analysis/tradeplans context as text blocks instead.
  - Kept snapshot images as Claude file image references.
  - Bumped server/EA versions to `v2026.04.30 13:29 - 994e1f4`.
- **Verification**:
  - `node --check webhook/server.js`
  - `npm --prefix web-ui run build`
  - `bash scripts/check_build_versions.sh origin/main`
  - `git diff --check`

# Session Log: 2026-04-30 11:16
- **Starting Task**:
  - Update System Files page to match standard page layout: title, pagination, search/filter, action buttons.
- **Work Accomplished**:
  - Reworked Files page top area to standard `page-title` + `toolbar-panel`.
  - Added client-side pagination, page size selector, search input, source filter, and file type filter.
  - Kept existing file card grid and View/Download/Delete actions below the toolbar.
  - Bumped server/EA versions to `v2026.04.30 11:20 - 0e523ae`.
- **Verification**:
  - `node --check webhook/server.js`
  - `npm --prefix web-ui run build`
  - `bash scripts/check_build_versions.sh origin/main`
  - scoped `git diff --check` on touched files passed
  - full `git diff --check` is blocked by existing trailing whitespace in `web-ui/src/pages/settings/SettingsPage.jsx`
- **Deploy**:
  - Committed and pushed `ebf201f feat(system): add files manager`.
  - Deployed to VPS with `bash scripts/deploy_webhook.sh`.
  - Remote build produced `/assets/index-BOFanXjh.js`.
  - PM2 `webhook` restarted successfully.
  - Live health: `v2026.04.30 11:20 - 0e523ae`.
  - Live `/system/files` serves the new UI bundle.

# Session Log: 2026-04-30 08:55
- **Starting Task**:
  - Plan Claude Files manager UI: file list on left, content/metadata preview on right, matching Cache/User Settings layout.
- **Status**:
  - Implemented after user clarified to keep existing Snapshots page and rename it to Files.
- **Work Accomplished**:
  - Renamed System menu/page surface from Snapshots to Files while keeping `SnapshotsPage.jsx`.
  - Added `/system/files` route and redirected old snapshot routes.
  - Expanded VPS file list to show all local files in the snapshot directory, not only images.
  - Added single-file View, Download, Delete actions.
  - Added modal preview for images, text/JSON-like files, PDFs, and metadata fallback.
  - Added Claude file content proxy using Anthropic Files content endpoint.
  - Added frontend blob download helper.
  - Bumped server/EA versions to `v2026.04.30 11:06 - 0e523ae`.
- **Verification**:
  - `node --check webhook/server.js`
  - `npm --prefix web-ui run build`
  - `bash scripts/check_build_versions.sh origin/main`
  - `git diff --check`

# Session Log: 2026-04-30 08:43
- **Starting Task**:
  - Read `docs/`, merge durable content into `.agents`, and remove duplicated docs.
- **Work Accomplished**:
  - Merged AI model guide into `.agents/knowledge/ai-model-guide.md`.
  - Merged MT5 product design/backlog/roadmap notes into `.agents/architecture/mt5-product.md`.
  - Merged Execution Hub V2 design/API/schema/migration into `.agents/architecture/execution-hub-v2.md`.
  - Merged security auth upgrade into `.agents/architecture/security-auth-upgrade.md`.
  - Updated architecture and knowledge indexes.
  - Removed `docs/` after verifying no live repo references outside historical text.
- **Verification**:
  - `test ! -e docs`
  - repo-wide `rg` for old docs references
  - `git diff --check -- .agents docs`

# Session Log: 2026-04-30 08:28
- **Starting Task**:
  - Reconstruct `.agents` docs into short master indexes and split rules.
  - Remove approved obsolete redirect files, empty folders, and workflow duplicates after merging durable rules.
- **Planned Scope**:
  - `.agents/README.md`, `.agents/rules.md`, `.agents/rules/*`
  - area indexes for architecture, plans, knowledge
  - cleanup approved stale `.agents` files/folders
- **Work Accomplished**:
  - Rebuilt `.agents` around master indexes and split mandatory rules.
  - Kept `skills/` as optional playbooks, not rule source.
  - Compressed architecture and mailbox docs.
  - Removed obsolete redirect/workflow/empty docs from the working tree.
- **Verification**:
  - `find .agents -type d -empty`
  - stale-reference `rg`
  - `git diff --check -- .agents`

# Session Log: 2026-04-29 11:16
- **Starting Task**:
  - Fix AI page Plan 2 `+Trade` loading forever after Plan 1 `+Signal`.
- **Work Accomplished**:
  - Preserved per-plan ids for extra plan submit buttons instead of forcing all submits to `main`.
  - Routed AI plan `+Trade` through the existing `/v2/signals/create` pipeline with `only_signal:false`, matching the working `+Signal` path and avoiding the stricter direct-trade route.
- **Verification**:
  - `npm run build` in `web-ui`

# Session Log: 2026-04-29 10:22
- **Starting Task**:
  - Compact ICT AI analysis prompt/schema/token budget to reduce snapshot analyze timeouts.
  - Add compatibility for the compact schema shape proposed by the user (`timeframes`, `pdArrays`, `tradePlan`, `verdict`) while preserving old saved analysis support.
- **Work Accomplished**:
  - Changed backend schema to compact `AI_RESPONSE_SCHEMA_VERSION = "1.2.0"` with minified schema injection and strict array limits.
  - Added compact checklist bank and shorter backend prompt instructions to reduce input tokens.
  - Added backend/frontend compatibility normalization between compact fields (`pdArrays`, `tradePlan`, `verdict`) and legacy UI fields (`market_analysis`, `trade_plan`, `final_verdict`).
  - Reduced default snapshot max output from 7000 to 4500 tokens, extended snapshot AI timeout to 180s, and return a clear 504 timeout message.
  - Reduced frontend analyze prompt payload by replacing full JSON config + guide with compact runtime config and only sending guide overrides when edited.
  - Bumped server/EA versions to `v2026.04.29 08:28 - 5fcd486`.
- **Verification**:
  - `node --check webhook/server.js`
  - `npm run build` in `web-ui`
  - `git diff --check`

# Session Log: 2026-04-29 08:28
- **Starting Task**:
  - Update backend/UI AI Prompt Response Schema and prompt guideline handling to the new ICT schema with per-timeframe price action/prediction, PD array ids, buy/sell confluence checklists, skip reasons, partial TPs, and final verdict risk tier.
- **Files Expected**:
  - `webhook/server.js`
  - `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
  - related UI parsing/display helpers if required by compatibility.
- **Work Accomplished**:
  - Updated backend canonical `AI_RESPONSE_SCHEMA` to `1.1.0` with the requested ICT contract.
  - Reworked backend schema prompt guidance and snapshot persistence to handle `market_analysis`, `trade_plan`, and `final_verdict`.
  - Updated AI page prompt/guide text and increased snapshot-analysis max tokens for larger schema responses.
  - Added UI compatibility for `partial_tps`, `price_top`/`price_bottom`, buy/sell checklist objects, PD array ids, Fresh/Tested statuses, and final verdict risk tier.
  - Bumped server/EA versions to `v2026.04.29 06:37 - 923c4d4`.
- **Verification**:
  - `node --check webhook/server.js`
  - `npm run build` in `web-ui`
  - `git diff --check`

# Session Log: 2026-04-29 07:40
- **Work Accomplished**:
  - Replaced the temporary simplified backend `AI_RESPONSE_SCHEMA` with the existing production-compatible structure (`symbol`, `market_analysis`, `trade_plan[]`, `final_verdict`).
  - Kept backend (`webhook`) as the canonical schema source and continued tagging AI results with `schema_version`.
  - Removed duplicated `OUTPUT_FORMAT` JSON block from `web-ui/src/pages/ai/ChartSnapshotsPage.jsx` prompt text to reduce FE/BE schema drift risk.
  - Updated `.agents/plans/backlog.md` with schema solution items: modularization, compatibility normalizer, and formal schema contract docs.
- **Pending Tasks / Backlog**:
  - [ ] Extract AI schema/enums/prompt builder into dedicated modules (`webhook/constants`, `webhook/prompts`).
  - [ ] Add lightweight compatibility normalizer for legacy AI payload fields before persistence.
  - [ ] Publish `AI Schema Contract v1.0.0` documentation in `.agents/architecture/`.

## [2026-04-28 19:30] - Intelligent Market Cache & Tiered Caching
- **UnifiedCache**: Implemented L1/L2/L3 tiered caching utility for all market data.
- **Metadata Persistence**: Added JSONB metadata to `market_data` table to store AI intelligence.
- **Structured Analysis**: Forced AI prompt to return JSON for bias, trend, levels, and PD arrays.
- **Instant Context**: Frontend now fallbacks to cached metadata for immediate chart visualization on symbol selection.
- **Cache Management Page**: Migrated cache UI from Storage page to a dedicated `System > Cache` page.
  - Implemented 2-column layout (Key List / Content Preview).
  - Added JSON/CSV auto-detection and formatting for cache content inspection.
  - Updated backend API to support detailed cache key retrieval.
- **Routing & SPA Fallback**: Hardened the UI serving logic to handle browser refreshes on `/system/` pages.
  - Implemented specific endpoint matching in `isApiPath` to prevent collision with UI routes.
  - Ensured `/system/*` browser requests (that aren't APIs) always fallback to the React SPA.
  - Resolved the "Not Found" JSON error on refresh for `/system/storage` and `/system/cache`.
- **Multi-Agent Coordination**: Updated `rules.md` to mandate `worklog.md` updates at both the START and FINISH of every session.
  - Added "Currently Doing" entries in `sprint.md` for better visibility across AI agents.
- **Production Deployment**: Pushed all changes to VPS and verified build version bump.
  - Resolved persistent "Not Found" JSON error on `/system/storage` refresh by ensuring the routing fix is live.
- **Stability**: Fixed syntax errors in `server.js` and verified API routing for `/system/` endpoints.

# Session Log: 2026-04-29 07:55
- **Work Accomplished**:
  - **Cache Infrastructure Stabilization**:
    - Implemented **Request Collapsing** in `UnifiedCache` to prevent "thundering herd" (concurrent fetches for the same key).
    - Implemented **Singleton Promise** for `mt5InitBackend` to ensure database migrations run exactly once.
    - Added resilience to `/auth/me` with individual `try/catch` blocks for eager-loaded data (Settings, Accounts, Watchlist, Signals).
  - **Performance Optimization**:
    - Confirmed Eager-loading strategy for core session metadata (Accounts, Settings, Watchlist) to improve SPA responsiveness.
    - Confirmed Lazy-loading strategy for heavy market data and historical trade details.
  - **System Health**:
    - Fixed syntax error in `server.js` initialization logic.
    - Audited `SignalDetailCard` and `ChartSnapshotsPage` for circular dependencies (none found).
- **Pending Tasks / Backlog**:
  - [ ] User must restart the server to apply the `mt5InitBackend` and `UnifiedCache` fixes.
  - [ ] Monitor browser console for "Cannot access 'vt' before initialization" – likely a stale build or timeout issue.

# Session Log: 2026-04-28 20:48
- **Work Accomplished**:
  - Added bootstrap-auth fallback for the configured system email/password so login still works if the migrated DB password hash is stale.
  - Verified live `/auth/login` and `/auth/me` behavior from shell and narrowed the failure to auth-state mismatch rather than dead endpoints.
- **Pending Tasks / Backlog**:
  - [ ] Verify browser login succeeds on production after hotfix deploy.

# Session Log: 2026-04-28 19:55
- **Work Accomplished**:
  - Migrated `accounts` and `ai_templates` tables to `user_accounts` and `user_templates` in the system registry.
  - Updated `server.js` `listTables` to reflect the new database schema.
  - Enhanced `/mt5/trades` API with `symbol` and `userId` filtering to support portfolio-wide monitoring.
  - Implemented "ALL" mode in `ChartSnapshotsPage.jsx`:
    - Hidden analysis toolbar and detail card when no symbol is selected to provide a clean dashboard view.
    - Updated activity list to show all pending/filled trades portfolio-wide.
  - Built new **Preferences** interface in `SettingsPage.jsx`:
    - Added Language selection (English, Vietnamese, Deutsch).
    - Added Display Timezone configuration.
    - Added Master toggles for Market Data and AI Analysis crons.
    - Persisted all preferences to `users.metadata.settings` for high-performance session caching.
- **Pending Tasks / Backlog**:
  - [ ] Verify production cron health indicators after background sync cycles.
  - [ ] Verify localized AI prompt generation for Vietnamese/Deutsch in live analysis.

# Session Log: 2026-04-28 19:50
- **Work Accomplished**:
  - Fixed legacy account migration gap that left `user_accounts` empty while production data still lived in `accounts`.
  - Added automatic boot-time backfill from legacy `accounts` into `user_accounts` so the Accounts UI and EA API-key validation read the same dataset.
  - Corrected new schema references so fresh installs point `trades` and `execution_profiles` at `user_accounts`.
- **Pending Tasks / Backlog**:
  - [ ] Verify production Accounts page repopulates and EA pull/sync auth recovers after deploy.

# Session Log: 2026-04-28 19:32
- **Work Accomplished**:
  - Physically moved page components into menu-aligned subfolders under `web-ui/src/pages/{ai,signals,trades,settings,system}`.
  - Fixed all moved-page relative imports and verified the frontend build succeeds after the move.
  - Prepared deploy for the current metadata/user-settings refactor set, including `user_templates`, `user_accounts`, auth metadata APIs, and watchlist persistence in user metadata.
  - Bumped VPS/server and EA build versions to `v2026.04.28 17:31 - 75517db`.
- **Pending Tasks / Backlog**:
  - [ ] Verify production health/version and smoke-test Settings/System routes after deploy.

# Session Log: 2026-04-28 15:50
- **Work Accomplished**:
  - Split user Settings and System Settings responsibilities.
  - Added `/system/settings` with Market Data Cron and AI Analysis Cron only.
  - Moved system menu routes under `/system/*` and kept old flat routes as redirects.
  - Grouped page imports through menu-style folders: `/ai/`, `/signals/`, `/trades/`, `/settings/`, `/system/`.
  - Bumped VPS/EA build versions using `vY.M.d H:m - git` format.
- **Pending Tasks / Backlog**:
  - [ ] Browser-verify System role navigation after deploy.

# Session Log: 2026-04-28 15:25
- **Work Accomplished**:
  - Converted Settings WIP into independent feature sub-menu pages for Market Data Cron and AI Analysis Cron.
  - Added automatic disabled default settings rows for `market_data_cron/default` and `ai_analysis_cron/default` from `/v2/settings`.
  - Fixed cron setting save path so symbols/timeframes/status/provider/timezone/batch/model/profile/direction/order-type settings persist.
  - Updated build-version scripts to generate and validate `vY.M.d H:m - git` format with matching server/EA versions.
- **Pending Tasks / Backlog**:
  - [ ] Wire AI Analysis Cron execution logic beyond persisted settings.
  - [ ] Add dashboard cron health indicators after settings UI is verified.

# Session Log: 2026-04-28 15:15
- **Work Accomplished**:
  - **Order Type Integration**: Finalized end-to-end support for `order_type` (market/limit/stop). Updated DB schema, backend ingestion, and EA sync logic.
  - **UI Standardization**: Refactored Trades and Signals lists to show Consolidated Symbol format: `Symbol Action (Direction) Order_type`.
  - **AI Page Enhancements**: Implemented "AI Browser" grid view and "🌐 BROWSE ALL" toggle for wide-market scanning.
  - **Settings Page Redesign**: Migrated settings to a modern sidebar-detail layout.
  - **Version Bump**: Standardized build versions to `v2026.04.28 15:15 - a12c1d1`.
- **Pending Tasks / Backlog**:
  - [ ] Deploy and verify live signal extraction with new order type format.
  - [ ] Monitor EA logs for `sync-bulk` health after the version bump.

# Session Log: 2026-04-28 17:05
- **Work Accomplished**:
  - Updated build version rule format to `vY.M.d H:m - git`.
  - Added mandatory build version rule: VPS/server and EA client must use matching `vY.M.d H:m - git` format, with `git` from latest pushed commit short SHA or agreed push/build number.
- **Pending Tasks / Backlog**:
  - [ ] Update `scripts/bump_build_versions.sh` later so it generates the new `vY.M.d H:m - git` format automatically.

# Session Log: 2026-04-28 16:20
- **Work Accomplished**:
  - **Cron Engine Implementation**: Developed a 1-minute heartbeat cron system in `server.js` for background tasks.
  - **Market Data Sync**: Implemented automated candle data synchronization for multiple symbols and timeframes, storing data in the `market_data` table.
  - **Automated AI Analysis**: Created a framework for scheduled AI setup detection across symbol watchlists.
  - **Settings UI Enhancement**: Added specialized forms in `SettingsPage.jsx` for managing `market_data_cron` and `ai_analysis_cron` settings, including status toggles and visual configuration previews.
- **Pending Tasks**:
  - [ ] Finalize the full automated execution bridge (AI analysis -> Trade creation).
  - [ ] Add visual health indicators for the Cron engine in the dashboard.

# Session Log: 2026-04-28 15:30
- **Work Accomplished**:
  - **Settings Redesign**: Refactored `SettingsPage.jsx` to a unified sidebar-detail layout. Consolidated Profile, Password, Execution, UI, and Logging into a modern, high-density navigation menu.
  - **AI Chart Browser**: Implemented a multi-symbol live chart grid in `ChartSnapshotsPage.jsx` for the empty-state symbol view. Added global timeframe selection and pagination for the watchlist browser.
  - **Design System**: Added new CSS tokens and components in `styles.css` for the sidebar and browser grid.
- **Pending Tasks**:
  - [ ] Implement asynchronous bar-data fetching (market-data cron).
  - [ ] Implement AI Auto-Analysis cron.


# Session Log: 2026-04-28 13:20
- **Work Accomplished**:
  - Started backlog item 2 market-data cron implementation:
    - Added BullMQ dependency for Redis-backed queued bar-fetch jobs.
    - Implemented chunked market-data storage using existing `market_data` rows with max 500 bars per chunk.
    - Normalized provider bars to UTC timestamps and kept timezone as display/settings concern, defaulting to `America/New_York`.
    - Added user_settings-backed market-data cron state updates (`last_sync`) instead of a new sync-state table.
    - Added async/batched market data cron queue with inline fallback if BullMQ/Redis is unavailable.
  - Added user-requested backlog items for Settings page redesign, AI page chart browser, market-data bar cron/cache sync, and AI auto-analysis cron.
  - Added mandatory planning/confirmation rule to `AI.md` and `.agents/rules.md`: agents must propose detailed design/plan/solution and ask confirmation questions before implementing UI/layout/feature/DB/schema/tech-stack/architecture changes.
  - Verified EA bulk closed-history sync is actively posting to `/v2/ea/trades/sync-bulk`.
  - Found production bulk sync failure: server route crashed with `pool is not defined`, so EA requests arrived but could not update VPS rows.
  - Fixed route to use initialized MT5 backend query handle, committed `1e43e8e`, pushed, and deployed.
  - Live-tested bulk endpoint with fake unmatched ticket: HTTP 200, `{ ok: true, updated: 0, unmatched: 1 }`.
  - Confirmed no fresh `pool is not defined` / sync-bulk errors in VPS error log after deploy.
  - Reviewed risk/reward flow: EA calculates accurate risk/reward using MT5 `OrderCalcProfit`; VPS stores and UI displays metadata when EA sends it.
- **Pending Tasks / Backlog**:
  - [ ] Compile/load latest EA build `2026-04-28.1114` or newer in MT5 so terminal-side sync/risk telemetry matches server behavior.
  - [ ] If old trades still show `$0.00`, provide EA Experts logs for ack/sync around those tickets, or backfill approximate risk/reward from MT5 symbol specs.

# Session Log: 2026-04-28 12:45
- **Work Accomplished**:
  - Applied manual production DB correction from MT5 screenshots for tickets `1614606138`, `1614606129`, `1606871045`, `1613165287`, `1614605900`, `1614606086`, `1614606125`, `1613165038`, `1612211029`, `1611966110`, and `1612094065`.
  - Corrected symbol/action/entry/SL/TP/volume/status/PnL/current-price metadata.
  - Created missing current open/pending VPS rows for BTCUSD `1614606129`, XTIUSD `1606871045`, and UK100 `1613165287`.
  - Verified corrected rows in production Postgres.
- **Pending Tasks / Backlog**:
  - [ ] Compile/load EA build `2026-04-28.1030` to prevent future stale EA payloads from fighting manual corrections.

# Session Log: 2026-04-28 12:35
- **Work Accomplished**:
  - Fixed broker ticket matching bug where unmatched MT5 tickets could bind to oldest unresolved trade without symbol validation.
  - EA active sync now sends `symbol` for positions/orders.
  - Server now rejects/quarantines ticket matches when incoming MT5 symbol differs from existing VPS trade symbol.
  - Deployed server/EA build `2026.04.28-1030` / `2026-04-28.1030`.
  - Cleared bad CADJPY ticket assignments for `1614606138` and `1614606129`; both rows reverted to `PENDING` with no broker ticket.
- **Pending Tasks / Backlog**:
  - [ ] Compile/load EA build `2026-04-28.1030` in MT5 so future active sync includes symbol and can match safely.

# Session Log: 2026-04-28 09:58
- **Conversation ID**: current Codex session
- **Work Accomplished**:
  - **EA/VPS Sync Review**:
    - Reviewed EA history sync, active state sync, broker sync reconciliation, and Trades UI PnL display path.
    - Confirmed production DB has two recent closed trades still missing realized PnL: BTCUSD ticket `1611966110` and UK100 ticket `1613165038`.
  - **Sync Hardening Deployed**:
    - Confirmed robust server-side ticket candidate reconciliation is present for position/deal/order ticket matching.
    - Fixed EA active sync JSON construction to escape `signal_id` and avoid ticket truncation by using long ticket formatting.
    - Bumped and deployed builds through production: server/EA `2026.04.28-0753`.
    - Verified production health at `https://trade.mozasolution.com/webhook/mt5/health` returns version `2026.04.28-0753`.
- **Pending Tasks / Backlog**:
  - [ ] User must compile/load the updated `mql5/TVBridgeEA.mq5` build `2026-04-28.0753` in MT5 so the terminal stops sending malformed `/mt5/ea/sync-v2` payloads and resends 7-day closed history.
  - [ ] After the updated EA runs for one history-sync cycle (~5 minutes), verify BTCUSD `1611966110` and UK100 `1613165038` receive `pnl_realized`.
  - [ ] If still missing, collect MT5 Experts log lines for `SYNC`, `sync-bulk`, and tickets `1611966110` / `1613165038`.

# Session Log: 2026-04-27 16:00
- **Conversation ID**: 97a220ca-bbdc-4502-9c38-09672fa77008
- **Work Accomplished**:
  - **UI/Trades Header Hiding**:
    - Updated `SignalDetailCard` to support `hideEditor` flag.
    - Updated `V2TradeDetailPage`, `SignalDetailPage`, and `TradesPage` to hide the "outside" header in favor of the enriched "inside" `PlanHeader`, satisfying the "remove outside header" request.
    - Consolidated trade plan extraction and validation logic in `signalDetailUtils.jsx` for cross-page reuse.
  - **AI Entry Model Standardization**:
    - Created `.agents/knowledge/popular_entry_models.md` with official enums from `server.js`.
    - Created `ai-agent/prompts/signal_generator.prompt` using these enums to guide AI agents.
  - **Build & Deploy**: Bumped versions and synchronized build: `2026.04.27-1851`.
  - **Cleanup & API Refactoring**:
    - Renamed Signals API from `/mt5/trades/search` to `/v2/signals` (with legacy alias).
    - Removed unused `ExecutionV2Page.jsx` and `TradeCard.jsx`.
    - Removed unused legacy endpoints `/mt5/ui` and `/mt5/trades/create`.
  - **Bug Fixes (UI Regressions)**:
    - Fixed PnL data leak in `SignalsPage` by refining `shouldShowPnl` logic.
    - Fixed auto-refresh selection "jumping" in Signals and Trades lists by updating object references.
    - Restored editable Trade form in `TradesPage` and `V2TradeDetailPage`.
    - Standardized note formatting using `formatNote` utility across all surfaces.

- **Pending Tasks / Backlog**:
  - [x] [P1] [AI-Agent/Prompts] Update `ai-agent/prompts/` with official enums from `popular_entry_models.md`.
  - [x] [P1] [UI/Trades] Verify if `V2TradeDetailPage` needs similar "header hiding" logic as Signals.
  - [ ] [P2] [UI/UX] Confirm if "Info" tab should remain the default or if "Chart" should take priority now that fields are visible in "Info".

# Session Log: 2026-04-27 15:30
- **Conversation ID**: af5c0edf-fd39-4919-a84b-36f58455b1ae
- **Work Accomplished**:
  - **SignalDetailCard Restoration**: Restored the 6-slot header layout (Major + Minor rows) to ensure full information density (Status, Vol, PnL, RR, Confidence, Date).
  - **Info Tab Consolidation**: Renamed the "Analysis" tab to "Info" and merged all key metadata fields (Account, Strategy, Entry Model, Ticket) into it.
  - **PlanHeader Refinement**: enriched the "inside" PlanHeader with real-time status, volume, and PnL, satisfying the "remove the outside header" request while keeping context.
  - **Fixed Master-Detail Data Mismatch**: Implemented a `key` prop based on `signal_id` in `SignalsPage.jsx` to force a component reset when switching signals, fixing the bug where old data (e.g., GBPUSD) persisted on new selections (e.g., USDJPY).
  - **Standardized RR**: Prioritized `rr_planned` in the detail header to match the list view and resolve data calculation discrepancies.
  - **Build & Deploy**: Successfully bumped versions and deployed version `2026.04.27-1455` to the production VPS.
  - **Formalized Session Management**: Created `.agents/skills/session-management.md` and updated `.agents/rules.md` (Section 7) to mandate worklog updates for better continuity.

- **Pending Tasks / Backlog**:
  - [ ] [P1] [AI-Agent/Prompts] Update `ai-agent/prompts/` with official enums from `popular_entry_models.md`.
  - [ ] [P1] [UI/Trades] Verify if `V2TradeDetailPage` needs similar "header hiding" logic as Signals (user requested "remove outside header" in screen 1).
  - [ ] [P2] [UI/UX] Confirm if "Info" tab should remain the default or if "Chart" should take priority now that fields are visible in "Info".

- **Key Decisions/Changes**:
  - Hiding the generic top-level header when a trade plan is active to reduce visual clutter.
  - Using a unique `key` on `SignalDetailCard` to prevent stale data in the sidebar detail view.

# Session Log: 2026-04-29 11:35
- **Starting Task**:
  - Add Claude Files API fast path for chart snapshot analysis while preserving VPS snapshot storage and base64 fallback.
  - Add authenticated Claude file list/delete/upload management helpers/endpoints where practical.
- **Work Accomplished**:
  - Added Claude Files API upload/cache path for snapshot analysis with file_id image blocks.
  - Preserved VPS snapshot storage and added automatic base64 fallback when Files API upload or message file references fail.
  - Added authenticated Claude file management endpoints for list, snapshot upload, and delete.
  - Added UI status text to show Files API vs fallback mode.
- **Verification**:
  - node --check webhook/server.js
  - npm run build in web-ui
  - git diff --check


# Session Log: 2026-04-29 19:35
- **Starting Task**:
  - Add VPS/Claude source menu to System > Snapshots.
  - Make Claude source list/delete Claude Files API items while preserving VPS snapshot behavior.

# Session Log: 2026-04-29 20:05
- **Starting Task**:
  - Add cache-first multi-timeframe AI context flow.
  - Persist last_price for market_data.
  - Treat Claude Files as AI context cache for bars, snapshots, analysis, and trade plans.
  - Stop AI page from sending raw bars in analyze payload.

# Session Log: 2026-04-30 23:17
- **Starting Task**:
  - Improve AI Chart context performance with async warm-up:
    - auto-start bars/context and snapshots on symbol load
    - cache-first snapshot reuse before capture
    - analyze preflight waits for warm-up with timeout fallback
- **Work Accomplished**:
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`:
    - Added `warmupState` and in-flight warm-up refs (`contextWarmupRef`, `snapshotWarmupRef`) for single-flight async jobs.
    - Added cache-first snapshot matcher (`resolveRecentSnapshots`) to reuse recent per-TF snapshots before triggering capture.
    - Added async warm-up starters:
      - `startContextWarmup(...)` for bars/context files
      - `startSnapshotWarmup(...)` for snapshot readiness with missing-TF capture only
    - Added symbol-change effect to fire both warm-up jobs in parallel.
    - Reworked `analyzeSelected()` preflight:
      - waits on context + snapshot warm-up concurrently (bounded timeout)
      - uses matched snapshot files when complete
      - gracefully continues bars/context-only when snapshots are partial/failed after timeout.
- **Technical Decisions**:
  - Keep bars/context as hard requirement for analyze.
  - Keep snapshots as best-effort with timeout fallback to avoid user-visible blocking.
  - Preserve existing freshness window (15 minutes, same-day) for snapshot cache reuse.
- **Verification**:
  - `npm --prefix web-ui run build` ✅
- **Deploy Status**:
  - Not deployed in this task.

- **Follow-up Task (2026-05-01)**:
  - Backend: parallelize `buildAiContextBundle` across multiple TFs with bounded concurrency.
  - UI: show live readiness status near Analyze for bars/context and snapshots.
- **Follow-up Work Accomplished**:
  - Updated `/Users/macmini/Trade/Bot/trading/webhook/server.js`:
    - Changed `buildAiContextBundle(...)` from sequential TF loop to bounded parallel worker pool (`maxParallel=3`).
    - Preserved stable output ordering by writing results into indexed slots.
    - Preserved partial-failure tolerance by converting worker errors into per-TF `status:"error"` records.
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`:
    - Added live readiness texts:
      - `Bars/Context: Ready|Loading|Pending`
      - `Snapshots: Ready|Loading|Pending (matched/target)`
    - Rendered both statuses beside Analyze button to expose async progress clearly.
- **Follow-up Verification**:
  - `node --check webhook/server.js` ✅
  - `npm --prefix web-ui run build` ✅

- **Follow-up Task (2026-05-01 07:57)**:
  - Replace raw numeric trend fallback with percent change display and color.
  - Replace fresh/cache label with cached-age label.
  - Update datetime formatter to show relative minutes under 60 minutes.
- **Follow-up Work Accomplished**:
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`:
    - Removed `fresh/cache` text in live TF header.
    - Added `cached ${showDateTime(...)}` display.
    - Replaced `close_change_20` raw number display with percent (`* 100`) string.
    - Added color coding for percent:
      - positive: green (`var(--ok)`)
      - negative: red (`var(--danger)`)
      - zero: muted.
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/utils/format.js`:
    - `showDateTime(...)` now returns `"x mins ago"` when timestamp is within last 60 minutes.
- **Follow-up Verification**:
  - `npm --prefix web-ui run build` ✅

# Session Log: 2026-05-01 10:32
- **Starting Task**:
  - Add client-controlled auto context flow for AI Chart:
    - show context/snapshot/analysis status near `[CHART_CONTEXT]`
    - introduce one refresh API for multiple symbols, TFs, and data types
    - auto-refresh context/snapshots on symbol stay
    - auto-analyze after refresh/snapshot readiness
    - cancel/ignore old flows when switching symbols
- **Work Accomplished**:
  - Updated `/Users/macmini/Trade/Bot/trading/webhook/server.js`:
    - Added `findRecentChartSnapshots(...)` cache-first helper for local snapshot freshness.
    - Added `POST /v2/chart/refresh`.
    - Endpoint supports:
      - `symbols`
      - `timeframes`
      - `types` (`context`, `bars`, `snapshots`, etc.)
      - `provider`
      - `bars`
      - `force`
      - `session_prefix`
      - `snapshot_max_age_ms`
    - Endpoint returns per-symbol context and snapshot status while reusing cached snapshots before capture.
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/api.js`:
    - Added `api.chartRefresh(...)`.
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`:
    - Added UI flow state for `context`, `snapshots`, and `analysis`.
    - Added run-token based stale result guard so switching symbols invalidates old flow results.
    - Moved context/snapshot warm-up to the unified `chartRefresh` endpoint.
    - Added auto-flow:
      - starts on symbol/provider/TF/lookback change
      - refreshes context and snapshots in parallel
      - auto-analyzes after refresh readiness
      - repeats every 5 minutes while user stays on same symbol
    - Added status display beside `[CHART_CONTEXT]`.
  - Bumped matched builds:
    - `webhook/server.js` `SERVER_VERSION`
    - `mql5/TVBridgeEA.mq5` `EA_BUILD_VERSION`
    - Version: `v2026.05.01 08:35 - 5c630e7`
- **Technical Decisions**:
  - UI remains orchestrator; server exposes a unified refresh primitive.
  - Old flow results are ignored by run id rather than relying on server-side cancellation.
  - Auto-analysis is enabled; auto-add signals/trades is intentionally not enabled yet.
- **Verification**:
  - `node --check webhook/server.js` ✅
  - `npm --prefix web-ui run build` ✅
- **Deploy Status**:
  - Deployed after verification.
  - Commit: `3d3826b feat(ai): auto-refresh chart context flow`
  - Build/version: `v2026.05.01 10:05 - a6d3a8d`
  - Production health verified:
    - `https://trade.mozasolution.com/webhook/health`
    - `https://trade.mozasolution.com/webhook/mt5/health`
  - Production UI asset verified: `assets/index-C1eEsG7L.js`
  - `POST /webhook/v2/chart/refresh` verified present via expected unauthenticated `401`.

# Session Log: 2026-05-01 12:18
- **Starting Task**:
  - Compact AI chart status display.
  - Remove duplicate context/snapshot status text.
  - Fix impossible percent-change display in live TF cards.
- **Work Accomplished**:
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`:
    - Replaced verbose `[CHART_CONTEXT] Last refreshed... Context...` label with compact single badge:
      - age only (`1 mins ago`)
      - `C:<state> | S:<matched>/<target> | A:<state>`
    - Removed duplicate `Bars/Context` and `Snapshots` status next to Analyze.
    - Fixed percent display:
      - `close_change_20` is absolute price change, not percent.
      - UI now computes `(last_price - previous_close) / previous_close`.
      - UI suppresses percent when the computed value is unavailable or unreasonable.
  - Bumped matched builds:
    - `webhook/server.js` `SERVER_VERSION`
    - `mql5/TVBridgeEA.mq5` `EA_BUILD_VERSION`
    - Version: `v2026.05.01 10:17 - 4fe585a`
- **Technical Note**:
  - Bias/trend only appears when cached context includes prior AI analysis metadata. Bars-only context has price/summary but may not include trend/bias text yet.
- **Verification**:
  - `node --check webhook/server.js` ✅
  - `npm --prefix web-ui run build` ✅

# Session Log: 2026-05-01 12:36
- **Starting Task**:
  - Clarify purpose of `AI.md`.
  - Unify cross-model bootstrap files so all AI tools load `.agents` context consistently.
  - Enforce script-placement rule to avoid repo-root script clutter.
- **Work Accomplished**:
  - Added `/Users/macmini/Trade/Bot/trading/.agents/BOOTSTRAP.md` as single source bootstrap order.
  - Updated root model entry files to point to `.agents/BOOTSTRAP.md`:
    - `/Users/macmini/Trade/Bot/trading/AGENTS.md`
    - `/Users/macmini/Trade/Bot/trading/CLAUDE.md`
    - `/Users/macmini/Trade/Bot/trading/.cursorrules`
    - `/Users/macmini/Trade/Bot/trading/.geminirules`
    - `/Users/macmini/Trade/Bot/trading/.windsurfrules`
  - Created `/Users/macmini/Trade/Bot/trading/ANTIGRAVITY.md` with same bootstrap pointer.
  - Added safety rule in `/Users/macmini/Trade/Bot/trading/.agents/rules/safety.md`:
    - new helper scripts must be created under `scripts/` unless explicitly requested otherwise.
- **Technical Decisions**:
  - Keep one canonical bootstrap file under `.agents` to prevent drift across model-specific files.
- **Verification**:
  - Documentation-only changes; no runtime test required.
- **Deploy Status**:
  - Not deployed.

# Session Log: 2026-05-01 12:45
- **Starting Task**:
  - Verify whether RTK is configured as an automatic hook.
  - Reduce token usage by enforcing repo-level token rules.
- **Work Accomplished**:
  - Confirmed `rtk` is installed and active (`/opt/homebrew/bin/rtk`, version `0.38.0`), with measured savings via `rtk gain`.
  - Confirmed no active git hook uses `rtk` (`.git/hooks` contains only sample hooks).
  - Added mandatory token rule file:
    - `/Users/macmini/Trade/Bot/trading/.agents/rules/token.md`
  - Updated rules index to include token rules:
    - `/Users/macmini/Trade/Bot/trading/.agents/rules.md`
- **Technical Decisions**:
  - Enforce token discipline through `.agents/rules` so all model entry files inherit same behavior through bootstrap routing.
- **Verification**:
  - `rtk which rtk`
  - `rtk --version`
  - `rtk gain`
  - `rtk ls -la .git/hooks`
- **Deploy Status**:
  - Not deployed.

# Session Log: 2026-05-01 12:52
- **Starting Task**:
  - Introduce additional CLI tools and installation flow that combine with RTK for token savings and higher AI/operator efficiency.
- **Work Accomplished**:
  - Added installer script: `/Users/macmini/Trade/Bot/trading/scripts/install_token_toolchain.sh`
  - Added toolchain guide: `/Users/macmini/Trade/Bot/trading/.agents/knowledge/token-efficient-toolchain.md`
  - Extended token rules in `/Users/macmini/Trade/Bot/trading/.agents/rules/token.md` with preferred command matrix (`rtk rg`, `rtk fd`, `rtk jq`, bounded reads, delta diff).
- **Technical Decisions**:
  - Use one install script for macOS/Linux package bootstrap.
  - Keep rule-level guidance short and detailed examples in knowledge docs.
- **Verification**:
  - `rtk bash -n scripts/install_token_toolchain.sh` ✅
  - File presence checks via `rtk ls -la` ✅
- **Deploy Status**:
  - Not deployed.

# Session Log: 2026-05-01 13:02
- **Starting Task**:
  - Reconstruct second-brain structure using Caveman + raw/wiki/rules model.
  - Rename `.agents/knowledge` to `.agents/wiki`.
  - Add state compiler file and script.
- **Work Accomplished**:
  - Renamed `/Users/macmini/Trade/Bot/trading/.agents/knowledge` -> `/Users/macmini/Trade/Bot/trading/.agents/wiki`.
  - Added raw layer scaffold:
    - `/Users/macmini/Trade/Bot/trading/.agents/raw/README.md`
  - Added state compiler target:
    - `/Users/macmini/Trade/Bot/trading/.agents/STATE.md`
  - Added state builder script:
    - `/Users/macmini/Trade/Bot/trading/scripts/build_state_snapshot.sh`
  - Updated bootstrap/index docs and handoff rule to reflect raw/wiki/rules model:
    - `/Users/macmini/Trade/Bot/trading/.agents/BOOTSTRAP.md`
    - `/Users/macmini/Trade/Bot/trading/.agents/README.md`
    - `/Users/macmini/Trade/Bot/trading/.agents/rules/handoff.md`
  - Updated Obsidian workspace refs from `knowledge/` to `wiki/`:
    - `/Users/macmini/Trade/Bot/trading/.agents/.obsidian/workspace.json`
- **Technical Decisions**:
  - Keep `rules` as mandatory behavior, `wiki` as distilled durable knowledge, `raw` as append-only capture.
  - Add compiled `STATE.md` as fast startup context to reduce token-heavy broad reads.
- **Verification**:
  - `rtk bash -n scripts/build_state_snapshot.sh` ✅
  - `rtk bash scripts/build_state_snapshot.sh` ✅
  - `rtk rg -n "\.agents/knowledge|knowledge/" .agents ...` checked remaining mentions are historical in `worklog`/compiled `STATE` ✅
- **Deploy Status**:
  - Not deployed.
- **Work Accomplished**:
  - Moved `entry_models` from raw to wiki:
    - `/Users/macmini/Trade/Bot/trading/.agents/raw/entry_models` -> `/Users/macmini/Trade/Bot/trading/.agents/wiki/entry_models`
  - Added memory governance rule:
    - `/Users/macmini/Trade/Bot/trading/.agents/rules/memory-governance.md`
  - Updated rules index to include memory governance and fixed numbering:
    - `/Users/macmini/Trade/Bot/trading/.agents/rules.md`
  - Updated wiki index semantics:
    - `/Users/macmini/Trade/Bot/trading/.agents/wiki/README.md`
  - Updated raw ownership doc:
    - `/Users/macmini/Trade/Bot/trading/.agents/raw/README.md`
- **Technical Decisions**:
  - Enforced model: raw=user-owned append-only, wiki=AI-owned distilled.
  - Keep delete actions manual/approved; this pass only classifies and governs.
- **Verification**:
  - Reviewed wiki inventory and key docs with `rtk ls/find/sed`.
- **Deploy Status**:
  - Not deployed.

# Session Log: 2026-05-01 13:48
- **Starting Task**:
  - Fix flaky `Bars/context still not ready` preflight during Analyze.
  - Prevent duplicate warm-up races.
  - Remove redundant bottom-left status text in AI chart UI.
- **Work Accomplished**:
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`:
    - Added `withTimeout(...)` helper for bounded waiting without cancelling underlying warm-up.
    - Changed Analyze preflight to reuse in-flight warmups (`force: false`) instead of forcing duplicate refresh jobs.
    - Increased practical wait window (25s + 15s fallback) for context readiness before failing.
    - Reused warmed context when calling `analyzeFiles(...)` to avoid extra context fetch/race.
    - Removed redundant global bottom status render block (duplicate of top-row message).
- **Technical Decisions**:
  - Keep warm-up async jobs single-source and join existing promises instead of starting parallel forced jobs.
  - Timeouts are for UI waiting only; they no longer imply background job cancellation.
- **Verification**:
  - `npm --prefix web-ui run build` ✅
- **Deploy Status**:
  - Not deployed.

# Session Log: 2026-05-01 14:02
- **Starting Task**:
  - Verify why old `Bars/context still not ready` behavior is still visible in production.
  - Implement startup warm-up gate with timeout and disable action buttons until ready/timeout.
- **Work Accomplished**:
  - Updated `/Users/macmini/Trade/Bot/trading/web-ui/src/pages/ai/ChartSnapshotsPage.jsx`:
    - Added warm-up gate state (`warmupGate`) and unlock timer.
    - Disabled Analyze button while warm-up lock is active.
    - Changed button labels to `Warming...` while locked.
    - Auto-unlock when both context/snapshots warm-up leaves loading state.
    - Fallback auto-unlock after 45s timeout to avoid indefinite waiting.
    - Manual Analyze after unlock no longer blocks on preflight waiting; it starts immediately and lets missing context/snapshots continue warming in background.
  - Verified local build output hash changed to:
    - `dist/assets/index-D6DDIGMO.js`
  - Observed production was serving older hash previously (`index-Dc9ouXEP.js`), indicating deploy mismatch.
- **Technical Decisions**:
  - Use one warm-up lock gate to prevent duplicate process races on initial load.
  - After timeout, prioritize operator control (manual trigger) over strict readiness waiting.
- **Verification**:
  - `npm --prefix web-ui run build` ✅
- **Deploy Status**:
  - Not deployed yet in this step.

# Session Log: 2026-05-01 14:20
- **Starting Task**:
  - Enforce script path policy: use root-virtual paths (repo-relative), avoid machine-specific local physical paths.
- **Work Accomplished**:
  - Updated rules:
    - `/Users/macmini/Trade/Bot/trading/.agents/rules/scripting.md`
    - `/Users/macmini/Trade/Bot/trading/.agents/rules/deploy.md`
    - `/Users/macmini/Trade/Bot/trading/.agents/rules/testing.md`
  - Updated scripts to remove hardcoded local absolute paths and old script locations:
    - `/Users/macmini/Trade/Bot/trading/scripts/test/test_server.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/install/install_mt5_csv_sync_launchd.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/test/test_webhook_push_random.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/utils/ai.js`
    - `/Users/macmini/Trade/Bot/trading/scripts/utils/switch_demo_mode.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/install/install_ctrader_executor_bridge.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/daemons/mt5_csv_sync.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/migrate_risk.js`
    - `/Users/macmini/Trade/Bot/trading/scripts/deploy/check_build_versions.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/deploy/deploy_webhook.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/test/test_remote_api.sh`
    - `/Users/macmini/Trade/Bot/trading/scripts/test/test_remote_api_default.sh`
- **Technical Decisions**:
  - Keep remote VPS absolute paths configurable via env vars (`VPS_APP_DIR`, `APP_DIR`, `REMOTE_APP_DIR`) because they represent deployment target, not local machine path.
- **Verification**:
  - Bash syntax checks passed for updated shell scripts.
  - Node syntax checks passed for updated JS scripts.
- **Deploy Status**:
  - Not deployed.
