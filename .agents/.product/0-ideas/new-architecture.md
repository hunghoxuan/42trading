# V3 Architecture — Strangler Migration

> Updated 2026-05-06. v2 untouched, v3 built alongside. Same DB, two API servers, one universal UI.

---

## v2 vs v3 — Directory Layout

```
trading/
│
├── v2 (untouched — current production)
│   ├── webhook/          ← Node.js server.js, port 443
│   ├── web/              ← Landing page
│   ├── web-ui/           ← React SPA (current)
│   ├── bridge-clients/   ← MT5 EA + cTrader (unchanged)
│   └── scripts/          ← Deploy ops
│
├── v3 (new — built alongside)
│   └── app/
│       ├── api/           ← Hono server, port 8443
│       │   ├── src/
│       │   │   ├── index.ts        ← Entry: Hono app
│       │   │   ├── routes/         ← /v3/* route handlers
│       │   │   ├── middleware/     ← Auth, CORS, logging
│       │   │   └── lib/            ← DB, SSE, Claude, TwelveData
│       │   └── package.json
│       │
│       ├── ui/            ← Universal React + Tauri (1 codebase)
│       │   ├── src/       ← Shared UI components + pages
│       │   ├── src-tauri/ ← Tauri shell (Rust) — desktop only
│       │   └── package.json
│       │
│       └── drizzle/       ← Drizzle ORM schema + migrations
│           ├── schema.ts
│           └── migrations/
│
└── shared/               ← Already exists — shared contracts
    └── ai_response_schema.json
```

---

## VPS Runtime — Two Servers, Same DB

```
                    ┌──────────────────────────┐
                    │       PostgreSQL          │
                    │   (shared — no migration) │
                    └────────┬─────────────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
       ┌────┴────┐     ┌─────┴─────┐    ┌─────┴──────┐
       │ v2 API  │     │  v3 API   │    │ Shared     │
       │ :443    │     │  :8443    │    │ Redis      │
       │ Node.js │     │  Hono     │    │ (cache)    │
       │ PM2:    │     │  PM2:     │    └────────────┘
       │ webhook │     │  app-api  │
       └────┬────┘     └─────┬─────┘
            │                │
       ┌────┴────┐     ┌─────┴─────┐
       │ v2 UI   │     │  v3 UI    │
       │ / (SPA) │     │  /v3/*    │
       │ React   │     │  React    │
       │         │     │  + Tauri  │──► Desktop app (Rust shell)
       └─────────┘     └───────────┘
```

### Nginx routing (single domain, both APIs)

```
https://trade.mozasolution.com/v2/*  → localhost:443   (v2, untouched)
https://trade.mozasolution.com/v3/*  → localhost:8443   (v3, new Hono)
https://trade.mozasolution.com/      → v2 web-ui        (landing + SPA)
```

---

## v3 Stack

| Layer | Choice | Why |
|-------|--------|-----|
| **API runtime** | Hono (Node.js) | Fast, typed, familiar Node ecosystem. No Bun/Deno lock-in. |
| **DB layer** | Drizzle ORM | Type-safe SQL, mirrors existing Postgres schema. No migration needed — read-only at first. |
| **UI framework** | React + Vite | Same as v2. Reuse existing components. |
| **Desktop shell** | **Tauri (Rust)** | ~5MB bundle vs Electron's ~150MB. Native WebView. Same React code runs in browser AND desktop. |
| **State management** | TanStack Query | Caching, invalidation, realtime patching. |
| **Realtime** | WebSocket (v3) | Bidirectional, lower latency than SSE. SSE stays on v2 for backward compat. |
| **Shared contracts** | `shared/` folder | `ai_response_schema.json` already exists. Add TypeScript types. |

---

## Why Tauri over Electron

| Factor | Tauri | Electron |
|--------|-------|----------|
| Bundle size | ~5 MB | ~150 MB |
| RAM at runtime | ~50 MB | ~250 MB |
| Backend language | Rust | Node.js |
| Renderer | OS WebView (WebKit/WinRT) | Chromium |
| Mobile (iOS/Android) | ✅ Tauri v2 | ❌ |
| Auto-updater | ✅ Built-in | ✅ Built-in |
| System tray | ✅ | ✅ |
| Native notifications | ✅ | ✅ |
| Same React code | ✅ | ✅ |

The React UI built once. Browser fetches it from Vite dev server or static build. Tauri loads the same `dist/` into a native window. Zero code fork.

---

## Strangler Migration — Phase Plan

```
Phase 1: Foundation (Week 1-2)
  └── Scaffold v3/app/api, health route, auth middleware
  └── Drizzle schema mirror of current tables
  └── v2 untouched, v3 running on :8443

Phase 2: Read routes (Week 3-4)
  └── GET /v3/trades, /v3/signals, /v3/chart/context
  └── Parity tests: v2 response === v3 response
  └── UI still hits v2

Phase 3: Realtime (Week 5-6)
  └── WebSocket /v3/stream (trade_added, signal_added, broker_sync)
  └── TanStack Query in UI — cache invalidation from WS events
  └── UI optionally switches to v3

Phase 4: Write routes (Week 7-8)
  └── POST /v3/trades/create, /v3/signals/create
  └── Dual-write: v2 + v3 both create rows
  └── Feature flag per module

Phase 5: UI cutover (Week 9-10)
  └── Switch UI pages from v2 to v3 per module
  └── v2 routes stay active as fallback

Phase 6: Sunset v2 (Week 11+)
  └── Remove v2 routes after parity confirmed + soak period
  └── Keep v2 webhook for broker bridge compat until EA migrated
```

---

## Key Design Decisions (v3)

| Decision | Why |
|----------|-----|
| **Hono on Node.js** | Same runtime as v2. No new infra. Easy PM2 deploy. |
| **Drizzle, not Prisma** | Lighter, SQL-first, no codegen. Mirror existing schema, no migration. |
| **Tauri for desktop** | 5MB, Rust, same React UI. Beats Electron on every metric. |
| **Same PostgreSQL** | No data migration. v2 and v3 share tables. Drizzle reads existing schema. |
| **WebSocket for v3** | Bidirectional realtime. SSE stays on v2 for backward compat. |
| **Nginx path routing** | Single domain, no port in URL. v2 and v3 transparent to users. |
| **Strangler pattern** | No big-bang rewrite. Route by route migration. v2 and v3 run in parallel. |
