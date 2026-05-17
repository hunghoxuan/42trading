# Handoff — AI Browser UI / Analyze Flow

Date: 2026-05-08  
Owner: Codex

## Scope Completed

1. Unified Analyze panel for both states:
- no symbol selected
- symbol selected

2. Trade plan header/data fixes:
- RR uses `partial_tps[0].rr` first, fallback to recalculation from Entry/SL/TP1
- TP1 display prioritizes `partial_tps[0].price`
- header badges updated (`C:`, `R:` etc.)

3. Add-flow actions:
- after save/add: shows `Back` and `Signal added` / `Trade added`
- `Signal added` / `Trade added` navigates to detail pages

4. Chart behavior:
- TradePlan fetch/refresh path improved
- fallback warning path when bars unavailable

5. Latest requested compact layout pass:
- reduced spacing/padding/border weight in no-symbol analyze area
- symbol list should hide when a symbol is selected (guarded by `selectedSymbol = cfg.symbol || paramSymbol`)

## Main Files Changed

- `web-ui/src/pages/ai/ChartSnapshotsPage.jsx`
- `web-ui/src/components/SignalDetailCard.jsx`
- `web-ui/src/components/TradePlanEditor.jsx`
- `web-ui/src/components/charts/SymbolChart.jsx`
- `webhook/server.js` (version string bump only)
- `bridge-clients/TVBridgeEA.mq5` (build version bump only)

## Current Live Deploy

- Health endpoint OK on VPS after restart
- Reported live service version: `v2026.05.08 20:52 - 6ad8ef2`

## Known Issue / Risk

User reported UI still looked old after deploy on some checks.
Most likely causes:
- browser cached old JS bundle
- competing deploy overwrote `/opt/trading/web-ui/dist`

## Quick Verification Checklist

1. Open AI Browser with no symbol selected:
- compact header area
- right-side unified Analyze panel visible
- symbol grid visible

2. Select a symbol:
- symbol grid must disappear
- symbol-focused view/chart appears

3. Add Trade:
- action area shows `Back` + `Trade added`
- `Trade added` opens `/trades/:id`

4. RR check:
- TP/RR line reflects `partial_tps`-based TP1/RR behavior

## If Regression Reappears

1. Rebuild:
```bash
cd /Users/macmini/Trade/Bot/trading
rtk npm --prefix web-ui run build
```

2. Push dist to VPS:
```bash
rtk /bin/zsh -lc "cd /Users/macmini/Trade/Bot/trading/web-ui && tar -czf /tmp/web-ui-dist.tgz dist"
rtk scp /tmp/web-ui-dist.tgz root@139.59.211.192:/tmp/web-ui-dist.tgz
rtk ssh root@139.59.211.192 "tar -xzf /tmp/web-ui-dist.tgz -C /opt/trading/web-ui && pm2 restart webhook"
```

3. Verify:
```bash
rtk ssh root@139.59.211.192 "curl -k -sS --max-time 12 -i https://127.0.0.1:443/health | sed -n '1,60p'"
```

4. Force refresh browser:
- macOS: `Cmd + Shift + R`

