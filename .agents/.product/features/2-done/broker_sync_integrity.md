# Broker Trade Synchronization & Integrity

Status: Done
Type: Core Reliability
Date: 2026-05-05

## Problem Statement
Active broker trades were being erroneously marked as `CLOSED` in the dashboard. This was caused by:
1.  **Aggressive Status Inference**: The system assumed any trade reported as `CLOSED` by the broker should be immediately updated in the DB, even if the record was previously active.
2.  **Matching Gaps**: Trades matched by alphanumeric SID (comment) were not properly reopening if they were stuck in a `CLOSED` state in the DB.
3.  **Missing Audit Logs**: Critical sync updates were being filtered out by log level settings.

## Implementation Details

### 1. Robust Status Transitions
Modified `brokerSyncV2` logic to strictly control status moves:
-   **Reopening Protection**: If a trade is `CLOSED`/`CANCELLED` in the DB but the broker reports it as `OPEN`, the system now reopens it.
-   **Match by SID**: Added explicit `sid` matching to the primary update query to ensure trades matched by the broker comment are updated correctly.

### 2. SID Standardization
-   **9-Character SIDs**: Enforced a strictly compliant 9-character alphanumeric standard for all new signals and trade renewals.
-   **Prefix-Free**: Removed legacy dot-extensions and prefixes that caused record corruption.

### 3. Critical Audit Logging
-   **Bypass Filters**: Critical event categories (`TRADE_`, `SIGNAL_`, `ACCOUNT_`, `SYNC_`) now bypass the `LOG_ENABLED_PREFIXES` constraint.
-   **Sync Tracking**: Enabled `TRADE_SYNC_UPDATE` logs to track every state transition during broker polls.

## Verification
-   Verified trade `TEL05JKO7` was successfully reopened from `CLOSED` to `OPEN` after broker poll.
-   Confirmed `brokerSyncV2` matches correctly via both numeric ticket and alphanumeric SID.
-   Verified new signal generation produces 9-character SIDs.

## Technical Context
-   **Service**: `webhook`
-   **Backend**: `PostgresBackend.brokerSyncV2`
-   **Primary Key**: `trades.sid`
