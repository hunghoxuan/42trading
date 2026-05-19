# Feature: cTrader Symbol Metrics Synchronization

## Overview
Enable the cTrader bridge to proactively sync critical symbol metadata (Pip Value, Spread, Volume limits) to the backend. This data is essential for accurate risk calculation and position sizing on the web dashboard.

## 1. Objective
Currently, the "Size Calculator" relies on static or manual inputs for symbol properties. By syncing these directly from the cTrader broker, we ensure:
- **Accurate RR/PnL Projection**: Using real-time `PipValue`.
- **Validation**: Enforcing `MinVolume` and `VolumeStep` before sending orders.
- **Spread Awareness**: Displaying current broker spreads to the user.

## 2. Metrics to Sync
For each watched symbol, the bridge will send:
- `PipValue`: The value of 1 pip in the account currency.
- `Spread`: Current bid/ask difference in pips.
- `MinVolume`: Minimum allowed lot size.
- `MaxVolume`: Maximum allowed lot size.
- `VolumeStep`: Incremental lot size step (e.g., 0.01).
- `TickSize`: Minimum price movement.
- `Digits`: Price precision.

## 3. Data Flow
1. **cTrader Bridge**: Collects `Symbol` object properties.
2. **Webhook API**: Receives metrics via `POST /webhook/v2/broker/sync`.
3. **Database**: Updates `user_accounts.metadata` with a `symbol_metrics` map.
4. **Web UI**: `SizeCalculator` reads from account metadata to compute lot sizes.

## 4. Documentation Strategy
- Link to [../architecture/db-schema.md] for account metadata structure.
- Add to [../tickets/feature_tracker.md] as a completed feature upon success.
