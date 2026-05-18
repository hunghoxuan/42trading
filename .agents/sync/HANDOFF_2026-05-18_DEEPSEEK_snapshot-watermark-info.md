# Handoff: Deepseek — Snapshot Watermark + Info/Data Preservation

## Header
- From agent: codex-gpt5
- To agent: Deepseek
- Ticket: `2026-05-18-snapshot-watermark-trade-info-preservation.md`
- Timestamp: 2026-05-18 12:30 UTC

## Status
- NEEDS_REVIEW

## Read First
1. `AI.md`
2. `.agents/BOOTSTRAP.md`
3. `.agents/rules/deploy.md`
4. `.agents/.product/tickets/1-backlog/2026-05-18-snapshot-watermark-trade-info-preservation.md`

## Problem Statement
User still sees:
- no visible `symbol + time` overlay in snapshot image (MASTER grid screenshot)
- empty `Info` tab in trade detail for some trades
- lost nested analysis fields after parse/store to DB

User provided concrete XAUUSD payloads proving rich raw AI data exists but reduced saved JSON loses structure.

## Current Behavior Clarification
- Analyze mode `[S]` stores global snapshots in:
  - `webhook/snapshots/`
- Trade detail mode `[S]` is intended to also copy into:
  - `webhook/trade_files/trade-<sid>/snapshots/`

Need to verify this path in runtime and persist references reliably.

## Implementation Targets
- `webhook/server.js`
  - Snapshot routes and capture overlay
  - Trade raw payload persistence
  - Trade snapshot copy + metadata persistence
- `web-ui/src/hooks/useChartTileData.js`
- `web-ui/src/components/charts/SymbolChart.jsx`
- `web-ui/src/components/SignalDetailCard.jsx`
- `web-ui/src/pages/trades/V2TradeDetailPage.jsx`
- `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`

## Required Output
1. Fix watermark visibility in final saved images (single + MASTER grid).
2. Ensure Info tab always renders meaningful JSON blocks when object data exists.
3. Preserve full nested AI analysis structure in DB raw JSON.
4. Confirm snapshot storage semantics for analyze mode vs trade mode.

## Validation Commands
- `rtk bash scripts/deploy/check_build_versions.sh origin/main`
- `rtk bash scripts/deploy/deploy_webhook.sh`
- `rtk curl -sS --max-time 20 https://trade.mozasolution.com/health`
- `rtk ssh root@139.59.211.192 "pm2 logs webhook --lines 120 --nostream | tail -n 120"`

## Return Format (to user)
- Checklist:
  - changed
  - tested
  - deployed (version)
  - verification evidence
  - residual risk
