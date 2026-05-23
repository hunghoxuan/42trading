# BROKER-CLIENT: EA Push OHLC Bars to Server

**Ticket ID**: `BROKER-BARS-001`
**Status**: DONE
**Tags**: `FEATURE`
**Created**: 2026-05-23
**Agent**: DeepSeek
**Note**: cTrader is the primary bridge broker. MT5 implementation also exists.

## Scope

Extend MT5 EA (`TVBridgeEA.mq5`) to push OHLC bars to webhook server after each candle close.

## What

1. In `OnTimer()` or after trade sync, call `CopyRates(symbol, tf, 0, 1)` for each tracked symbol+TF to get the latest closed candle
2. Build payload and POST to new endpoint `/v2/broker/bars`
3. Only send when a new candle closes (track last bar time per symbol+TF)

## Payload

```json
{
  "source_id": "MT5",
  "account_id": "12345",
  "bars": [
    { "s": "EURUSD", "tf": "15", "t": 1712345678, "o": 1.0500, "h": 1.0505, "l": 1.0495, "c": 1.0502, "v": 1234 }
  ]
}
```

## Implementation Notes

- `TF_PushBarsSeconds` input param — how often to check (default 30s)
- `InpEnableBarPush` input param — ON/OFF toggle
- MQL5 `CopyRates()` returns `MqlRates[]` with `time, open, high, low, close, tick_volume, spread, real_volume`
- Track `g_lastBarTime[symbol][tf]` to detect new candle close
- Send via `HttpPostJson(BuildApiUrl("/v2/broker/bars"), body)`
- Limit to max 10 bars per push (catch up if missed)

## Files

- `bridge-clients/TVBridgeEA.mq5`
