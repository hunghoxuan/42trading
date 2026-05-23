# Feature Implementation Tracker

This file tracks the status of user-facing features and links them to technical tickets.

## Technical Core
- **Database Schema**: [./architecture/db-schema.md]
- **External APIs**: [./architecture/external_apis.md]

## [x] Unified Cache Manager
- **Status**: Done
- **Feature Doc**: [../features/2-done/unified_cache_manager.md]
- **Summary**: Multi-tier cache (Memory-Redis-DB/API) across all data sources: Twelve Data, user settings, watchlist, trades, signals, news, accounts, profiles, templates. Request collapsing prevents duplicate in-flight fetches.

## [x] System DB & Cache Admin
- **Status**: Done
- **Feature Doc**: [../features/2-done/system_db_cache_admin.md]
- **Ticket**: [./2-backlog/2026-05-05-db-cache-enhancements.md]
- **Summary**: System-only database and cache inspection pages with schema-driven list/detail/edit flows, validated sorting/search, and cache filtering.

## [ ] AI Chat Agent UI
- **Status**: Idea
- **Feature Doc**: [../features/1-ideas/ai_chat_agent_ui.md]
- **Summary**: Interactive streaming chat with AI models, custom widgets (TradePlan, charts), multi-turn conversation, cross-model verification, context-aware tool calling.

## [ ] Broker OHLC Bars Pipeline
- **Status**: Backlog
- **Tickets**:
  - [./1-backlog/2026-05-23-broker-ea-push-ohlc-bars.md] — EA push bars
  - [./1-backlog/2026-05-23-webhook-receive-broker-ohlc-bars.md] — Webhook receive + store
  - [./1-backlog/2026-05-23-ui-info-tab-broker-static-chart.md] — UI display
- **Summary**: EA pushes closed-candle OHLC bars to webhook → stored as CSV + Redis cache → Info tab renders static chart from broker data.

## [ ] Unified Notification Manager
- **Status**: Plan
- **Feature Doc**: [../features/1-plan/unified_notification_manager.md]
- **Summary**: Single NotificationManager handles all events. Channels: toast, ticker, db_log, email, telegram, console.log, sound, refresh. Event types: TRADE_ACTIVITY, SIGNAL_ACTIVITY, BROKER_POLL, BROKER_SYNC, SYSTEM_EVENT, REMOTE_API_CALL. Async queue for db_log/email/telegram. Single notification settings page.
- **Supersedes**: SSE Notification System (old) — merged into this plan.

## [ ] Chart Snapshots Symbols Panel Filters
- **Status**: Planned
- **Feature Doc**: [../features/1-plan/chart_snapshots_symbols_panel_filters.md]
- **Ticket**: [./2-backlog/2026-05-02-chart-snapshots-symbol-panel-filters-favorites.md]
- **Summary**: Add favorites/asset tabs and panel toggle in symbols selector (`Favourite | All | Crypto | Forex`) with favorites sourced from user settings.

## [ ] Chart Snapshots Componentized Async Chart Tiles
- **Status**: Planned
- **Feature Doc**: [../features/1-plan/chart_snapshots_componentized_async_charts.md]
- **Ticket**: [./2-backlog/2026-05-02-chart-snapshots-componentized-async-chart-tiles.md]
- **Summary**: Re-promoted to backlog with locked Chart Sync process and `MARKET_DATA:SYMBOL` cache contract.

## [ ] Chart Interactive Overlay Engine
- **Status**: Planned (Phase 1 in progress)
- **Feature Doc**: [../features/1-plan/chart_interactive_overlay_engine.md]
- **Ticket**: [./1-backlog/2026-05-13-chart-interactive-overlay-engine.md]
- **Summary**: TradingView-style interactive object layer for PD arrays/key levels/positions using canonical time+price anchors and cross-TF projection.

## [x] AI Signal Engine
- **Status**: Done
- **Feature Doc**: [../features/2-done/ai_signal_engine.md]
- **Summary**: Multi-model AI analysis with context-aware trade generation.

## [x] MT5 Broker Bridge
- **Status**: Done
- **Feature Doc**: [../features/2-done/mt5_broker_bridge.md]
- **Summary**: Bi-directional real-time sync between Web Dashboard and MT5 EA. Updated with comprehensive telemetry (sync-v2) for parity with cTrader bridge.

## [x] cTrader Broker Bridge
- **Status**: Done
- **Feature Doc**: [../features/bridge-clients/ctrader-bridge.md]
- **Summary**: Real-time trade execution and synchronization for cTrader, including support for Limit/Stop orders, detailed telemetry sync (lots, commission, swap, margin, pips), and prefix-free SID identification.

## [x] Dashboard & Analytics
- **Status**: Done
- **Feature Doc**: [../features/2-done/dashboard_analytics.md]
- **Summary**: High-density trading performance and risk management metrics.

