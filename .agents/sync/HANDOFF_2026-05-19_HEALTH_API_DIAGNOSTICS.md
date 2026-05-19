# Handoff: Health API diagnostics consolidation

## Read
- `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/1-backlog/done-update-feature-health-api-diagnostics-consolidation.md`
- `/Users/macmini/Trade/Bot/trading/webhook/server.js`

## What changed
- `/health` now includes:
  - local/public root HTML checks
  - cron runtime + config diagnostics
  - related endpoint summary (`/mt5/health`, dashboard diagnostics endpoints)

## Verify
- Hit `/health` and inspect `diagnostics`.
- Confirm `diagnostics.root_checks.public_trade_mozasolution_com.mode`.
- Confirm `diagnostics.cron.configs` values are present.

