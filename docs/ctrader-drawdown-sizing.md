# Drawdown risk sizing (v167)

`Adaptive Risk & Direction → Risk Sizing` has two drawdown choices. Both use the existing `Custom Rules → Max Drawdown` control; there is no second limit parameter.

| Risk Sizing choice | Reference | Loss allowance |
| --- | --- | --- |
| `AdaptiveReferenceDrawdown` (renamed from `AdaptiveDrawdown`) | Existing account/profile reference | Existing effective DD percentage × initial capital |
| `AdaptivePeakEquityDrawdown` (new) | Highest observed floating equity, with initial capital as the starting baseline | Effective DD percentage × peak equity |

Descriptions are **Adaptive Reference DD** and **Adaptive Peak Equity DD**. Native cTrader metadata uses the enum names shown above. The old choice retains numeric value 3; the new choice is appended as 4. Existing other choices and default `BalanceRecovery` (2) are unchanged. Textual presets containing the old name may require reselecting `AdaptiveReferenceDrawdown`. Select the new mode explicitly to change behavior.

Custom and Rules Profile No use the selected Max Drawdown. Named profiles keep their prescribed effective percentage, applied to peak equity for the new sizing mode. Custom dollar presets stay fixed dollar amounts in either mode.

## Formula and example

The existing scaling formula is retained:

```text
drawdown = max(0, reference − current equity)
factor = clamp(1 − drawdown / loss allowance, 0, 1)
pool = max(0, min(original total-risk budget × factor, loss allowance − drawdown))
new-trade risk = max(0, min(original Base Risk × factor, pool − committed risk))
```

Base Risk and the total-risk budget retain their existing initial-capital anchors. Existing committed exposure and mandatory daily/profile capacity can reduce the executable amount further.

With initial capital $10,000, Base Risk 0.2% ($20), total-risk budget 5% ($500), peak equity $20,000 and Max Drawdown 10%:

| Current equity | Peak DD | Allowance | Pool | New-trade risk before other reservations |
| --- | --- | --- | --- | --- |
| $20,000 | $0 | $2,000 | $500 | $20 |
| $19,000 | $1,000 | $2,000 | $250 | $10 |
| $18,000 | $2,000 | $2,000 | $0 | $0 |

The sizing floor is $18,000. A later $25,000 peak raises it to $22,500. Retracement does not lower the saved peak; equity recovery restores sizing up to the original budget.

This is a sizing mode. It sets new-trade risk to zero at its floor and does not add a rule that closes existing exposure or stops the instance. Existing Rules Profile breach/stop logic keeps its own references and limits. Rules Profile No skips those mandatory rules while retaining the selected sizing calculation. Existing positions, price gaps and costs can still carry equity through a sizing floor.

## Peak tracking

- Floating equity is observed on every cBot tick, including with Rules Profile No.
- Every backtest starts a fresh causal peak and ignores live stored peaks.
- Live peaks persist for the same cBot instance and broker/account. Writes are flushed at most every five seconds and on normal stop; a crash can lose the latest unflushed observations.
- First activation uses the equity observed since startup, initial-capital baseline and any saved instance peak. It cannot reconstruct peaks that occurred before tracking or while the instance was offline, and it does not synchronize peak storage between instances.
- Invalid/unavailable peak storage blocks new peak-based sizing without stopping tick processing or profile enforcement. It retries while preserving the observed in-memory peak.
- The risk dashboard displays the peak, sizing floor and used/allowed loss, including with Rules Profile No. Execution logs identify `PEAK_EQUITY_DD` or `REFERENCE_DD`.

## Verification

Full source synced to the active cTrader compile file and built as `v2026.10.19 - peak-equity-sizing-v167`, with zero errors and two existing CS0649 warnings. The active Release DLL passed 67 focused checks through `.local/causal-replay-check/Check.csproj --peak-equity-dd`, 58 existing checks through `--risk-sizing-only`, and the FTMO profile/projected-stop regression in `.local/ftmo-risk-check/Check.csproj`. These check formulas, execution allocation, saved enum values, shared parameter metadata, profile enforcement isolation, persistence errors/recovery and backtest isolation. Published `.algo` metadata confirms both choices and one unchanged Max Drawdown property. A full-period native market backtest is not part of this verification. Instance settings and running sessions were not changed.
