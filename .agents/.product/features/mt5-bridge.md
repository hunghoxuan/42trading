# MT5 bridge feature notes

## Naming
- `src/mt5-bridge-clients/`: external broker client assets
- `src/mt5-bridge-python/`: local Python adapter service

## Recommendation
Use `src/mt5-bridge-python` as an internal service behind Node, not as a replacement API surface.

## Why this is safer
- preserves current localhost:3000 behavior
- preserves frontend contracts
- preserves EA and cTrader contracts
- lets us add MT5-specific readiness and execution behavior gradually
