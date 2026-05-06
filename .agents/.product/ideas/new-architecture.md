# New Architecture

> Updated 2026-05-05. Replaces the single-process monolith mental model.

---

## Directory Responsibilities

| Directory | Role | Language | What it does |
|-----------|------|----------|-------------|
| **`webhook/`** | Backend API Server | Node.js | All business logic. HTTP server on :443 + :80→443 redirect. Receives REST requests, queries PostgreSQL, calls external APIs (Claude, TwelveData, Redis), pushes SSE events, serves static UI files. Single `server.js` (~17k lines). |
| **`web-ui/`** | Frontend SPA | React + Vite | All UI rendering, user interaction, API calling. `src/api.js` is the HTTP client (`fetch` + `EventSource`). React Router handles page navigation client-side. Built to `dist/` which webhook serves as static files. |
| **`bridge-clients/`** | Native broker bridges | MQL5 / C# | `TVBridgeEA.mq5` (MT5) and `TVBridge_CTrader.cs` (cTrader). Pull tasks from webhook, execute trades on broker, push status/updates back. Run inside trading platforms. |
| **`scripts/`** | Ops tooling | Bash | `deploy/`, `test/`, `bump_build_versions.sh`. All operational scripts. |
| **`.agents/`** | AI memory | Markdown | Architecture docs, feature docs, tickets, rules, worklog. Source of truth for AI agents. |

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
     └─────────┘     └───────────┘    └─────┬──────┘
                                           │
                                    ┌──────┴──────┐
                                    │   Browser   │
                                    │   Desktop   │── Electron / Tauri
                                    │   Mobile    │── PWA / React Native
                                    └─────────────┘
```

---

## Data Flow: Trade Lifecycle

```
1. AI analyzes charts → returns JSON with trade plans
2. webhook normalizes response (normalizeAiAnalysisContract)
3. webhook creates Signal + Trade rows in PostgreSQL
4. MT5 EA polls webhook (GET /v2/broker/pull) → gets new task
5. MT5 EA executes trade on broker → pushes status (POST /v2/broker/sync)
6. webhook updates trade status → emits SSE notification (emitNotification)
7. web-ui receives SSE → toast popup + ticker bar + optional page refresh
```

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| **Single server.js** | No microservice overhead. One process, one port. Simple deploy. |
| **webhook serves UI** | Vite builds web-ui to `dist/`. webhook serves it as static files. No separate web server. |
| **SSE not WebSocket** | Notifications are server→client only. SSE is simpler, auto-reconnects, works through proxies. |
| **Session cookies** | Simple auth for browser. To support mobile: add Bearer token auth alongside. |
| **BullMQ for cron** | Redis-backed job queue for market data fetching. Falls back to inline if Redis unavailable. |
| **UPLOAD_TO_CLAUDE toggle** | `false` = base64 inline images + text blocks. `true` = Claude Files API with file_id refs. |

---

## Multi-Platform Path

```
                    ┌─────────────────┐
                    │  REST API + SSE  │  (webhook — unchanged)
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────┴────┐   ┌────┴────┐   ┌─────┴─────┐
         │  Web UI │   │ Desktop │   │  Mobile   │
         │ (React) │   │ (Tauri  │   │(React     │
         │  Vite   │   │  + Rust)│   │ Native)   │
         └─────────┘   └─────────┘   └───────────┘
              │              │              │
         ┌────┴──────────────┴──────────────┴────┐
         │        api-client (shared)            │
         │   - REST calls (fetch wrapper)        │
         │   - SSE connection (EventSource)      │
         │   - Token auth (Bearer)               │
         │   - Platform adapters (storage, HTTP) │
         └───────────────────────────────────────┘
```

### What needs change for multi-platform

| # | Change | Why |
|---|--------|-----|
| 1 | Add `POST /auth/token` with Bearer auth | Cookies don't work in native mobile |
| 2 | Extract `api-client.js` from `api.js` — inject `fetch`, `storage`, `EventSource` | Same API calls, any runtime |
| 3 | Extract CSS design tokens to shared `theme.css` | Consistent look across platforms |
| 4 | Tauri shell (`tauri init`) wrapping existing React build | Desktop app in Rust, ~5MB |

---

## Future: Split webhook into modules

```
webhook/
├── server.js              ← Entry: HTTP server, middleware
├── routes/
│   ├── auth.js            ← /auth/*
│   ├── signals.js         ← /v2/signals/*
│   ├── trades.js          ← /v2/trades/*
│   ├── chart.js           ← /v2/chart/*
│   ├── ai.js              ← /v2/ai/*
│   ├── notifications.js   ← /v2/notifications/*
│   ├── settings.js        ← /v2/settings/*
│   ├── system.js          ← /v2/system/*
│   └── broker.js          ← /v2/broker/*
├── lib/
│   ├── db.js              ← PostgreSQL pool + queries
│   ├── sse.js             ← SSE bus (emitNotification)
│   ├── claude.js          ← Claude API client
│   ├── twelvedata.js      ← TwelveData API client
│   └── auth.js            ← Session + token helpers
└── cron/
    └── market-data.js     ← BullMQ market data jobs
```

Current 17k-line `server.js` → ~10 modules, each 200-800 lines. Same runtime, easier to maintain.
