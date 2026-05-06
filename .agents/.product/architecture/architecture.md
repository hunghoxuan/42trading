# Architecture

> Updated 2026-05-05. Authoritative reference for the trading system architecture.

---

## Project Structure

```
trading/
├── webhook/               ← BACKEND — Node.js API server
│   └── server.js           ← Single monolithic file (~17k lines)
│
├── web-ui/                 ← FRONTEND — React SPA
│   └── src/
│       ├── api.js           ← HTTP client (fetch + EventSource)
│       ├── pages/           ← Route pages (Dashboard, AI, Trades, System...)
│       ├── components/      ← Reusable UI widgets (charts, clock, ticker...)
│       └── services/        ← chartFetchManager, etc.
│
├── bridge-clients/         ← NATIVE BROKER BRIDGES
│   ├── TVBridgeEA.mq5       ← MT5 Expert Advisor (MQL5)
│   └── TVBridge_CTrader.cs  ← cTrader bridge (C#)
│
├── scripts/                ← OPS TOOLING
│   ├── deploy/              ← deploy_webhook.sh, check_build_versions.sh
│   └── test/                ← test_remote_api_default.sh, test_remote_ui.sh
│
└── .agents/                ← AI MEMORY (source of truth for agents)
    └── .product/
        ├── architecture/    ← This file + db-schema + external_apis
        ├── features/        ← Feature docs (plan + done)
        └── tickets/         ← Active work + backlog + history
```

---

## Directory Responsibilities

| Directory | Role | Language | What it does |
|-----------|------|----------|-------------|
| **`webhook/`** | Backend API Server | Node.js | HTTP server on :443 + :80→443 redirect. REST API, SSE push, PostgreSQL queries, Claude AI, TwelveData, Redis, Cron jobs. Serves built `web-ui/dist/` as static files. |
| **`web-ui/`** | Frontend SPA | React + Vite | All UI rendering and user interaction. `api.js` calls webhook via `fetch`. `EventSource` receives SSE. React Router handles navigation. Built to `dist/`. |
| **`bridge-clients/`** | Broker Bridges | MQL5 / C# | Pull tasks from webhook, execute trades on brokers, push status back. Run inside MT5/cTrader platforms. |
| **`scripts/`** | Ops Tooling | Bash | Deploy, build-version checks, remote smoke tests. |
| **`.agents/`** | AI Memory | Markdown | Architecture docs, feature specs, tickets, rules, worklog. Canonical source of truth for AI agents. |

---

## Full Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          EXTERNAL SERVICES                              │
│                                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐           │
│  │  Claude  │  │ Twelve   │  │  Redis   │  │  PostgreSQL  │           │
│  │  AI API  │  │ Data API │  │ (cache)  │  │  (database)  │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘           │
└───────┼─────────────┼─────────────┼───────────────┼────────────────────┘
        │             │             │               │
        │  AI analyze │  OHLC bars  │  pub/sub      │  CRUD
        │  file upload│  quotes     │  job queue    │
        │             │             │               │
