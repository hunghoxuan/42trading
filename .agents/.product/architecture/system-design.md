# MT5 Product

## Goal
- Multi-user trade journal.
- MT5 execution monitor.
- Backward-compatible EA polling.
- Low-ops deploy.

## Runtime
- Backend: `webhook/server.js`.
- UI: `src/ui`.
- Broker clients: `bridge-clients`.
- DB: Postgres.

## Stable Contracts
- Keep legacy EA endpoints stable during migration:
  - `/mt5/ea/pull`
  - `/mt5/ea/ack`
- UI read APIs live under MT5/V2 routes.
- Polling is acceptable unless realtime is explicitly required.
- Secrets stay in env/config, not source.

## Product Rules
- Signals are reference feed.
- Trades are account execution ledger.
- Accounts hold broker/account state.
- Account heartbeat should upsert account financial state.
- UI auth and machine auth are separate concerns.

## TradingView Emit Contract
- Final outbound webhook emit is realtime-only.
- Processing gate and emission gate stay separate.
- No historical/backfill webhook push on reload, symbol switch, or timeframe switch.
- Payload must preserve:
  - `chartTf`: alert chart timeframe.
  - `sourceTf`/HTF: model context timeframe.

## UI Form Rules
- Do not edit generated IDs in forms.
- Hide generated IDs on create.
- Show IDs read-only only when useful.
- Status/state fields use selects, not free text.
- Create toggle opens/closes form.
- Submit button performs write.
- Hide pagination controls when only one page exists.
- Grid actions prefer icon-only buttons.
- Detail/forms can use icon + text.
