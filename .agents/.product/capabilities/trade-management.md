# Feature: Broker-Side Trade Management (The Hand)

## Overview
This feature implements high-frequency trade management logic directly on the client broker terminals (MT5 and cTrader). By executing logic on the client-side, we eliminate latency and connectivity risks that could impact critical modifications like Trailing Stops and Break-Even adjustments.

## Core Capabilities

### 1. Break-Even (BE)
*   **Description**: Automatically moves the Stop Loss to the entry price (plus an optional offset) once a specific profit threshold is reached.
*   **Trigger**: `BE Trigger (Pips)` - The minimum profit in pips required to activate BE.
*   **Offset**: `BE Offset (Pips)` - Additional pips added to the entry price to cover commissions or secure a small profit.
*   **Safety**: Only moves the SL forward; it will never move an SL back into a higher risk position.

### 2. Trailing Stop (Trail)
*   **Description**: Continuously adjusts the Stop Loss to follow the current price at a fixed distance as profit increases.
*   **Start**: `Trail Start (Pips)` - The profit level where the trail begins.
*   **Step**: `Trail Step (Pips)` - The minimum price movement required before the SL is modified again (reduces excessive broker requests).

### 3. Automated Partial Take-Profits (Partial TP)
*   **Description**: Automatically closes a percentage of the position at pre-defined price levels.
*   **Source**: Derived from the original trade plan's `partial_tps` metadata (via VPS `raw_json`).
*   **Execution**: Uses native broker calls (`ClosePartial` / `CloseVolume`) to ensure precise scaling out without splitting orders.
*   **Tracking**: Managed in-memory to prevent duplicate executions across terminal restarts (within a single session).

## Implementation Details

### MT5 EA (`TVBridgeEA.mq5`)
*   **Hook**: `OnTick()` - Executes on every price change.
*   **Selection**: `InpMgtStrategy` (None, BE, Trail, Both).
*   **Build**: `v2026.05.07 17:00 - mgt-hand-v2`

### cTrader Bridge (`TVBridge_CTrader.cs`)
*   **Hook**: `OnTick()` - High-frequency monitoring.
*   **Selection**: `SelectedStrategy` (None, BreakEven, TrailingStop, Both).
*   **Build**: `v2026.05.07 17:00 - mgt-hand-v2`

## Operational Logic
1.  **RAM Storage**: The management parameters are stored in the terminal's local memory for instant access.
2.  **Filtering**: The "Hand" only manages positions that match the EA's `Magic Number` (MT5) or the bridge's `Label/Comment` (cTrader).
3.  **Independence**: Once the parameters are set, the "Hand" works even if the connection to the VPS is temporarily lost.

## Future Roadmap (The Brain)
*   **Dynamic Metadata**: Upcoming sync updates will allow the VPS to dynamically push these parameters into the "Hand" on a per-trade basis via JSON.
