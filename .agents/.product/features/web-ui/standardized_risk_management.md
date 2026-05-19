# Standardized Risk Management (v1.0)

## Overview
This feature standardizes risk management infrastructure by transitioning from volume-based (lots) sizing to explicit risk-based (percentage/money) metrics. This ensures consistent risk exposure across different symbols and account sizes.

## Core Metrics
The following metrics are now the "Source of Truth" for trade sizing and risk assessment:
- **`risk_pct_planned`**: The percentage of account balance to risk on the trade (e.g., `0.01` for 1%).
- **`risk_money_planned`**: The fixed monetary amount to risk on the trade (e.g., `$100`).
- **`rr_planned`**: The target Risk/Reward ratio for the trade plan.

## System-Wide Changes

### 1. Database Schema
- **`signals` table**: Added explicit columns for risk (`risk_pct_planned`, `risk_money_planned`, `rr_planned`) and logic metadata (`strategy`, `profile`, `confidence_pct`, `estimated_bars`, `be_trigger`).
- **`trades` table**: Matches `signals` table with explicit columns for risk and logic metadata.
- **Hybrid Schema Rule**: Only numeric, boolean, or filter/enum logic fields are kept as explicit columns. Long text fields (e.g., `invalidation`, `exit_condition`) are dropped and persist only in `raw_json` or `metadata`.

### 2. Backend Normalization (`server.js`)
- `mt5EnqueueSignalFromPayload`: Normalizes incoming payloads by checking for multiple risk aliases:
  - `risk_pct`, `riskPct`, `volume_pct`, `volumePct`, `risk_pct_planned`.
  - `risk_money`, `riskMoney`, `risk_money_planned`.
- `mt5FanoutSignalTradeV2`: Ensures these standardized columns are populated during signal creation.

### 3. UI/UX Standards
- **Risk Visibility**: Risk percentage is surfaced in:
  - `SignalDetailCard` header (e.g., `Risk: 1.00%`).
  - `PositionAuditCell` in list views.
  - `TradePlanEditor` summary and edit modes.
- **Input Fields**: The `TradePlanEditor` and "Create" forms now explicitly include "Risk (%)" and "Risk ($)" inputs.
- **Calculations**: RR and PnL projections in the UI now prioritize these explicit risk metrics over estimated volumes.

### 4. Integration Guidelines
- **Always use `risk_pct_planned`** as the primary risk anchor.
- **Volume (Lots)** is a secondary metric calculated based on risk and stop loss distance.
- **Broker Sync**: Future broker bridge updates must interpret `volume` as `risk_pct` when configured, or consume the explicit `risk_pct` field from the trade metadata.

## Lessons Learned
- Relying on `volume` (lots) causes inconsistency across symbols with different lot sizes (e.g., XAUUSD vs BTCUSD).
- Normalizing risk percentage at the signal ingestion layer prevents downstream calculation errors.
- Visual badges for risk percentage significantly improve operational transparency.
