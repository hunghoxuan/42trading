# Unified Cache Manager (Multi-Tier: Memory → Redis → DB/API)

## Status: COMPLETE

## Goal
Reduce redundant external API calls (Twelve Data, Claude) and DB queries by implementing a standardized 3-tier cache architecture across all data sources.

## Architecture

```
L1 Memory (Map, TTL-based) → L2 Redis (with EXPIRE) → L3 Fallback (DB or Remote API)
```

Managed by `StateRepo` (bucket registry) + `UnifiedCache` (get/set with request collapsing).

## Cache Coverage

| Source | Bucket | Key | TTL | Read | Write | Invalidate |
|---|---|---|---|---|---|---|
| **Twelve Data (chart bars)** | `tfCache` | `SYMBOL_TF` | TF-duration | Memory → Redis → DB → Twelve API | `tfCacheSet` + DB upsert + Redis write | TTL-based |
| **User Settings** | `USR:SET` | `{userId}` | 6h | `repoListUserSettings` → StateRepo → Redis → DB | — | `StateRepo.del` on update |
| **Watchlist** | `USR:WTL` | `{userId}` | 24h | `repoGetUserWatchlist` → StateRepo → Redis → DB | — | `StateRepo.del` on profile update |
| **Active/Pending Signals** | `SIG:PEN` | `{userId}` | 10min | `repoGetPendingSignals` → StateRepo → DB | — | `StateRepo.del` on signal create |
| **Active Trades (list)** | `TRD:LST` | `{cacheKey}` | 30s | StateRepo → Redis → DB (no-filter only) | — | TTL-based |
| **News/Calendar** | `NEWS:CAL` | `today` | 1h | StateRepo → Redis → ForexFactory | `StateRepo.set` on refresh | — |
| **System Settings (API keys)** | `SYS:CFG` | `global` | 24h | `repoGetSystemSettings` → StateRepo → Redis → DB | — | `StateRepo.del` on key update |
| **User Accounts** | `USR:ACC` | `{userId}` | 1h | `repoGetUserAccounts` → StateRepo → Redis → DB | — | `StateRepo.del` on broker sync |
| **Signal Detail** | `SIG:DET` | `{signalId}` | 24h | StateRepo → Redis → DB | — | `StateRepo.del` on trade update / plan save |
| **Trade Detail** | `TRD:DET` | `{tradeId}` | 24h | StateRepo → Redis → DB | — | `StateRepo.del` on trade update |
| **User Profile** | `USR:PRO` | `{userId}` | 12h | StateRepo → Redis → DB | — | `StateRepo.del` on profile update |
| **User Templates** | `USR:TPL` | `{userId}` | 6h | StateRepo → Redis → DB | — | `StateRepo.del` on template create |
| **Market Latest** | `MKT:LAT` | in-memory | 5min | Memory Map | Set on data fetch | — |

## Key Design Decisions

- **Request Collapsing**: `UnifiedCache.get` deduplicates concurrent requests for the same key — only one fetch executes, others await the same promise.
- **Graceful Degradation**: If Redis is unavailable, the system falls back to L1 → L3 directly.
- **Short TTL for Trades**: Trade list cache uses 30s TTL with no manual invalidation — acceptable because trade data is time-sensitive and cache size is bounded.
- **Long TTL for Detail**: Signal/Trade detail cache uses 24h because detail pages are read-heavy and changes trigger explicit invalidation.

## Changed Files
- `webhook/server.js` — StateRepo buckets, UnifiedCache, all cache-wrapped endpoints, invalidation hooks

## Verification
- Build succeeds, PM2 restart clean, health endpoint returns current version.
