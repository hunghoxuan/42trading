# Feature: High-Density Trade UI Refinements

## User Flow
Optimized signal and trade detail interfaces for professional high-density information retrieval and operational speed.

## Key Capabilities
- **Consolidated Metadata**: Merged Metadata JSON directly into the Account section to eliminate redundant headers and scrolling.
- **Strategic Header Removal**: Removed explicit "ACCOUNT" and "SOURCE" card headers for a cleaner, unified UI.
- **Priority Metadata Mapping**: Standardized Trades and Signals pages to show Source and SID as primary identification fields.
- **Intelligent Navigation**: Auto-selection of the "Live" tab when TradePlan data is unavailable, reducing workflow friction.
- **Responsive Charting**: Precision canvas scaling using ResizeObserver to ensure 100% width/height container alignment.

## Technical Details
- **Frontend**: 
  - `SignalDetailCard.jsx`: Refactored Info tab layout and tab selection logic.
  - `ChartTile.jsx`: Implemented auto-mode switching for empty plans.
  - `TradeSignalChart.jsx`: Integrated ResizeObserver for dynamic canvas scaling.
  - `TradesPage.jsx` & `SignalsPage.jsx`: Reordered metaItems for information priority.
- **Build Version**: `v2026.05.06 16:36 - 1d04ded`
