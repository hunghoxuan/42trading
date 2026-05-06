# Feature: System Logging & Audit

## User Flow
Users can track every stage of a trade or signal lifecycle via the "History" and "Analysis" tabs in the Dashboard.

## Key Capabilities
- **Execution Tracking**: Every MT5 response is logged as `TRADE_ACK` with specific broker return codes.
- **AI Audit**: Full raw JSON from AI analysis is captured and viewable.
- **Auto-Sync Logs**: Background reconciliation events (price updates, closes) are logged automatically.

## Technical Event Types
- `SIGNAL_FANOUT`: Signal distribution start.
- `TRADE_ACK`: Success/Rejection feedback from MT5.
- `ACCOUNT_SYNC`: Balance/Equity updates.
- `TRADE_SYNC_CLOSE`: Auto-detection of trade closure.
- `AI_RESPONSE`: Captured AI signal data.

## Implementation Details
- **Storage**: `logs` table (JSONB metadata).
- **Triggers**: MT5 EA polling and Webhook AI generation.
- **Canonical Row Shape**: Logs API responses expose `log_id`, `object_id`, `object_table`, `created_at`, and `metadata`, while keeping legacy aliases for existing UI flows.
- **AI Audit Note**: Production `object_table='ai'` rows inspected on 2026-05-06 contained `AI_ANALYSIS` and `AI_RESPONSE`; no live `AI_ANALYZE_*` rows were present in the latest window.
