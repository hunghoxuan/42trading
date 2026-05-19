# Feature: Market Data & Charting

## User Flow
Visualize live market conditions and feed accurate data into the AI Signal Engine.

## Key Capabilities
- **Multi-Source Ingestion**: Integration with TwelveData, Binance, and MT5 terminal feeds.
- **Unified Symbol Formatting**: Normalizes symbols across different providers (e.g., `BINANCE:BTCUSDT` -> `BTCUSD`).
- **Interactive Charts**: Lightweight Charts integration in the UI for technical analysis.
- **Symbol Suggestions**: Smart autocomplete for symbols based on the user's allowlist and active broker assets.

## Technical Details
- **Endpoints**: `/api/charts/multi`, `/mt5/filters/symbols`.
- **Frontend**: `TradingViewChart` and `SymbolSelector` components.
- **Caching**: Symbol lists and recent candle data are cached for performance.
