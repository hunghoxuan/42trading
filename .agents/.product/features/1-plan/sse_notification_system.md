# Feature: SSE Notification System

## Status: DONE ✅

## User Flow
Real-time push notifications for all trading events, displayed as in-app toasts, a marquee ticker under the DayClock bar, browser notifications, console logs, and sounds — all configurable per event type. Settings in **User → Settings → Notifications** tab.

## Key Capabilities
- **SSE Stream**: `GET /v2/notifications/stream` — one persistent connection per user, 30s heartbeat, auto-reconnect on disconnect.
- **9 Event Types**: trade_added, trade_updated, signal_added, broker_sync, news_alert, system_event, page_refresh, component_refresh, error.
- **Per-Event Channels**: Each event type has independent toggles: Toast, Console Log, Ticker, Refresh, Component Refresh, Sound, Position.
- **User Settings Intersection**: SSE sends `notification_settings` (max capability). Frontend intersects with user's saved preferences from `user_settings` table. User can mute any event type.
- **Generic Data Updates**: SSE payload has `page_id` + `data` fields. Frontend `useRealtimeData(pageId, callback)` hook dispatches to any page. Currently TradesPage patches PnL/pips/status in-place on broker sync.
- **Ticker Bar**: Light gray scrolling CSS marquee under the SessionClock bar.

## Payload Schema (current)
```json
{
  "user_id": "string",
  "page_id": "trades | signals | dashboard | ai",
  "event": "trade_added | trade_updated | signal_added | broker_sync | news_alert | system_event | page_refresh | component_refresh | error",
  "data": [...],
  "message": "string",
  "type": "info | warning | error | success",
  "notification_settings": { "toast": true, "ticker": true, "sound": false },
  "need_refresh": false,
  "comp_refresh": false
}
```

## Technical Details
- **Endpoints**: `GET /v2/notifications/stream` (SSE), `POST /v2/notifications/emit`, `POST /v2/notifications/test`, `GET /v2/notifications/events`, `GET/POST /v2/notifications/settings`
- **Backend**: `emitNotification(payload)` fans to in-memory SSE clients. `bumpPulse` refactored to emit SSE. Broker sync emits `page_id: "trades"` with trade diffs.
- **Frontend**: `NotificationWatcher` uses `EventSource`, loads user prefs on mount, intersects with SSE `notification_settings`. `useRealtimeData` hook for page-level data patching.
- **Storage**: `user_settings` row: type=`notification`, name=`preferences`, data=JSON of per-event toggles.

## UI Impact
- **New**: Ticker bar under DayClock
- **New**: `User → Settings → Notifications` tab — per-event toggles with ▶ test button
- **Modified**: `NotificationWatcher` (poll → SSE, user pref intersection)
- **Modified**: `TradesPage` (realtime PnL/pips patch via `useRealtimeData`)
- **New**: `useRealtimeData` hook for any page
