# Feature: Advanced Order Entry

## Overview
Provide a professional-grade manual order entry system that integrates real-time position sizing, risk management, and multi-parameter trade planning.

## 1. Objective
Enable users to execute trades with high precision directly from the web dashboard. This eliminates the need for external calculators and ensures that every manual trade follows the system's risk-management rules.

## 2. Key Features
- **Integrated Sizing**: Automatically calculate lots based on SL distance and Risk ($ or %).
- **Live Metric Feedback**: Show real-time broker spread and pip value during order entry.
- **Trade Plan Integration**: Support for "Strategic Notes" and RR-based TP calculation.
- **Validation**: Enforce broker-specific volume steps and minimums before dispatching.
- **Execution Workflow**: Sends a "MANUAL" signal to the backend, which is immediately picked up by the bridge for execution.

## 3. UI/UX Design
- **Header**: Symbol and Side (Buy/Sell) selector.
- **Body**: 
    - Risk Input ($ or %).
    - Entry, SL, TP (with RR-auto-calc).
    - Strategic Note.
- **Footer**: "Place [SIDE] Order" button with confirmation of calculated risk/volume.

## 4. Technical Flow
1. User enters parameters in `AdvancedOrderPanel`.
2. Component calculates `units` and `lots` using live `symbol_metrics`.
3. User clicks "Place Order".
4. Dashboard sends `POST /api/signals` with `source: MANUAL`.
5. Bridge polls the signal and executes the trade on cTrader.
