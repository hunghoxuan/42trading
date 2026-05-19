# Handoff: AI Analyze/Trade UX + Static Chart Actions + Close Snapshot + Object Persistence

## Read First
- `/Users/macmini/Trade/Bot/trading/AI.md`
- `/Users/macmini/Trade/Bot/trading/.agents/BOOTSTRAP.md`
- `/Users/macmini/Trade/Bot/trading/.agents/rules/handoff.md`
- `/Users/macmini/Trade/Bot/trading/.agents/rules/deploy.md` (if deploying)

## Tickets
1. `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/1-backlog/plan-update-feature-ai-analyze-trade-nav-and-quick-direction.md`
2. `/Users/macmini/Trade/Bot/trading/.agents/.product/tickets/1-backlog/plan-extend-feature-trade-ui-static-chart-close-snapshot-and-objects.md`

## Scope to Execute
- Split nav buttons:
  - `/ai/analyze` => `[< List]` and `[Trade]`
  - `/ai/trade` => `[< List]` and `[Analyze]`
- Quick action behavior:
  - Buy click => Direction=BUY + Entry=clicked price
  - Sell click => Direction=SELL + Entry=clicked price
- TradePlan editor layout:
  - no overlap for SL/RR/RR2 label/slider
  - add RR/RR2/RR3 sliders driving TP/TP2/TP3
  - remove `Strategic Note` label text
- Fix static/fixed chart control wiring
- Backend:
  - async snapshot on trade close
  - persist/reload chart objects in trade metadata

## Constraints
- Preserve existing TP compatibility fields (`tp`, `tp1`, `tp2`, `tp3`).
- Keep AI raw plan integrity in `raw_json`.
- If backend/UI/scripts touched, bump aligned versions per project rules.
- Follow multi-agent deploy lock before deploy.

## Required Checks
- `rtk npm --prefix web-ui run build`
- `rtk node --check webhook/server.js` (if backend touched)
- Any targeted tests added for object persistence/snapshot trigger

## Return Format
- root cause + implemented solution per ticket
- exact files changed
- checks run and result
- deploy status and deployed version

