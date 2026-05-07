# Feature: High-Density Trade UI Refinements

## User Flow
Optimized signal and trade detail interfaces for professional high-density information retrieval and operational speed.

## Key Capabilities
- **Consolidated Metadata**: Merged Metadata JSON directly into the Account section to eliminate redundant headers and scrolling.
- **Strategic Header Removal**: Removed explicit "ACCOUNT" and "SOURCE" card headers for a cleaner, unified UI.
- **Priority Metadata Mapping**: Standardized Trades and Signals pages to show Source and SID as primary identification fields.
- **Intelligent Navigation**: Auto-selection of the "Live" tab when TradePlan data is unavailable, reducing workflow friction.
- **Reversed Timeframes**: Reordered Timeframe pills (D to 1m) for faster top-down navigation.
- **Global Density Master Controls**: Added "+" and "-" master buttons to adjust chart column count across all symbols simultaneously.
- **Responsive Charting**: Precision canvas scaling using ResizeObserver to ensure 100% width/height container alignment.
- **ReferenceError Hardening**: Signal/trade/AI browser detail flows lazy-load heavy chart/detail modules so shared pages avoid module-initialization-order crashes during bundle evaluation.

## Technical Details
- **Frontend**: 
  - `SignalDetailCard.jsx`: Refactored Info tab layout and tab selection logic.
  - `SignalDetailCard.jsx`, `SignalsPage.jsx`, `SignalDetailPage.jsx`, `TradesPage.jsx`, `V2TradeDetailPage.jsx`, `ChartSnapshotsPage.jsx`: Use `React.lazy` + Suspense for detail/card loading stability.
  - `SymbolChart.jsx`: Extracted chart tile component for clearer module boundaries and safer lazy loading.
  - `TradeSignalChart.jsx`: Integrated ResizeObserver for dynamic canvas scaling.
  - `TradesPage.jsx` & `SignalsPage.jsx`: Reordered metaItems for information priority.
- **Build Version**: `v2026.05.06 19:12 - c3e392e`
