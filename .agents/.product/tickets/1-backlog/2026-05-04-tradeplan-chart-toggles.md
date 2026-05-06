# Ticket: TradePlan Chart Toggles

## Meta
- ID: `FEAT-20260504-TRADEPLAN-TOGGLES`
- Status: `BACKLOG`
- Priority: `P2`
- Requested by: `User`
- Implementer: `Deepseek`

## Problem
After Claude analysis, the TradePlan tab shows charts with TradeSignalChart. No way to control which overlays (Trade Plan lines, PD Arrays, Key Levels) are displayed.

## Solution
Add toggle checkboxes in TradePlan tab header:

```
☑ Trade Plan 1   ☐ Trade Plan 2   ☐ PD Arrays   ☐ Key Levels
```

- **Trade Plan 1/2**: Show/hide entry/SL/TP lines
- **PD Arrays**: Gray thin zone lines
- **Key Levels**: White thin price lines
- **Default**: Only selected Trade Plan checked

## Files
- `ChartTile.jsx` — toggle state + checkboxes
- `SignalDetailCard.jsx` — pass analysis data
- `TradeSignalChart.jsx` — conditional rendering
