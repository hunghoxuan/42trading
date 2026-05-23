# Local Dev Environment

## Architecture

```
Browser (localhost:3000)
    │
    ▼
Vite dev server (port 3000, strictPort)
    │ proxy /v2/*, /mt5/*, /sse/*, /auth/*, /health/*
    ▼
Webhook API server (port 3001)
    │
    ▼
PostgreSQL (localhost:5432, mt5_bridge)
```

## Ports

| Port | Process | Notes |
|------|---------|-------|
| 3000 | Vite UI | Only URL user opens. Proxies API calls to 3001. |
| 3001 | Webhook API | API-only, no UI serving. |
| 5432 | PostgreSQL | Local Homebrew postgres. |

## Constraints

1. **Single origin** — browser must only talk to port 3000. Vite proxy handles everything else. No CORS.
2. **No hardcoded ports in built JS** — `.env` has `VITE_API_BASE=` (empty). `.env.local` empty. `vite.config.js` proxy target is `localhost:3001`.
3. **`runtimeApiBase()`** returns `origin` on localhost non-standard ports. Falls through to same-origin. No `VITE_API_BASE` env var needed.
4. **Webhook is API-only** — no static UI serving. Must use Vite.
5. **DB must match VPS schema** — restored via `pg_dump` from VPS. Otherwise column mismatches.

## Start

```bash
bash scripts/start/start_local.sh
```

Script kills old processes on 3000/3001, starts webhook (3001) then Vite (3000).

## DB Sync

```bash
# Full restore from VPS
ssh root@139.59.211.192 "sudo -u postgres pg_dump mt5_bridge --no-owner --no-acl" \
  | psql "postgresql://mt5_user:...@127.0.0.1:5432/mt5_bridge"
```

## Lessons

1. **`.env` vs `.env.local`** — Vite loads `.env` first, `.env.local` overrides. A stale `.env` with `VITE_API_BASE=http://localhost:5174` caused all requests to hit a dead port. Fix: set `VITE_API_BASE=` in `.env.local` to override.

2. **`localStorage` cache** — `runtimeApiBase()` checks `localStorage.tvbridge_api_base`. Old VPS URLs persisted across restarts. Fix: clear localStorage or set query param `?apiBase=`.

3. **Multiple servers** — stale processes on ports 3000, 5173, 5174 caused confusion. Start script now kills all known ports first.

4. **Built UI vs Vite** — built `dist` has `import.meta.env.DEV = false`, uses `DEFAULT_REMOTE_BASE`. Vite dev mode uses `origin`. Different code paths. Must rebuild after env changes.

5. **Schema drift** — local and VPS DB schemas diverged. Local was missing columns like `invalidation`. Full `pg_dump` restore fixes this.

6. **`strictPort: true`** — prevents Vite from auto-incrementing to 5173 when 5174 is taken. Critical for predictable ports.
