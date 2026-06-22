# Ticket: Drop signals table, remove signals UI/routes, add Draft status, +Signal saves Draft trade

## Meta
- Ticket Type: `Refactor`
- Ticket Status: `Done`
- Owner: `DeepSeek`
- Updated: `2026-05-19 09:30 UTC`
- Commit: `b6265f62`

## Summary
Drop the `signals` table and all associated UI pages, menu entries, and API routes. Replace the `+ Signal` button with a "Save as Draft" flow that creates a Trade row with `execution_status = 'Draft'`. Add a `[+ Trade]` button on Draft trades in Trade Detail to promote to `'PENDING'`. Broker POLL must never pick up Draft-status trades.

## Changes

### DB
- Drop `signals` table (or leave unused — prefer drop for cleanup)
- Add `'Draft'` to `trades.execution_status` CHECK constraint

### Backend (`webhook/server.js`)
- All `/v2/signals/*` routes → removed
- `mt5PullLeasedTradesV2` / POLL → exclude `execution_status = 'Draft'`
- `POST /v2/trades/create` → allow creating with `status = 'Draft'`
- `POST /v2/trades/{id}/promote` → new route: Draft → PENDING
- Signal-related helper functions → remove or deprecate

### UI (`src/ui/src/`)
- `SignalsPage.jsx` → deleted
- `SignalDetailPage.jsx` → deleted
- Menu/nav references to Signals → removed
- Routes `/signals`, `/signal/:id` → removed from router
- `TradePlanEditor.jsx`: `+ Signal` button → `+ Draft` / `Save Draft` button, saves trade with `status: 'Draft'`
- `V2TradeDetailPage.jsx`: when `execution_status === 'Draft'`, show `[+ Trade]` button → calls promote endpoint

### API (`src/ui/src/api.js`)
- Signal API functions → removed
- `createDraftTrade` → new
- `promoteDraftTrade` → new

## Non-Goals
- Do not change trade table columns
- Do not change broker sync/ack logic beyond POLL exclusion
- Do not touch cTrader/EA bridge code

## Verification
- [ ] `node --check webhook/server.js`
- [ ] `npm run build` (src/ui)
- [ ] `/health` returns ok
- [ ] Broker POLL excludes Draft trades
- [ ] `+ Draft` creates trade row with status `'Draft'`
- [ ] `[+ Trade]` promotes Draft → PENDING
- [ ] No signals menu/page accessible
- [ ] No signal API routes respond