┌───────┴─────────────┴──────┬──────┴───────────────┴────────────────────┐
│                            │                 VPS (port 443)             │
│   ┌────────────────────────┴──────────────────────────┐                │
│   │               webhook/server.js                    │                │
│   │                                                    │                │
│   │  ┌──────────────┐  ┌──────────┐  ┌──────────────┐ │                │
│   │  │  HTTP Server │  │   Auth   │  │  SSE Bus     │ │                │
│   │  │  :443 HTTPS  │  │ session  │  │ emitNotif()  │ │                │
│   │  │  :80 → :443  │  │ cookies  │  │ /stream      │ │                │
│   │  └──────────────┘  └──────────┘  └──────────────┘ │                │
│   │                                                    │                │
│   │  ┌──────────────────────────────────────────────┐  │                │
│   │  │              Route Handlers                  │  │                │
│   │  │                                              │  │                │
│   │  │  /v2/signals/*       Signals CRUD            │  │                │
│   │  │  /v2/trades/*        Trades CRUD             │  │                │
│   │  │  /v2/chart/*         Snapshots, AI context   │  │                │
│   │  │  /v2/ai/*            AI generate, templates  │  │                │
│   │  │  /v2/notifications/* SSE stream, settings    │  │                │
│   │  │  /v2/settings/*      User settings           │  │                │
│   │  │  /v2/system/*        Cache, storage, DB      │  │                │
│   │  │  /v2/broker/*        EA sync, cTrader bridge │  │                │
│   │  │  /mt5/db/*           DB table browser        │  │                │
│   │  │  /auth/*             Login, logout, users    │  │                │
│   │  │  /*                  Static UI files (SPA)   │  │                │
│   │  └──────────────────────────────────────────────┘  │                │
│   │                                                    │                │
│   │  ┌──────────────┐  ┌──────────────┐               │                │
│   │  │  Cron Jobs   │  │  Market Data │               │                │
│   │  │  BullMQ      │  │  TF Cache    │               │                │
│   │  └──────────────┘  └──────────────┘               │                │
│   └──────────────────────┬───────────────────────────┘                │
│                          │                                              │
└──────────────────────────┼──────────────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
     ┌────┴────┐     ┌─────┴─────┐    ┌─────┴──────┐
     │ MT5 EA  │     │  cTrader  │    │  web-ui/   │
     │ (MQL5)  │     │  Bridge   │    │  (React)   │
     │         │     │  (C#)     │    │            │
     │ Pulls   │     │  Pulls    │    │ src/api.js │──► fetch() to webhook
     │ tasks   │     │  tasks    │    │            │──► EventSource SSE
     │ Pushes  │     │  Pushes   │    │ src/pages/ │──► React Router
     │ status  │     │  status   │    │ src/comp/  │──► UI widgets
     └─────────┘     └───────────┘    └─────────────┘
```

---

## Identity & Keys

| Key | Type | Scope |
|-----|------|-------|
| `id` | `BIGSERIAL` | Internal joins, updates, deletes. Never exposed to UI. |
| `sid` | `TEXT UNIQUE NOT NULL` | Public-facing ID. 9-char Base36 time-sortable (e.g. `D1AA65EDA`). Used in UI, API, URLs. |
| `signal_id` | `TEXT` (legacy) | Old signal identifier. Still in `signals` table for backward compat. |
| `trade_id` | `TEXT` (legacy) | Old trade identifier. Phasing out. |
| `account_id` | `TEXT` | Account identifier (broker account number or UUID). |
| `source_id` | `TEXT` | Source identifier (TradingView alert ID, EA ID). |
| `profile_id` | `TEXT` | Execution profile identifier. |

**Resolution order**: API accepts `id`, `sid`, or legacy key. Resolution priority:
1. Numeric `id`
2. `sid`
3. Legacy key (`signal_id`, `trade_id`, etc.)

**UI rule**: Show and search by `sid`. Never expose `id` (BIGSERIAL).

---

## Database

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `users` | Auth identity | `user_id`, `email`, `password_hash`, `role` |
| `user_accounts` | Broker accounts | `account_id`, `user_id`, `balance`, `equity`, `broker_name` |
| `user_settings` | Key-value config | `user_id`, `type`, `name`, `data` (JSONB) |
| `user_templates` | AI templates | `user_id`, `name`, `data` (JSONB) |
| `signals` | Trading signals | `signal_id`, `sid`, `user_id`, `symbol`, `side`, `entry`, `sl`, `tp` |
| `trades` | Trade execution | `trade_id`, `sid`, `account_id`, `symbol`, `action`, `execution_status`, `pnl_realized` |
| `logs` | Audit trail | `object_id`, `object_table`, `event_type`, `metadata` (JSONB) |
| `sources` | Signal sources | `source_id`, `sid`, `user_id`, `type` |
| `execution_profiles` | Routing config | `profile_id`, `user_id`, `route`, `source_ids` |
| `market_data` | OHLC bars | `symbol`, `tf`, `bar_start`, `bar_end`, `data` (compressed) |
| `ea_logs` | EA diagnostics | `account_id`, `level`, `message` |

Full schema: [db-schema.md](./db-schema.md)

---

## API Endpoints

| Prefix | Purpose |
|--------|---------|
| `/auth/*` | Login, logout, session, user CRUD, password change |
| `/v2/signals/*` | Signal CRUD, trade plan save, signal→trade conversion |
| `/v2/trades/*` | Trade CRUD, bulk actions, trade events |
| `/v2/chart/*` | Chart snapshots, refresh, TV candles, symbols, AI context bundle |
| `/v2/ai/*` | AI analysis, Claude file management, templates, config |
| `/v2/notifications/*` | SSE stream (`/stream`), test emit, event types, user settings |
| `/v2/settings/*` | User settings (API keys, symbols, watchlist, execution profiles) |
| `/v2/system/*` | Cache list/detail/delete, storage stats/cleanup |
| `/v2/broker/*` | EA pull, EA sync, cTrader pull/sync, heartbeat |
| `/mt5/db/*` | DB table browser (tables, rows, schema, create, update) |
| `/mt5/health` | Health check (version, storage, enabled features) |

---

## Signals & Trades

### Signals
- Reference feed records. Created by AI analysis or manual input.
- Core fields: `user_id`, `source`, `symbol`, `side` (BUY/SELL), `entry`, `sl`, `tp`, `signal_tf`, `chart_tf`, `rr_planned`, `risk_pct_planned`, `status`, `raw_json` (full AI response).
- Status flow: `NEW` → `ACTIVE` → `CLOSED` / `CANCELLED` / `EXPIRED`.

### Trades
- Account-bound execution ledger records. Created when a signal is fanned out to a broker account.
- Core fields: `account_id`, `user_id`, `signal_id` (FK → signals.sid), `symbol`, `action`, `volume`, `entry`, `sl`, `tp`, `dispatch_status`, `execution_status`, `pnl_realized`, `broker_trade_id`.
- Status flow: `NEW` → `LEASED` → `CONSUMED` (by EA). Execution: `PENDING` → `OPEN` → `CLOSED` / `TP` / `SL` / `CANCELLED`.

### Trade Lifecycle
```
1. AI analysis → JSON with trade plans
2. webhook normalizes (normalizeAiAnalysisContract)
3. Signal row created → fanned out to Trade rows per account
4. MT5 EA polls GET /v2/broker/pull → gets task
5. EA executes on broker → POST /v2/broker/sync status
6. webhook updates trade → emitNotification SSE
7. web-ui receives SSE → toast + ticker + optional refresh
```

---

## Symbols

Normalization rules:
- Uppercase all characters
- Remove separators: `/`, `-`, `.`, `:`, spaces
- Strip broker prefixes: `BINANCE:`, `ICMARKETS:`

Examples:
| Raw | Normalized |
|-----|-----------|
| `BTC/USDT` | `BTCUSDT` |
| `EUR-USD` | `EURUSD` |
| `BINANCE:BTCUSDT` | `BTCUSDT` |
| `XAU/USD` | `XAUUSD` |

---

## Metadata & User Settings

| Storage | What | Examples |
|---------|------|----------|
| `users.metadata` (JSONB) | Non-secret preferences | Language, timezone, watchlist, UI config |
| `user_settings` (typed rows) | Key-value config | API keys (encrypted), cron toggles, notification preferences, enabled log prefixes |

**Settings row**: `(user_id, type, name, data JSONB, status)`. Unique on `(user_id, type, name)`.

Common types: `api_key`, `system_config`, `trade`, `notification`, `cron`.

---

## Logging & Audit

- Single `logs` table for all audit trails.
- Columns: `object_id`, `object_table`, `event_type`, `metadata` (JSONB), `user_id`, `created_at`.
- Use `mt5Log(objectId, table, metadata, userId)` for all event logging.
- EA-specific diagnostics go to `ea_logs` (account_id, level, message).

---

## Notifications (SSE)

- Server-Sent Events replacing 10s polling.
- Endpoint: `GET /v2/notifications/stream` — persistent connection per user.
- Event bus: `emitNotification(payload)` fans out to connected SSE clients.
- 8 event types: `trade_added`, `trade_updated`, `signal_added`, `broker_sync`, `news_alert`, `system_event`, `page_refresh`, `component_refresh`, `error`.
- Each event has 5 configurable channels: toast, console log, ticker bar, page refresh, sound.
- Settings stored in `user_settings` (type=`notification`, name=`preferences`).

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| **Single server.js** | No microservice overhead. One process, one port (443). Simple deploy. |
| **webhook serves UI** | Vite builds `web-ui/dist/`. webhook serves it as static files. No separate web server. |
| **SSE not WebSocket** | Notifications are server→client only. SSE simpler, auto-reconnects, proxy-friendly. |
| **Session cookies** | Simple browser auth. Mobile path: add Bearer token auth alongside. |
| **sid-first identity** | 9-char Base36 time-sortable IDs. No prefix. Human-readable, URL-safe. |
| **BullMQ for cron** | Redis-backed job queue for market data. Falls back to inline if Redis down. |
| **UPLOAD_TO_CLAUDE** toggle | `false` = base64 inline + text blocks. `true` = Claude Files API with file_id. |
| **JSONB metadata** | Flexible schemas for logs, signals, trades. No migration needed for new fields. |

---

## Compatibility

- EA and cTrader bridge payloads may still use legacy IDs (`signal_id`, `trade_id`).
- Server resolves `id/sid/legacy` transparently.
- Do not break old broker integrations without a migration plan and grace period.
- `SIG_*` and `TRD_*` prefixed IDs are migrated to clean 9-char SIDs.

## External APIs

Full external API reference: [external_apis.md](./external_apis.md)
