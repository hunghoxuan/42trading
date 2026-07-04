# 42Trade Architecture

## System Summary

| Area | Current implementation | Why it exists in 42Trade | Why not the simpler alternative |
|---|---|---|---|
| Admin UI | React 18 + Vite in `src/admin` | Fast local iteration, component-based admin screens, good fit for dense internal tooling | A server-rendered UI would slow iteration on chart-heavy admin pages |
| API server | Node.js in `src/api/server.js` plus domain modules | One runtime handles HTTP, realtime, jobs, and file/object orchestration in the same process | Splitting into many microservices would add operational cost before boundaries are fully stable |
| Realtime transport | Socket.IO plus SSE seams | Socket.IO is used for interactive admin subscriptions; SSE remains available for simple topic streams | Plain WebSocket would require more custom reconnect/auth work; SSE alone is weaker for bidirectional flows |
| Queue / automation | Node timers locally, BullMQ in richer environments | Same code supports lightweight local runs and Redis-backed production automation | BullMQ-only would make local development heavier |
| Cache | In-memory or Redis through facades | Keep local setup simple, but allow shared runtime caches when Redis is present | Redis-only would add setup friction for every developer |
| Pub/sub | In-memory or Redis through facades | Lets realtime fanout work in one process or multiple processes | Hard-coding one broker would reduce deploy flexibility |
| Market data storage | CSV, Parquet + DuckDB, or Postgres providers | The codebase supports simple file flows, analytics-friendly storage, and a future DB-backed path | One storage backend would force either weaker analytics or more ops than needed |
| DB access | Drizzle ORM plus raw SQL/schema files | Gives typed schema definitions while still allowing direct SQL and backend-specific control | Pure raw SQL would be harder to keep aligned across SQLite and Postgres |
| Config contracts | JSON files under `src/config` | Strategies, schemas, apps, and rule variables are editable, serializable, and shared by API + UI | Hard-coding these into JS would make product iteration slower |
| MT5 bridge | HTTP bridge client in API + Python MT5 bridge service | Keeps trading-host-specific MT5 logic isolated from the main Node app | Calling MT5 directly from Node is not practical on non-MT5 hosts |

## Top-Level Runtime View

| Layer | Main paths | Responsibility |
|---|---|---|
| UI | `src/admin` | Trading/admin SPA, chart UX, backtest UI, realtime client state |
| API | `src/api` | HTTP routing, jobs, domain orchestration, realtime, integrations |
| Shared config | `src/config` | JSON contracts, presets, strategy assets |
| DB package | `src/db` | Drizzle schemas and DB helpers |
| Bridge runtimes | `src/mt5-bridge` | MT5 client artifacts and Python bridge service |
| Data roots | `data/` and object-store providers | Runtime bars, user objects, snapshots, derived artifacts |

## API Runtime Shape

| Concern | Current location | Notes |
|---|---|---|
| Composition root | `src/api/server.js` | Still the biggest integration point |
| Domain modules | `src/api/modules/42trade/*`, `src/api/modules/42pay/*`, `src/api/modules/system/*` | Domain-first split is underway |
| Runtime seams | `src/api/shared/runtime/**` | Provider/facade abstraction for automation, cache, pub/sub, streaming, chart history |
| External clients | `src/api/shared/clients/**` | Bridge and remote-service clients |
| Persistence seams | `src/api/shared/objects`, `src/api/modules/42trade/marketData`, `src/api/modules/42trade/trades`, `src/db` | Mixed file, DB, and provider-backed persistence |

## Why the Runtime Provider Layer Exists

| Problem | Provider-layer answer |
|---|---|
| Local development should work without Redis or BullMQ | Default providers use memory and node timers |
| Production may need shared state and distributed workers | Redis and BullMQ providers plug into the same facades |
| Realtime should support multiple delivery modes | Streaming facade fronts Socket.IO and SSE providers |
| Market history and caching policies evolve independently | Chart history and cache each have their own provider boundary |

## Current Architectural Direction

| Direction | Meaning |
|---|---|
| Domain-driven API split | Domain folders should own orchestration and persistence seams |
| Provider/facade seams | Runtime infrastructure should stay swappable behind stable facades |
| File-backed plus DB-backed coexistence | Legacy file data and newer DB/object-store paths must coexist during migration |
| Shared contracts in JSON | API and UI should read the same schema and strategy assets |
| Realtime topic normalization | Charts, trades, notifications, logs, news, and MT5 events should all flow through named topics |

## Cross-Reference

| Need | Read next |
|---|---|
| Folder rules | [project-structure.md](./project-structure.md) |
| Contracts and schemas | [schema-reference.md](./schema-reference.md) |
| Runtime providers and realtime | [runtime-realtime.md](./runtime-realtime.md) |
| Trading, strategies, and backtests | [trading-backtests.md](./trading-backtests.md) |
| Integrations and storage | [integrations-storage.md](./integrations-storage.md) |
