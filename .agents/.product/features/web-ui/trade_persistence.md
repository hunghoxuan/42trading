# Feature: Trade Persistence & Metadata

## User Flow
Ensures that all trade attempts, including rejections, are permanently stored in the database so users never lose context of why a trade didn't execute.

## Key Capabilities
- **Raw Analysis Capture**: Stores the full AI JSON in a dedicated `raw_json` column.
- **Resilient Linking**: Maps MT5 ticket IDs back to internal trade and signal IDs.
- **Fail-Safe Logging**: Logs `TRADE_ACK_FAILED` if a broker update arrives for a missing record.

## Implementation Details
- **Schema**: `trades` table with `metadata` and `raw_json` JSONB columns.
- **Logic**: Handled in `webhook/server.js` within `mt5FanoutSignalTradeV2` and `mt5AckTradeV2`.
