# cTrader Bridge Features (TVBridge_CTrader.cs)

This document outlines the current capabilities and architectural features of the cTrader bridge client.

## Core Connectivity
- **Polling Loop**: Continuously polls the VPS `/v2/broker/pull` endpoint for new trade signals (Market, Limit, Stop).
- **Polling Frequency**: User-configurable via parameters (default 2s).
- **Authentication**: Uses `EaApiKey` for all requests.
- **Lease Token Support**: Handles signal-specific lease tokens to prevent double-execution and ensure atomicity.

## Trade Execution
- **Order Types**:
    - `market`: Executes immediate market orders.
    - `limit`: Places limit orders at a specific entry price.
    - `stop`: Places stop orders at a specific entry price.
- **Risk Sizing**: 
    - Supports fixed-money risk sizing (Max Risk $).
    - Calculates lot size based on distance between Entry and Stop Loss.
    - Falls back to `Max Volume %` cap if calculated volume exceeds safety limits.
- **Smart Labeling**: Generates labels using `{SourceID}_{EntryModel}` for advanced dashboard auditing.
- **Error Handling**: Gracefully handles broker errors (insufficient margin, invalid volume) and reports them back to the VPS.

## VPS Synchronization (sync-v2)
- **Account Metrics**:
    - Balance, Equity, Margin, Free Margin.
    - Leverage, Broker Name.
- **Live Positions**:
    - Syncs `signal_id` (SID) from comment/label.
    - Volume (Units) and Lots.
    - PnL (Net), Pips, Commission, Swap.
    - Margin usage.
    - Current SL/TP prices.
- **Pending Orders**:
    - Syncs active limit/stop orders.
    - Target price, SL, TP, and Volume.
- **Closed Deals History**:
    - Scans recent history for closed positions.
    - Syncs realized PnL, Pips, Commission, Swap.
    - Identifies closure reason (TP, SL, Manual).
- **Symbol Metrics**:
    - Syncs tick-level data for active symbols: Pip Value, Spread, Min Volume, Step Volume, Digits.

## Telemetry & Acknowledgement (ack)
- **Execution Feedback**: Sends detailed `Ack` messages after each trade operation.
- **Telemetry Fields**:
    - `execution_status`: OPEN, PENDING, ERROR.
    - `broker_trade_id`: The platform's internal ticket ID.
    - `entry_exec`: The actual fill price (for market) or target price (for pending).
- **Duplicate Prevention**: Uses a local `HashSet` to ensure no signal is processed twice within a session.
- **Immediate SL/Partial Ack**: SL changes (BE/Trail) and partial closes fire immediate `AckAsync` to VPS. See `broker_sync_audit.md`.

## Live Price Streaming
- Pushes real-time bid/ask for tracked symbols to VPS on configurable timer.
- See: `broker_price_stream.md` for full architecture.

## UI & Debugging
- **On-Chart Panel**: Displays real-time status of:
    - Server connectivity.
    - API authentication status.
    - Polling and Sync health.
    - Last error messages and signal history.