## [x] Trade Lifecycle Management
- **Status**: Done
- **Feature Doc**: [../features/2-done/trade_lifecycle.md]
- **Summary**: Full control over trade entry, modifications, and automated sync.

## [x] Auth & Identity
- **Status**: Done
- **Feature Doc**: [../features/2-done/auth_and_identity.md]
- **Summary**: Secure multi-user isolation and role-based access control.

## [x] System Logging & Audit
- **Status**: Done
- **Feature Doc**: [../features/2-done/system_logging.md]
- **Summary**: Comprehensive logging of execution, AI analysis, and synchronization.

## [x] Unified Settings Dashboard
- **Status**: Done
- **Feature Doc**: [../features/2-done/settings_dashboard.md]
- **Summary**: Centralized management of API keys, symbols, and cron jobs with caching.

## [x] Market Data & Charting
- **Status**: Done
- **Feature Doc**: [../features/2-done/market_data_api.md]
- **Summary**: Real-time chart visualization and unified symbol ingestion.

## [x] Telegram Notifications
- **Status**: Done
- **Feature Doc**: [../features/2-done/telegram_notifications.md]
- **Summary**: Real-time alerts for signals, trades, and system health.

## [x] Economic Calendar (News Feed)
- **Status**: Done
- **Feature Doc**: [../features/2-done/economic_calendar.md]
- **Summary**: High-impact news filtering from ForexFactory.

## [x] Trade Persistence & Metadata
- **Status**: Done
- **Feature Doc**: [../features/2-done/trade_persistence.md]
- **Summary**: Reliable storage of trade status and raw AI analysis JSON in PostgreSQL.
## [x] Broker Trade Synchronization & Integrity
- **Status**: Done
- **Feature Doc**: [../features/2-done/broker_sync_integrity.md]
- **Summary**: Resolved premature 'CLOSED' discrepancies, standardized 9-character SIDs, and implemented robust status transition validation with critical audit logging.

## [ ] API Key Management & Credit Tracking
- **Status**: Planned
- **Feature Doc**: [../features/1-plan/api_key_credit_tracking.md]
- **Summary**: Support for `{ api_key, credits }` schema in user settings with automated and manual credit refresh from providers (OpenRouter, Google, etc.).

## [ ] Advanced Order Entry
- **Status**: Planned
- **Feature Doc**: [../features/1-plan/advanced_order_entry.md]
- **Ticket**: [./1-backlog/2026-05-06-advanced-order-panel.md]
- **Summary**: Integrated professional order entry panel with real-time risk-based sizing, broker metrics sync, and one-click execution.

## [ ] Multi-TP Trade Lifecycle (TP1/TP2/TP3)
- **Status**: Planned
- **Feature Doc**: [../features/1-plan/multi_tp_trade_lifecycle.md]
- **Ticket**: [./1-backlog/2026-05-17-multi-tp-trade-lifecycle.md]
- **Summary**: Add TP1/TP2/TP3 to DB/UI/bridge flow, enforce ordered TP assignment from chart context menu, and handle partial-close PnL + sync status without premature `CLOSED`.

## [ ] Multi-TP Trade Lifecycle Hardening (Phase-1B)
- **Status**: Planned (Hotfix)
- **Feature Doc**: [../features/1-plan/multi_tp_trade_lifecycle_status_and_contract.md]
- **Ticket**: [./1-backlog/2026-05-17-multi-tp-lifecycle-hardening-phase1b.md]
- **Summary**: Close production gaps after initial rollout: fix broker sync runtime exception, enforce canonical TP contract, complete validation matrix, redeploy with clean health/log evidence.

## [ ] Docker Staging Branch Deploy (Keep Main/Prod Stable)
- **Status**: Idea
- **Ticket**: [./0-ideas/2026-05-20-docker-staging-branch-deploy.md]
- **Summary**: Add minimal branch->staging->verify->merge flow using isolated staging container so production remains untouched until branch is validated.

## [ ] AI Trade Plan Mapping Hardening (`__raw_plan` precedence)
- **Status**: Planned (Hotfix)
- **Ticket**: [./1-backlog/2026-05-17-ai-trade-plan-mapping-regression-direction-tp.md]
- **Summary**: Fix signal/trade-plan prefill regression where flattened payload can override canonical AI plan (`__raw_plan`), causing direction flips and dropped TP ladder/checklist metadata.

## [x] Source Tracking & Cron Dashboard
- **Status**: Done
- **Feature Doc**: [../features/2-done/source_tracking_and_cron_status.md]
- **Summary**: Per-source connectivity tracking (MT5/cTrader/Binance) with real-time Health page display. Per-cron status monitoring. SNAPSHOTS_CRON for automated chart capture. Risk sizing fix, direction parsing fix, OpenRouter 11-model support.
