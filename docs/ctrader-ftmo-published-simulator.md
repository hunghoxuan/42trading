# FTMO published-rules simulator

The cTrader bridge writes a separate FTMO audit when **Rules Profile** is `FTMO_1Step`, `FTMO_2Step`, or `FTMO_Instant`. Other profiles do not run this audit. The audit reports observed compliance with published CFD objectives. It does not change the bot's existing protective 95% close and stop behavior, custom limits, or Auto sizing.

## Select the account

Set **FTMO Phase** to Challenge, Verification, or Account. Auto means Challenge for 1-Step and 2-Step, and Account for Instant. Set **FTMO Account Type** to Standard or Swing; Swing is valid only for 2-Step. Set **FTMO Consistency** to Current or LegacyBestDay when the account's order/merge date establishes which 1-Step rule applies. Unknown produces an unknown consistency result. Invalid phase and account-type combinations are rejected.

For a live FTMO profile, supply **FTMO Initial Capital** and, for 1-Step or Instant, **FTMO Max Loss Floor** from Account MetriX. The latter preserves a trailing floor that may predate the bot's local history. Do not reset the Instant floor after a reward. A new 1-Step account uses its new account reference.

## What the audit evaluates

| Requirement | Observed calculation |
| --- | --- |
| Daily loss | Current equity against the Prague-midnight balance less 5% of initial capital for 2-Step, or 3% for 1-Step and Instant. |
| Maximum loss | Current equity against initial capital less 10% for 2-Step, highest Prague-midnight balance less 10% for 1-Step, or highest closed-trade balance less 10% for Instant. |
| Evaluation target | 10% for 1-Step Challenge and 2-Step Challenge; 5% for 2-Step Verification. Requires the target balance and no open positions. |
| Trading days | Four distinct Prague dates with an opened trade in 2-Step Challenge or Verification. |
| Consistency | Best closed-profit day at most 50% of total net closed profit for current 1-Step, 50% of positive-day profits for legacy 1-Step, or 30% of net closed profit for Instant. An unmet consistency condition delays an objective or reward; it is not a loss-rule breach. |
| Restricted news | For funded Standard accounts, checks order entry and exit timestamps against supplied FTMO restricted events for the affected symbol, within two minutes on either side. |
| Long market break | For funded Standard accounts, checks whether a position remained open into a supplied market break longer than two hours. |
| Reward eligibility | Checks the supplied reward cycle, positive closed profit, flat account, consistency, and 14 days after the first observed entry. FTMO approval remains external. |

The news and long-break checks are **not applicable** to Challenge, Verification, or funded 2-Step Swing accounts. FTMO trading-practice review is always `unknown_ftmo_review`.

## Evidence and results

The optional **FTMO Evidence JSON** parameter accepts a local absolute path to a manifest. Its structure is:

```json
{
  "source": "FTMO account and restricted-calendar export identifier",
  "account_history_complete": false,
  "reward_history_complete": false,
  "cycle_start_utc": "2026-11-01T00:00:00Z",
  "news_coverage_start_utc": "2026-11-01T00:00:00Z",
  "news_coverage_end_utc": "2026-11-30T23:59:59Z",
  "market_break_coverage_start_utc": "2026-11-01T00:00:00Z",
  "market_break_coverage_end_utc": "2026-11-30T23:59:59Z",
  "restricted_events": [
    { "at_utc": "2026-11-02T09:00:00Z", "title": "Event identifier", "symbols": ["XAUUSD"] }
  ],
  "market_breaks": [
    { "start_utc": "2026-11-02T09:00:00Z", "end_utc": "2026-11-02T12:00:00Z", "symbol": "XAUUSD" }
  ]
}
```

These timestamps and events illustrate the format; they are not FTMO evidence. The manifest can declare the account and reward-cycle history complete and provide the reward-cycle start, restricted FTMO events, market breaks, and the UTC coverage interval for each calendar. Only declare coverage complete when the source covers the whole observed cycle. The simulator trusts these declarations; it cannot authenticate FTMO's external records.

On stop, cTrader logs `[FTMO][PUBLISHED_REPORT]` and one `[FTMO][PUBLISHED_VIOLATION]` line for each news or market-break finding. When backtest export has a run directory, it also writes `ftmo_published_rules.json` there. These findings include the affected symbol, event/break time, and trade execution or holding time in `violation_evidence`. A loss crossing observed during the run logs `[FTMO][PUBLISHED_BREACH]` and appears as the first observed breach in the report. The report includes `protective_stop_reason` and `observed_window_only` so an early bot stop is distinguishable from an FTMO breach. Missing account, reward, or calendar evidence yields `unknown_*`, never a pass. A full synthetic backtest history is complete for its simulated account and observed window, not proof of an external FTMO account's complete history.

This is a local published-rule simulation, not FTMO certification. Historical FTMO event markings, exact broker execution records, rewards and account transitions, and trading-practice decisions require FTMO evidence or review.

Sources checked on 2026-11-06: [Trading Objectives](https://ftmo.com/en/trading-objectives/), [product comparison](https://ftmo.com/en/comparison-table/), [news restrictions](https://ftmo.com/en/faq/can-i-trade-news/), [market-close rule](https://ftmo.com/en/faq/can-i-hold-positions-overnight-or-over-the-weekend/), [Swing account](https://ftmo.com/en/faq/what-is-the-swing-account-type-and-how-does-it-work/), [reward timing](https://ftmo.com/en/faq/how-do-i-withdraw-my-profits/).
