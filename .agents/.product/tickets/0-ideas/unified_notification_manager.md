# Unified Notification Manager

## Status: Plan

## Goal
Replace all ad-hoc logging, SSE emission, and notification calls with a single `NotificationManager`. Every event goes through one entry point. Channels (toast, ticker, db_log, email, telegram, sound) are configured per event type via user settings.

## Architecture

```
Event occurs (broker sync, trade update, API call, etc.)
  → NotificationManager.handle(eventType, payload)
    → Load per-event user settings (in-memory cache)
    → Route to enabled channels:
      ├── Async Queue ─┬── db_log (INSERT into logs table)
      │                 ├── email (send via SMTP)
      │                 └── telegram (send via bot)
      ├── SSE ─────────┬── toast (frontend ToastContainer)
      │                 ├── ticker (frontend TickerBar, deduped)
      │                 ├── sound (frontend SoundManager)
      │                 ├── comp_refresh (frontend component refresh)
      │                 └── page_refresh (frontend reload)
      └── console.log (direct)
```

## Event Types

| Event | Sub-types | Description | Default channels |
|---|---|---|---|
| `TRADE_ACTIVITY` | added, updated, deleted | Trade create/update/delete | toast, ticker, db_log, telegram |
| `SIGNAL_ACTIVITY` | added, updated, deleted | Signal create/update/delete | toast, ticker, db_log, telegram |
| `BROKER_POLL` | — | Periodic broker data poll | db_log (no toast/ticker noise) |
| `BROKER_SYNC` | — | Broker sync cycle result | db_log, ticker (summary only) |
| `SYSTEM_EVENT` | — | System admin actions | db_log, console_log |
| `REMOTE_API_CALL` | — | Twelve Data / Claude / OpenAI call | db_log (for auditing) |

### Removed events
- **ERROR** → removed. Severity is a field on any event (`info`, `warning`, `error`). NotificationManager checks severity.
- **COMPONENT_REFRESH** → removed. Merged into `comp_refresh: true` flag on any event payload.
- **PAGE_REFRESH** → removed. Merged into `need_refresh: true` flag on any event payload.

## Channel Config (per event type, stored in user_settings)

| Channel | Type | Default | Description |
|---|---|---|---|
| `toast` | bool | varies | SSE → frontend toast popup |
| `console_log` | bool | false | Server-side console.log |
| `ticker` | bool | varies | SSE → frontend scrolling ticker (deduped) |
| `db_log` | bool | true | Async queue → INSERT into logs table |
| `email` | bool | false | Async queue → send email (if email_receiver set) |
| `telegram` | bool | false | Async queue → send Telegram (if chat_id set) |
| `sound` | combo | varies | SSE → frontend SoundManager |
| `comp_refresh` | bool | false | SSE → frontend component refresh signal |
| `need_refresh` | bool | false | SSE → frontend page reload signal |
| `custom_message` | text | "" | Custom message template (overrides default) |
| `email_receiver` | text | "" | Email address for email channel |
| `telegram_chat_id` | text | "" | Telegram chat ID for telegram channel |

## Async Queue

DB logs + Email + Telegram should not block the main request.

### Option A: In-memory queue + periodic batch flush (recommended start)
```javascript
const notificationQueue = [];
setInterval(() => {
  const batch = notificationQueue.splice(0);
  // Process batch: INSERT logs, send emails, send telegrams
  Promise.allSettled(batch.map(processItem));
}, 1000);
```
- No new dependencies
- At-most-once delivery (acceptable for logs)
- ~1s latency for async channels

### Option B: BullMQ (already installed, uses Redis)
- At-least-once delivery with retry
- Persistent across server restarts
- Better for email/telegram where delivery matters

## Frontend Changes

### NotificationWatcher.jsx (refactored)
- Still connects to SSE
- Reads payload's `channel` field to determine which frontend channels to trigger
- No logic changes needed — the SSE format stays the same

### TickerBar.jsx (dedup already done)
- No change needed

### EventsPage.jsx → NotificationSettings.jsx
- Single unified page
- Shows all event types with their channel config
- Save updates user_settings in DB

## Backend Changes

### NotificationManager
```javascript
class NotificationManager {
  constructor() {
    this.settingsCache = new Map(); // eventType → settings
  }

  async init() {
    // Load all user notification settings from DB into cache
  }

  async handle(eventType, payload) {
    const settings = this.getSettings(eventType);
    if (!settings) return;

    if (settings.console_log) console.log(...);
    if (settings.db_log) this.enqueue('db_log', payload);
    if (settings.email && settings.email_receiver) this.enqueue('email', payload);
    if (settings.telegram && settings.telegram_chat_id) this.enqueue('telegram', payload);
    if (settings.toast || settings.ticker || settings.sound) {
      emitNotification(payload); // SSE to frontend
    }
  }

  enqueue(channel, payload) {
    this.queue.push({ channel, payload });
  }

  async flushQueue() {
    const batch = this.queue.splice(0);
    for (const item of batch) {
      // dispatch to channel handler
    }
  }
}
```

### Migration plan
1. Create NotificationManager class
2. Add notification settings to user_settings (type=`notification_config`)
3. Replace all ad-hoc `emitNotification()` calls with `NotificationManager.handle()`
4. Replace all ad-hoc `mt5Log()` / `b.log()` calls with `NotificationManager.handle()`
5. Remove `GLOBAL_API_STATS` → merge into NotificationManager with `REMOTE_API_CALL` event
6. Update EventsPage to new settings schema

## Files Changed
- `webhook/server.js` — add NotificationManager class, replace all emitNotification/log calls
- `src/ui/src/components/NotificationWatcher.jsx` — minor refactor
- `src/ui/src/pages/system/EventsPage.jsx` → `NotificationSettings.jsx` — new settings UI
- `.agents/.product/features/1-plan/sse_notification_system.md` — update
- `.agents/.product/tickets/feature_tracker.md` — update
