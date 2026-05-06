# Ticket: SSE Notification System

## Meta
- ID: `FEAT-20260505-SSE-NOTIFICATIONS`
- Status: `PLANNED`
- Priority: `P1`
- Feature Doc: [../features/1-plan/sse_notification_system.md]

## Scope

### Backend (`webhook/server.js`)
1. **SSE endpoint** `GET /v2/notifications/stream` — keep-alive `text/event-stream`, filters by `user_id` from session, pushes JSON events
2. **Event emitter** — refactor `bumpPulse` into `emitNotification(payload)` that writes to in-memory event queues per user + publishes to Redis for cross-process
3. **POST /v2/notifications/emit** — internal endpoint for other processes to push events
4. **GET /v2/notifications/events** — return list of all event types with their default channel toggles
5. **GET/POST /v2/notifications/settings** — read/write user's notification preferences from `user_settings` (type=`notification`, name=`preferences`)
6. **Remove** dual `/v2/notifications/pulse` handlers (lines ~12154 + ~16358) — replace with SSE stream

### Frontend
1. **`NotificationWatcher.jsx`** — replace `setInterval(checkPulse, 10000)` with `EventSource("/v2/notifications/stream")`. Handle `onmessage`, parse payload, dispatch to channels.
2. **`TickerBar.jsx`** — new component: light gray `<marquee>` or CSS-scroll text under SessionClockBar, fed by ticker events. Mount in `App.jsx`.
3. **`EventsPage.jsx`** — new page at `/system/events`: table of event types (trade_added, trade_updated, ...), each row has checkboxes: Notification, Console Log, Ticker, Refresh, Sound. Loads defaults from API, saves via `upsertSetting`.
4. **`App.jsx`** — add `/system/events` route + System menu entry. Mount `<TickerBar />` below `<SessionClockBar />`.
5. **`api.js`** — remove `notificationPulse`, add `notificationSettings()` get/post.

### Event Types (default toggles)
| Event | Notification | Console | Ticker | Refresh | Sound |
|-------|:---:|:---:|:---:|:---:|:---:|
| trade_added | ✅ | | ✅ | | NEW_SIGNAL |
| trade_updated | | | ✅ | | |
| signal_added | ✅ | | ✅ | | NEW_SIGNAL |
| broker_sync | | | ✅ | | |
| news_alert | ✅ | | ✅ | | NEWS_ALERT |
| system_event | | ✅ | ✅ | | |
| page_refresh | | | | ✅ | |
| error | ✅ | ✅ | ✅ | | |

### Files
- `webhook/server.js` — SSE endpoint + emit + settings
- `web-ui/src/components/NotificationWatcher.jsx` — SSE client
- `web-ui/src/components/TickerBar.jsx` — new
- `web-ui/src/pages/system/EventsPage.jsx` — new
- `web-ui/src/App.jsx` — route + menu + TickerBar mount
- `web-ui/src/api.js` — settings API
- `.agents/.product/features/1-plan/sse_notification_system.md` — feature doc
- `.agents/.product/tickets/feature_tracker.md` — tracker update

### Non-Goals
- No WebSocket transport
- No auth changes — SSE uses existing session cookie
- No changes to SessionClockBar itself
- No DB schema migration (uses existing `user_settings`)
