# NotificationHub — Unified Event & API Call Tracking

> Feature doc. 2026-05-10

## Problem

Two separate systems exist with no unified tracking:

| System | Used for | Survives navigation? |
|---|---|---|
| `NotificationManager` (SSE) | toast, ticker, `data-update` | ❌ depends on page listener |
| Raw `fetch()` calls | analyze, snapshot, create, context | ❌ lost if page unmounts |

When user clicks Analyze and navigates away:
- The API call completes on the server but the response is dropped
- No notification that analysis finished
- No way to view results after returning

## Design — NotificationHub

```
┌────────────────────────────────────────────────────────────┐
│                     NotificationHub                         │
│                                                            │
│  EMIT (server → client)                                    │
│    emit(eventType, subType, payload)                        │
│      → same as NotificationManager.handle()                │
│      → SSE toast/ticker/data-update preserved              │
│                                                            │
│  TRACK (client → server → client)                          │
│    track(type, payload, fetchFn) → { requestId, promise }  │
│      → wraps fetch, stores result in localStorage          │
│      → dispatches "hub-result" event on completion         │
│      → dedup: same type+payload → reuses pending promise   │
│                                                            │
│  SUBSCRIBE                                                  │
│    on(eventType, handler) → unsubscribe                     │
│    onResult(requestId, handler) → unsubscribe               │
│                                                            │
│  PERSIST                                                     │
│    localStorage["hub:results"] = [{requestId, type, ...}]  │
│    TTL: 1 hour, max 50 entries                             │
│    Survives page refresh, navigation, tab close            │
│                                                            │
│  NOTIFICATIONS                                               │
│    Completed API calls show as notification dot + message  │
│    Click → opens result page                               │
│    "Analysis ready: BTCUSD (click to view)"                │
│    "Snapshot captured: 3 files"                            │
└────────────────────────────────────────────────────────────┘
```

## API Types Tracked

| Type | Endpoint | On complete | Click action |
|---|---|---|---|
| `analyze` | POST `/v2/chart/snapshots/analyze` | "Analysis ready: {symbol}" | Open /files |
| `snapshot` | POST `/v2/chart/snapshot/batch` | "Captured N snapshots" | Open /files |
| `create_trade` | POST `/v2/trades/create` | "Trade created: {symbol}" | Open /trades/{sid} |
| `create_signal` | POST `/v2/signals/create` | "Signal created: {symbol}" | Open /signals/{sid} |

## Existing SSE Events (preserved)

| Event | Behaviour |
|---|---|
| `BROKER_SYNC` | Ticker update + `data-update` for TradesPage |
| `TRADE_FILLED` | Toast + ticker |
| `TRADE_CLOSED` | Toast + ticker |
| `SIGNAL_ADDED` | Toast + ticker |
| `SYSTEM_EVENT` | Console log + db_log |
| `REMOTE_API_CALL` | db_log only |
| `twelve_error` | db_log + ticker |

## Lifecycle

```
Component mounts
  → if requestId in URL: read from localStorage["hub:results"], render
  → NotificationHub.on("BROKER_SYNC", handleSync)

User clicks Analyze
  → result = NotificationHub.track("analyze", {symbol}, () => api.chartSnapshotsAnalyze(payload))
  → If page stays: await result.promise, setState, render
  → If page navigates away: component unmounts, hub continues tracking
      → Promise resolves, hub stores result
      → hub dispatches "hub-result" event
      → Notification dot appears in header
      → User clicks dot → navigates to /files?result={requestId}
      → Page reads localStorage["hub:results"][requestId], renders

User returns to page
  → checks NotificationHub.getResult(requestId) → if found, renders immediately
  → if not found, checks NotificationHub.isPending(requestId) → shows spinner
```

## File Structure

```
web-ui/src/
├── services/
│   └── NotificationHub.js     ← new: singleton hub (emit + track + subscribe)
├── components/
│   ├── NotificationWatcher.jsx ← updated: uses hub.emit for SSE events
│   ├── NotificationDot.jsx    ← new: header dot showing pending/completed
│   └── TickerBar.jsx          ← unchanged: reads hub.ticker queue
└── pages/
    └── ai/ChartSnapshotsPage.jsx  ← updated: uses hub.track for analyze
```

## Implementation Notes

- `NotificationHub` is a **module-level singleton** — no React dependency
- Uses `window.CustomEvent` for in-page, `localStorage` for cross-navigation
- `BroadcastChannel("notification-hub")` for cross-tab awareness
- `NotificationWatcher` becomes a thin SSE bridge → hub
- `NotificationManager` on backend is **untouched** — same SSE format
- Hub result storage key: `hub:results` = JSON array, max 50 entries, 1h TTL
