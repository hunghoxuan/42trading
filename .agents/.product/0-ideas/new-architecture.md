# V3 Architecture — Desktop App + Strangler Migration

> Updated 2026-05-08. Desktop app live. v2 untouched.

---

## Current State

```
trading/
├── v2 (production)
│   ├── webhook/          ← Node.js server.js, :443 on VPS
│   ├── src/ui/           ← React SPA (current web UI)
│   ├── bridge-clients/   ← MT5 EA + cTrader
│   └── scripts/          ← Deploy ops, build scripts
│
├── v3 (new — desktop + web)
│   └── app/ui/
│       ├── src/           ← React + TypeScript (imports v2 pages via @v2/*)
│       │   ├── App.tsx    ← Shell: nav bar, API URL, admin key
│       │   ├── api.ts     ← API client (tvbridge_api_base + tvbridge_api_key)
│       │   ├── styles.css ← v2 CSS tokens
│       │   └── pages/
│       │       └── HomePage.tsx  ← Health check + dual auth (API key / Login)
│       └── src-tauri/     ← Tauri v2 shell (Rust) — desktop only
│           └── target/release/bundle/macos/
│               └── Antigravity.app  ← 8.2MB desktop app
│
└── shared/               ← AI response schema, contracts
```

---

## Architecture

```
                    ┌──────────────────────────┐
                    │       PostgreSQL          │
                    │   (v2 only — no change)   │
                    └────────┬─────────────────┘
                             │
                    ┌────────┴────────┐
                    │    v2 API       │
                    │    :443 (VPS)   │
                    │    Node.js      │
                    │    PM2: webhook │
                    └────────┬────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
       ┌────┴────┐     ┌─────┴─────┐    ┌─────┴──────┐
       │ v2 UI   │     │ v3 Desktop │    │ v3 Web     │
       │ / (SPA) │     │ Tauri app  │    │ /v3/*      │
       │ React   │     │ 8.2MB      │    │ React      │
       └─────────┘     │ Mac+Win+   │    └────────────┘
                       │ Linux      │
                       └───────────┘
```

---

## Key Decisions

| Decision | Why |
|----------|-----|
| **Desktop first** | No backend migration. Desktop app connects to existing v2 API. |
| **Tauri, not Electron** | 8.2MB vs 150MB. Same React code. |
| **No Hono/Drizzle in Phase 1** | Avoid rewriting 100s of route handlers. v2 works. |
| **Import v2 pages via alias** | `@v2/*` → `src/ui/src/*`. Zero rewrites. |
| **Same PostgreSQL** | No data migration. v2 and v3 share tables. |
| **Admin key auth** | `x-api-key` header bridges v3 to v2 auth. No session cookies needed. |
| **Zed tasks** | `.zed/tasks.json` — Launch, Restart, Build, Deploy, Dev Server. |

---

## Phase Plan

```
Phase 1: Desktop App ✅ DONE
  └── Tauri + React, imports v2 pages
  └── API URL + admin key in header
  └── Health check, dual auth
  └── Mac build: 8.2MB .app

Phase 2: Backend migration (later)
  └── Hono + Drizzle only if needed
  └── Evaluate after desktop app stabilized
```

---

## Build & Deploy

| Command | What |
|---------|------|
| `bash scripts/build_desktop.sh` | Build Tauri desktop app |
| `bash scripts/restart_desktop.sh` | Kill + relaunch desktop app |
| `bash scripts/deploy/deploy_webhook.sh` | Deploy v2 webhook to VPS |
| `cd app/ui && npm run dev` | V3 dev server (hot reload) |
