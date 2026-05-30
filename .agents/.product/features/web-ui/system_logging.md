# Feature: System Logging & Audit

## Architecture

All logging is **flat-file only**. No DB table. Every event appends one line to a `.log` file under `SERVER_LOG_DIR`.

**Format (one line per event):**
```
[ISO_MS] LEVEL EVENT_TYPE object_type=TABLE object_id=ID key=val key="val with spaces" ...
```

## Directory Structure

```
SERVER_LOG_DIR/
├── system/
│   ├── events.log          # SYSTEM_EVENT, REMOTE_API_CALL, system-level
│   └── error.log           # Any ERROR-level event (mirrored from all sources)
│
├── accounts/{source_id}/     # source_id = broker/provider (e.g. Ctrader, MT5)
│   ├── heartbeat.log       # ACCOUNT_HEARTBEAT
│   ├── sync.log            # ACCOUNT_SYNC, SIGNAL_EA_SYNC_PUSH, SIGNAL_EA_SYNC_*, BROKER_SYNC
│   ├── prices.log          # PRICES_SYNC, PRICE_PUSH, BROKER_POLL
│   ├── bars.log            # BAR_PUSH
│   └── ea.log              # EA (general EA messages)
│
├── trades/{sid}/           # sid = trade session id
│   ├── ack.log             # TRADE_ACK, TRADE_ACK_DUPLICATE, TRADE_ACK_FAILED
│   ├── sync.log            # TRADE_SYNC_UPDATE, TRADE_SYNC_CLOSE, TRADE_SYNC_UNMATCHED
│   ├── manual.log          # TRADE_MANUAL_EDIT, TRADE_PLAN_SAVED, TRADE_PROMOTED
│   ├── broker_pull.log     # BROKER_PULL_STALE_REJECT, BROKER_PULL_RETRY_REJECT
│   ├── fanout.log          # SIGNAL_FANOUT, DIRECT_TRADE_CREATE, FANOUT_COMPLETED, FANOUT_FAILED, FANOUT_SKIPPED_ONLY_SIGNAL
│   ├── signal.log          # SIGNAL_EA_ACK, SIGNAL_EA_REQUEUE, SIGNAL_MANUAL_CANCEL, SIGNAL_TRADE_PLAN_SAVED, SIGNAL_CREATE_TRADE, SIGNAL_EA_ACK_*
│   ├── trade_filled.log    # TRADE_FILLED
│   ├── trade_closed.log    # TRADE_CLOSED, TRADE_CLOSE
│   ├── sl_changed.log      # SL_CHANGED
│   ├── partial_close.log   # PARTIAL_CLOSE
│   ├── trade_failed.log    # TRADE_FAILED
│   ├── ea_update.log       # EA→trade cross-log events (ea_to_trade)
│   ├── ai_analyze.log      # AI_ANALYZE_REQUEST, AI_ANALYZE_RESPONSE, AI_ANALYZE_ERROR, AI_ANALYSIS
│   ├── ai_api_call.log     # AI_API_CALL_REQUEST, AI_API_CALL_RESPONSE
│   ├── ai_response.log     # AI_RESPONSE
│   └── ai_auto_save.log    # AI_ANALYZE_AUTO_SAVE_SIGNAL, AI_ANALYZE_AUTO_SAVE_TRADE
│
├── cron/{cron_name}/
│   ├── snapshots.log       # cron_snapshot_item_done, cron_snapshot_completed, cron_snapshot_failed, CRON_SNAPSHOT
│   ├── ai_analysis.log     # CRON_AI_ANALYSIS
│   └── tasks.log           # TASK_FETCH
│
├── snapshots/
│   └── created.log         # snapshot_created, SNAPSHOT_CREATED
│
└── ui/
    └── direct.log          # UI_CREATE_TRADE_DIRECT, UI_DB_CREATE, UI_MANUAL_LOG
```

## Core Functions

### `fileLog(objectId, objectTable, metadata, userId)`
Primary write path. Called by all log producers.
1. Extracts event name from `metadata.event` or `metadata.event_type`
2. Looks up target file via `resolveLogFile()` → `EVENT_FILE_MAP`
3. Appends one line to the resolved `.log` file
4. Mirrors ERROR-level events to `system/error.log`

### `resolveLogFile(objectId, metadata)`
Returns relative path like `trades/ABC123/ai_analyze.log`.
- Looks up event name in `EVENT_FILE_MAP` to get `[sourceDir, fileName]`
- Prefix-matches dynamic events: `SIGNAL_EA_SYNC_*`, `SIGNAL_EA_ACK_*`, `cron_snapshot_*`
- Extracts sub-directory ID: `source_id`/`provider` for accounts, `cron_name` for cron, `trade_id`/`signal_id` for trades
- `snapshots/` and `ui/` are flat (no per-ID subdirectory)

### `EVENT_FILE_MAP`
Canonical mapping: event type → `[sourceDirectory, baseFileName]`. All routing logic lives here. Add new event types here when creating new log producers.

### `mt5Log(objectId, objectTable, metadata, userId)`
EA-side entry point. Routes to `NotificationManager` for SSE + `fileLog` for disk. Also cross-logs to trade folder when `signal_id`/`trade_id` in metadata.

### `parseLogLine(line)`
Parses flat-file line back to structured object for `/mt5/api/events` API. Format-aware: `[ISO] LEVEL EVENT key=val...`

## API: `/mt5/api/events`
Reads all `.log` files recursively under `SERVER_LOG_DIR`. Supports filters: `q`, `type` (source dir), `symbol`, `range`, `limit`, `offset`.

## Rules for Adding New Log Events

1. **Pick an event type name** — `UPPER_SNAKE_CASE`, unique, descriptive
2. **Add to `EVENT_FILE_MAP`** in `server.js` — choose the right source dir and file name
3. **Call `fileLog()` or `backendLog()`** with `metadata.event` set to your event type
4. **Include relevant IDs** in metadata: `account_id` for account events, `signal_id`/`trade_id` for trade events, `cron_name` for cron events
5. **Use `metadata.error`** (truthy) for ERROR-level events — they automatically mirror to `system/error.log`
6. **Trade artifacts** (`payload.json`, `response.json`, `ai_response.json`, snapshots, bars) stay at `TRADE_FILES_DIR/trades/{sid}/logs/` — never in `SERVER_LOG_DIR`

## Trade Artifacts (Separate from Logs)

These remain at `TRADE_FILES_DIR/trades/{sid}/logs/`:
- `payload.json` — AI request payload
- `response.json` — AI raw + parsed response
- `ai_response.json` — Clean AI JSON (trade plan)
- Chart snapshots (PNG files)
- OHLC bars data
