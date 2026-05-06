# Ticket: Implement cTrader Symbol Metrics Sync

## Summary
Update the cTrader Automate bridge to send symbol-specific metadata to the webhook for use in the dashboard size calculator.

## Tasks
- [ ] **cTrader Bridge**:
    - Add `SendSymbolMetrics()` method.
    - Map `Symbol.PipValue`, `Symbol.Spread`, `Symbol.VolumeMin`, etc.
    - Trigger on `OnStart` and every 5 minutes.
- [ ] **Backend (Webhook)**:
    - Update `POST /v2/broker/sync` handler.
    - Extract `symbol_metrics` from the request body.
    - Merge into `user_accounts.metadata`.
- [ ] **Frontend (Web UI)**:
    - Update `SizeCalculator.jsx` to use metrics from `selectedAccount.metadata.symbol_metrics`.

## Constraints
- Must handle 9-character SIDs for accounts.
- Must be non-blocking in the cTrader bridge.
- Must handle `null` values gracefully if a symbol is not yet loaded on the bridge.

## Related
- Feature: [../features/1-plan/ctrader_symbol_metrics_sync.md]
