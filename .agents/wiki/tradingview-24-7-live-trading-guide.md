# TradingView 24/7 Alert + Live Trading Guide

Last updated: 2026-04-09

## Goal
Run TradingView signals 24/7 and execute real trades on:
- Binance account
- ICMarkets account

---

## Why TradingView Alerts Can Run 24/7 (No Laptop Needed)

When you create an alert in TradingView, the alert logic is executed on TradingView infrastructure (their cloud servers), not on your local browser tab or your laptop CPU.

That means:
- You can close your laptop.
- You can shut down your local machine.
- Alert checking still continues as long as:
  - alert is active (not expired/disabled),
  - your plan supports the alert type/quantity you are using,
  - script/symbol/timeframe remains valid.

Important clarifications:
- Your Pine script does not need to be running in an open chart tab for server-side alerts to work.
- What must stay online 24/7 is your execution endpoint (webhook receiver), not your laptop.
- If TradingView sends a webhook but your receiver is down, the trade signal is lost unless you design a retry/reconcile mechanism on your side.

---

## Cost-Effective Architecture

1. TradingView = Signal engine (alert generation)
2. VPS service = Execution engine (receive webhook + send order)
3. Broker exchange adapters:
   - Binance adapter (REST + WebSocket)
   - ICMarkets adapter (MT5 EA bridge or cTrader bridge)
4. Risk engine shared by both (daily limit, max open positions, kill switch)

Flow:

TradingView Alert -> Webhook `/tv` -> Validate secret/idempotency -> Risk checks -> Place order -> Log + Telegram

---

## Practical Setup

### 1) TradingView (24/7 signal side)
- Build stable alert conditions in your indicator/strategy.
- Use `alert()` or strategy alert message payload.
- Create alerts with webhook URL to your VPS endpoint.
- Use unique signal id in payload for deduplication.

Example payload:

```json
{
  "passphrase": "YOUR_SECRET",
  "exchange": "binance",
  "symbol": "BTCUSDT",
  "side": "BUY",
  "type": "MARKET",
  "qty": "0.01",
  "sl": "62000",
  "tp": "64500",
  "id": "{{ticker}}-{{time}}-buy"
}
```

### 2) VPS (24/7 execution side)
- Linux VPS for webhook + Binance executor.
- If using MT5 for ICMarkets, add Windows VPS for MT5 terminal + EA.
- Keep endpoint latency low and return fast HTTP success.

### 3) Binance live execution
- Use API key with minimum permissions only.
- Enable IP whitelist.
- Implement:
  - order placement,
  - position/order reconciliation,
  - retries for rate limits/network issues,
  - hard risk limits.

### 4) ICMarkets live execution
- Most practical low-cost routes:
  - MT5 Expert Advisor (very common),
  - cTrader cBot/Open API.
- Receiver forwards normalized signal to the MT5/cTrader execution layer.

---

## Reliability Checklist (Must Have)

1. Idempotency key (`id`) to prevent duplicate orders.
2. Kill switch to stop all trading instantly.
3. Risk caps: per-trade, per-day, max concurrent positions.
4. Health checks: endpoint uptime + broker connectivity.
5. Journal everything: signal, decision, order request/response, fill status.
6. Alerts on failure (Telegram/Slack/email).

---

## Common Failure Cases

1. Alert expired in TradingView.
2. Webhook URL invalid or endpoint down.
3. Endpoint response too slow.
4. No deduplication, causing duplicate entries.
5. No reconciliation loop after temporary broker/API failure.
6. No risk kill switch.

---

## Suggested Rollout Plan

1. Demo/testnet 1-2 weeks.
2. Very small live size.
3. Verify slippage/fill behavior and risk controls.
4. Scale gradually only after stable logs and low incident rate.

