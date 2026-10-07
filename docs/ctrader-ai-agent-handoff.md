# cTrader AI Agent Handoff and Product Specification

> **Status:** Current operational baseline as of 2026-09-30
> **Current source build:** `v2026.09.30 - adaptive-risk-modes-v37`
> **Primary source of truth:** `src/mt5-bridge/clients/TVBridge_CTrader.cs`

This document is the durable handoff for an AI agent continuing the 42Trade cTrader work. It combines:

- repository and deployment rules;
- current implemented behavior derived from source;
- original product requirements that must be preserved;
- strategy, event, confluence, risk, visual, dashboard, and logging contracts;
- validation steps and known limitations.

When this document and the code disagree, inspect the current source before changing anything. Treat a documented product requirement as an acceptance criterion, but never claim it is implemented until source or runtime verification confirms it.

---

## 1. Mandatory startup sequence

Every new agent must read these files before editing:

1. `AGENTS.md`
2. `agents/BOOTSTRAP.md`
3. `agents/rules/ctrader.md`
4. this document

For structural code questions, use the configured CodeGraph tools first. Use `rg` for literal strings, comments, labels, JSON values, and log messages. The cTrader source file is very large, so use narrow reads around known symbols rather than dumping the whole file.

Do not edit `AGENTS.md`. Durable project guidance belongs under `agents/` or `docs/`.

---

## 2. Source, sync, and build authority

### 2.1 Canonical and generated copies

The repository file is authoritative:

```text
src/mt5-bridge/clients/TVBridge_CTrader.cs
```

cTrader compiles this active copy:

```text
/Users/macmini/cAlgo/Sources/Robots/tvbridge/tvbridge/tvbridge.cs
```

Never make the cTrader copy the only edited version. After every repository change:

1. copy the **entire** repository source file to the cTrader path;
2. compare checksums;
3. build in cTrader;
4. restart the running bot or start a new backtest when parameters, initialization, indicators, or visual state changed.

Do not use partial concatenation or patch fragments to synchronize the active file.

### 2.2 Build verification

The reliable build is the cTrader UI build. A local `dotnet` command may not be available and is not a substitute for the cTrader compiler/runtime.

At the time of this handoff, the build succeeds with two existing `CS0649` warnings for unused override fields on `BacktestStrategySignal`:

- `TakeProfitModeOverride`
- `OrderCountModeOverride`

Do not describe a change as finished or synced until source copy, checksum, and cTrader build have all been verified.

### 2.3 Workspace safety

- Preserve unrelated user changes.
- Do not stop a running bot or backtest unless the user asks or it is essential and clearly explained.
- Avoid destructive Git or filesystem commands.
- Git commands may fail until the host's Xcode license is accepted. Do not alter host licensing without user authorization.

---

## 3. Architecture map

The cTrader bot is intentionally a single-file engine. Important responsibility areas in `TVBridge_CTrader.cs` include:

| Area | Responsibility |
|---|---|
| Parameters and enums | cBot UI groups, trade modes, strategy selectors, confluence selectors, visuals, risk modes |
| Data/timeframes | closed-bar snapshots, LTF/HTF selection, fixed dashboard timeframes |
| Event detection | candle patterns, market structure, zones, indicators, chained events |
| Strategy detection | native/indicator strategies and file-backed strategy definitions |
| Trend/Bias | common directional scoring used by dashboard and optional trade gate |
| Trade confluences | independent gates applied after a valid trigger |
| Trade planning | Entry, SL, TP, order count, limit/market legs, volume |
| Execution safety | symbol gating, spread/gap/SL/risk checks, duplicate prevention |
| Position management | break-even, auto-exit, adaptive risk accounting |
| Visuals | markers, structure labels, indicator lines, event boxes, dashboard |
| Persistence | local storage for state that must survive restart |

File-backed strategy definitions live in:

```text
src/config/strategies/*.json
```

Related reference documents:

- `docs/ctrader-bridge.md`
- `docs/sweep-reclaim.md`
- `docs/trading-event-parity-spec.md`
- `docs/shared-engine-catalog.md`
- `docs/adaptive-risk-pool.md`

Some older documents describe previous parameter names or behavior. This handoff is the newer cTrader baseline.

---

## 4. Core product invariants

These rules are non-negotiable unless the user explicitly changes them.

### 4.1 Closed-bar and deterministic processing

- Use closed candles for confirmed signals and chained events.
- Calculate timeframes from HTF to LTF.
- Avoid look-ahead in backtests and historical replay.
- A historical replay and a live closed-bar evaluation should produce the same event sequence.
- Stateful chains must remember intermediate events across bars, but must not replay an already-consumed completion as a new trade.

### 4.2 A marker is not automatically a trade

Keep three concepts distinct:

1. **Raw event:** a detector found a pattern or structure event.
2. **Qualified signal:** trigger is valid after its required context/confluences.
3. **Executed trade:** qualified signal also passed execution, risk, symbol, duplicate, spread, and order checks.

Raw diagnostic markers may be shown when explicitly enabled, but trade markers must not imply that an order was opened when final gates failed. If a marker represents a tradable signal, it should use the same qualification path as execution.

### 4.3 Symbols parameter gates trading, not analysis

The configured Symbols list controls whether the cBot may submit an order. It must not suppress detection or chart markers on the chart's current symbol. An unlisted symbol can still display events and qualified markers; it simply cannot trade.

### 4.4 Protective stop is mandatory

Every market position must have a valid attached protective Stop Loss. Reject an order when a valid SL cannot be derived. Never open first and hope to attach protection later.

### 4.5 Strategy ownership contract

For custom/file-backed strategies:

- strategy definition owns **SL semantics** and **auto-exit**;
- cTrader Trade Config owns **Entry**, **TP**, and **n.Trades**;
- a strategy-provided SL takes priority when Entry is `Now_Auto` or equivalent auto mode;
- strategy JSON should not silently override Entry, TP, or n.Trades.

---

## 5. Timeframe model

### 5.1 Fixed dashboard timeframes

The dashboard must always show, in this order:

```text
d1 → h4 → h1 → m15 → m5
```

The order is HTF to LTF. Do not remove a column merely because it has no event. `m30` and the old `Final` column were intentionally removed.

### 5.2 LTF and HTF selectors

- `LTF` means the configured signal/trading timeframe for that evaluation.
- `HTF` means the mapped higher timeframe used by the common timeframe resolver, not an arbitrary currently visible chart period.
- `Yes` on a selector that supports both scopes means evaluate the intended LTF and HTF scopes.
- The next agent must reuse the existing resolver rather than create a second HTF mapping table.

### 5.3 Scan cadence

The engine should work on closed-bar cadence rather than repeatedly recomputing unchanged data every few seconds.

- Backtest scheduling currently uses a 300-second cadence.
- Live strategy scanning is bounded by the configured scan interval, clamped to the engine limits.
- Dashboard refresh may be more frequent for display responsiveness, but expensive signal calculations should reuse the latest closed-bar result/cache.

---

## 6. Events and market structure

### 6.1 Event families

The system recognizes or displays events from these broad families:

- candle patterns: hammer/pin bar, engulfing, large-body/impulse, wick formations;
- structure: swing high/low, HH, HL, LH, LL, BOS, CHOCH, MSS, sweep;
- zones: order blocks, fair value gaps, supply/demand and related boundaries;
- dynamic levels: EMA, trendline, Donchian, Ichimoku, Bollinger and similar boundaries;
- composite chains: sweep/reclaim and strategy-specific multi-step sequences.

Short codes are used on the chart and dashboard. When more than one event occurs at the same bar/time, show at least two rather than overwriting the first. Join them compactly, for example:

```text
m30.ham+eng
```

Do not add the timeframe inside a dashboard cell because the column already identifies it.

### 6.2 Swing labels and structural drawings

Chart Visuals must support structure scope and pivot strength combinations such as:

```text
No
LTF_3, LTF_5, LTF_7, LTF_9
HTF_3, HTF_5, HTF_7, HTF_9
Yes_3, Yes_5, Yes_7, Yes_9
```

Expected behavior:

- `No`: draw no swing labels and no structure lines for this visual.
- LTF labels: `hh`, `hl`, `lh`, `ll`.
- HTF labels: prefix the timeframe, for example `4h.hh`.
- Both: display LTF and HTF without confusing them.
- Place labels a small distance beyond the wick, like sweep labels, so they do not overlap candles.
- BOS, CHOCH, and MSS use dotted line styling and the common background-alpha visual convention.
- Larger pivot strength means fewer, more important swings.

Do not mix the sweep detector's pivot strength with HH/HL/LH/LL strength accidentally. They historically had different defaults; any unification must be deliberate and regression-tested.

### 6.3 Sweep/Reclaim chain

Canonical short code and strategy id:

```text
sweep_reclaim
```

The deterministic chain is:

1. a confirmed swing is swept and price reclaims it;
2. strict rejection occurs at the same level on the reclaim bar or within the next 3 bars;
3. same-direction CHOCH occurs within 6 bars;
4. same-direction BOS occurs within 10 bars after CHOCH, using a new reference swing formed after CHOCH and never counting the same break twice;
5. same-direction candle confirmation occurs within 3 bars;
6. the whole chain completes within 20 bars.

Invalidate the chain when price closes beyond the sweep extreme or an opposite CHOCH occurs. Use closed bars only. Emit the first valid completion once.

Visualization:

- draw the `sweep_reclaim` marker on the final confirmation;
- draw a surrounding box from the first sweep bar through the last chain bar;
- vertically cover the full high/low range of the chain;
- historical replay may draw old chains, but startup watermarking must prevent old chains from becoming new live trades.

See `docs/sweep-reclaim.md` for the detailed state machine and parity checklist.

---

## 7. Trend/Bias and trade confluences

### 7.1 Keep the concepts separate

There are two layers:

1. **Trend/Bias Confluences** calculate the directional bias/score for a timeframe.
2. **Trade Confluences** decide whether a valid strategy/event signal is allowed to trade.

The top-right dashboard bias and the optional `Trend/Bias Confluence` trade gate must call the same Trend/Bias function. They must not contain duplicated or divergent calculations.

EMA, RSI, MACD, ADX, Ichimoku, Ichimoku Strict, Structure, Premium/Discount, Opposing Level Clearance, and similar trade gates must stay in the intended group. A previous refactor incorrectly moved trade confluences into bias calculation; do not repeat that mistake.

If every Trend/Bias component is disabled, the dashboard must still use the engine's defined neutral/fallback behavior consistently. It must not fabricate direction from disabled components.

### 7.2 Dashboard presentation of bias

Each timeframe cell always shows:

- trend/bias score with directional color; and
- the most recent event from the previous closed candle, if any.

If a trade signal exists, display its short code instead of the raw event. A lack of event must not replace the bias score with `-`.

### 7.3 Premium/Discount

Product requirement:

- use the highest high and lowest low of the recent 24 closed bars as the active range;
- do not depend on a distant swing that can make the range irrelevant;
- bullish opportunities should be in the discount portion;
- bearish opportunities should be in the premium portion;
- a signal near the wrong side of the range must fail this confluence.

The exact threshold/midpoint and tolerance must come from the common function/parameters. Do not introduce a second implementation for chart visuals versus trade gating.

### 7.4 Opposing Level Clearance

This confluence is broader than supply/demand zones. It must consider relevant opposing obstacles such as:

- supply/demand or swing levels;
- trendlines;
- EMA/dynamic moving-average levels;
- order-block or FVG boundaries where enabled;
- other active indicator boundaries used by the engine.

Examples:

- reject or penalize a bullish pattern closing inside or nearly touching overhead supply, resistance, descending trendline, or EMA resistance;
- mirror the rule for bearish signals near demand/support or bullish dynamic resistance.

The point is **clearance in the intended trade direction**, not merely whether a level exists somewhere on the chart.

### 7.5 Exact rejection reasons

Only log confluence rejection after a trigger signal is valid and a specific enabled gate fails. The message must identify the exact failed gate(s).

Do not emit high-volume messages such as:

```text
no matching file-backed strategy signal
```

Do not print a generic list of every confluence. Examples of useful reasons:

```text
Reject sweep_reclaim XAUUSD: premium_discount(LTF)
Reject reject_trendline GBPJPY: opposing_level_clearance(LTF:EMA)
```

---

## 8. Strategy catalog

### 8.1 Selection model

The cBot supports multiple strategy selectors so the user can enable several strategies simultaneously. Preserve unique strategy identity through detection, marker, order label/comment, auto-exit, and adaptive-risk accounting.

File-backed strategies currently include:

```text
candle_pattern_trend
pinbar_structure_event
engulfing_structure_event
wick_flip
sweep_reclaim
reject_trendline
london_trend_sweep
```

Indicator/native strategies include the following storage keys or modes:

```text
ema_cross_v1
sma_cross_v1
golden_cross_v1
triple_ema_trend_v1
rsi_reversion_v1
bollinger_reversion_v1
stoch_reversal_v1
macd_signal_v1
roc_momentum_v1
donchian_breakout_v1
donchian_breakout_v2
ichimoku
ichimoku_strict
ichimoku_full_confirmation
follow_trend
follow_trend_big_candle
wick_flip_continuation
```

Additional price-action, artifact, and AI-snapshot modes remain in the enum/engine. Inspect `GetBacktestStrategyStorageKey`, `TryGetFileBackedStrategyId`, and the strategy switch before removing or renaming any mode.

### 8.2 Built-in strategy definitions

| Strategy | Detection | Strategy SL | Auto-exit / notes |
|---|---|---|---|
| EMA Cross | EMA 9 crosses EMA 21 | Auto fallback unless definition overrides | Trade Config TP |
| SMA Cross | SMA 20 crosses SMA 50 | Auto fallback | Trade Config TP |
| Golden Cross | SMA 50 crosses SMA 200 | Auto fallback | Trade Config TP |
| Triple EMA Trend | EMA 8/21 cross aligned with EMA 55 | Auto fallback | Direction follows alignment |
| RSI Reversion | RSI 14 returns through 30/70 | Auto fallback | Mean-reversion signal |
| Bollinger Reversion | 20-period, 2-standard-deviation return toward middle | Opposite/outer boundary fallback | Bollinger has a separate visual color scheme from Donchian |
| Stochastic Reversal | Smoothed stochastic 14,3 returns through 20/80 | Auto fallback | Mean-reversion signal |
| MACD Signal | MACD 12/26 crosses signal 9 | Auto fallback | Momentum signal |
| ROC Momentum | ROC 12 crosses zero | Auto fallback | Momentum signal |
| Donchian Breakout v1 | Fresh close outside prior 20-bar channel plus quality/trend gates | Channel middle ± buffer | Opposite 10-bar Donchian close; BE at 1R |
| Donchian Tenkan Pullback v2 | Same breakout quality gates; entry halfway between directional event wick and Conversion line | Derived for 2R against opposite event wick target | Opposite Donchian exit |
| Ichimoku | New directional state from price/cloud, cloud direction, and Conversion/Base alignment | Opposite cloud edge + buffer | Lagging Span crosses historical price against trade |
| Ichimoku Strict | Ichimoku plus Lagging Span clearance of historical candle and historical cloud | Opposite cloud edge + buffer | Same Lagging Span exit |
| Follow Trend | Common deterministic trend engine | Strategy/category fallback | See engine implementation |
| Follow Trend Big Candle | Trend plus impulse/large candle | Candle/category fallback | See engine implementation |

### 8.3 Donchian Breakout v1 details

The detector currently requires:

- enough warmup history, including long-term trend context;
- a fresh close outside the previous 20-bar high/low;
- candle body at least `0.25 × ATR(14)`;
- breakout extension no greater than `1 × ATR(14)`;
- bullish close location at least `0.60` of the candle range, or bearish at most `0.40`;
- EMA 50/200 directional alignment;
- EMA 50 slope in the breakout direction over 3 bars;
- ADX(14) at least 18.

SL:

```text
Donchian middle line ± max(2 pips, 0.25 × ATR(14))
```

The signal may seed a 1R target for internal calculations, but the Trade Config TP remains authoritative under the current ownership contract. Auto-exit uses an opposite close through the 10-bar Donchian boundary. Break-even is applied at 1R where configured.

### 8.4 Ichimoku definitions in English chart terms

Standard periods:

- Conversion Line: 9
- Base Line: 26
- Cloud calculation: 52
- Lagging Span comparison: 26 bars in the past

Normal Ichimoku directional state:

- price is on the correct side of the cloud;
- cloud direction agrees;
- Conversion Line is on the correct side of Base Line;
- trigger only on a new directional state, not every bar while state remains true.

Strict adds Lagging Span conditions:

- long: current close, plotted 26 bars back as the Lagging Span, is above the **high** of the historical candle at that past position and above the historical cloud there;
- short: it is below the **low** of that historical candle and below the historical cloud there.

SL:

```text
opposite cloud edge ± max(2 pips, 0.10 × ATR(14))
```

Auto-exit:

- long: Lagging Span crosses below the historical price/candle relationship;
- short: Lagging Span crosses above it.

The cTrader native Ichimoku indicator must use `Shift = 0` for correct visual alignment in this integration: Conversion and Base stay on the current price bars, while the native Lagging Span is displayed 26 bars to the left. Do not add a second custom Lagging Span drawing unless the native indicator becomes impossible to use and the user explicitly approves it.

### 8.5 File-backed strategy intent

| Strategy | Trigger intent | SL | Auto-exit |
|---|---|---|---|
| `candle_pattern_trend` | Directional candle pattern aligned with trend/context | Candle/category rule | Opposite structure event |
| `pinbar_structure_event` | Pin bar plus structure context | Pattern/candle rule | Opposite structure event |
| `engulfing_structure_event` | Engulfing plus structure context | Pattern/candle rule | Opposite engulfing/structure condition |
| `wick_flip` | Two-candle opposite-wick continuation pattern | `candle_wick_13` | Opposite wick flip |
| `sweep_reclaim` | Completed chain in section 6.3 | Pattern boundary + buffer | Opposite structure event |
| `reject_trendline` | Directional candle rejecting a trendline | `candle_wick`, not generic auto | Opposite structure event |
| `london_trend_sweep` | London-session M15 EMA 9/21 aligned sweep continuation | ATR-buffered pattern boundary | Opposite structure event |

Always read the current JSON before modifying one of these strategies. JSON wording is executable product contract, not decorative documentation.

### 8.6 Wick Flip Continuation

Original pattern requirement:

- two consecutive candles;
- one has a long lower wick and the other a long upper wick, in either order;
- direction is the continuation opposite the second candle's dominant wick;
- entry is controlled by Trade Config;
- strategy SL uses the second candle/pattern wick rule;
- TP is controlled by Trade Config under the current ownership model.

Historical initial target intent was `min(1R, first candle open)`. That intent was superseded by the global ownership rule that TP comes from Trade Config. Do not reintroduce strategy-owned TP without an explicit product decision.

---

## 9. Entry, SL, TP, and multi-trade planning

### 9.1 Entry semantics

- `Market` or `Now`: submit the immediate market leg.
- `Now_Wick`: immediate market entry with wick-derived SL.
- `Now_Auto`: immediate market entry; use the strategy-defined SL first, then a category fallback.
- `Now_Event`: immediate market entry using the reverse/opposite boundary of the triggering event plus buffer.
- Limit modes create planned entries according to their configured level logic.

Do not infer that `Now_Wick` is a limit order because its SL refers to a wick.

### 9.2 Auto SL priority

For `Now_Auto`, use this order:

1. explicit strategy definition SL;
2. signal/event geometry;
3. category fallback;
4. reject if no safe valid boundary exists.

Recommended category fallback matrix:

| Signal category | Fallback SL |
|---|---|
| Candle/pin/engulfing/wick pattern | Opposite wick or pattern extreme + buffer |
| Structure break/reversal | Invalidating swing/structure boundary + buffer |
| FVG | Opposite FVG edge + buffer |
| Order Block | Opposite OB edge + buffer |
| EMA/dynamic line | Opposite side of the relevant line/zone + buffer |
| Donchian | Opposite or middle channel boundary as strategy specifies + buffer |
| Ichimoku | Opposite cloud edge + buffer |
| Bollinger | Opposite relevant band/mean-reversion invalidation + buffer |
| Trendline rejection | Rejection candle wick/pattern boundary + buffer |

### 9.3 Event boundary rule

`Now_Event` always means the event's **reverse/other-side invalidation boundary**, not the nearest arbitrary price:

- FVG: other edge;
- OB: other edge;
- candle event: opposite wick/body boundary selected by event definition;
- EMA/trendline: opposite side of the interaction plus buffer;
- Donchian: relevant opposite/middle channel boundary per strategy;
- Ichimoku: opposite cloud boundary;
- any new zone-like event: define both directional boundaries before enabling `Now_Event`.

### 9.4 Candle SL variants

Supported/requested candle modes include:

- `candle_wick`
- `candle_wick_07`
- `candle_wick_13`
- `candle_body`

`candle_body` measures from close to the invalidating body edge. If the body is too small to form a safe SL, fall back to the wick. Multipliers or offsets must be reflected in the trade comment.

### 9.5 TP and SL source comments

If a final SL or TP is chosen by `min`, `max`, or selection among several methods, the comment must show the method that actually won, including multiplier or offset. Examples:

```text
SL=ATR24*1.2
SL=Wick*1.2
SL=Wick+0.2
TP=RR1
```

Do not reduce a computed selection to an ambiguous `SL=Wick` when a multiplier or competing method materially changed it.

The former `ar:...` adaptive-risk token was removed from visible new trade comments. Legacy comments may still contain it and may still be parsed for compatibility; existing history is not rewritten.

### 9.6 n.Trades and risk split

The intended rule is:

- split setup risk equally across all enabled sub-trades;
- total planned risk across the setup equals the configured maximum risk per trade/setup;
- do not apply the old logarithmic/weighted allocation;
- with a market-first plan, count the first market trade as the setup's primary trade and treat later limit legs as the same setup for total-risk accounting.

The actual entry types come from the `1st Trade`, `2nd Trade`, and subsequent Trade Config parameters. `n.Trades = 3` alone does not mean all three must be market orders; it activates the first three configured legs.

---

## 10. Execution safety and gap protection

Before submitting any leg, validate:

- symbol is trade-enabled;
- signal is not stale or already consumed;
- required confluences passed;
- entry and SL are on the correct sides for direction;
- SL distance is positive and meets broker minimums;
- volume is normalized and valid;
- aggregate setup/account risk is within limits;
- duplicate-position and maximum-position rules pass;
- spread/slippage/gap safety checks pass;
- protective SL can be attached to the market order.

Stop Loss limits intended risk under normal execution, but it cannot guarantee exact loss across a market gap. A stop may fill at the first available price beyond the requested level. Therefore retain gap/spread protection, risk hard caps, and abnormal-distance checks; never describe stop risk as guaranteed.

---

## 11. Adaptive Risk

### 11.1 UI contract

Only one public parameter is shown:

```text
Trade Config → Adaptive Risk
```

It appears after Exit Mode. Modes:

```text
Off
Per Chain
Balance Recovery
```

The old display name `Yes` was replaced by the clearer `Per Chain`. Hide the former advanced adaptive-risk parameters from the cTrader settings pane, but retain their defaults in code for compatibility.

Current hidden defaults include:

- pool id: `main`;
- slots: `MaxPositionsTotal`;
- hard cap per trade: 1%;
- chain ceiling: 150%;
- profit participation: 100%;
- reset mode: manual;
- reset version: 0.

### 11.2 Off

Use the base risk selected by the normal Max Risk / trade configuration, subject to the ordinary hard caps and setup split.

### 11.3 Per Chain

This is the prior adaptive-risk behavior:

- persistent pool/group state;
- losing chain reduces available risk;
- winning recovery can increase it according to the existing chain rules;
- chain ceiling and hard cap remain enforced;
- state survives bot restarts.

Do not silently reinterpret `Per Chain` as the balance formula below.

### 11.4 Balance Recovery

Goal: shrink risk in direct proportion to account drawdown from the starting/anchor balance, then recover gradually as balance recovers, never exceeding the original per-trade risk.

Definitions:

```text
anchorBalance       = persisted starting balance for this adaptive pool
currentBalance      = current account balance
initialBudget       = anchorBalance × totalRiskBudgetPercent
remainingBudget     = clamp(initialBudget + currentBalance - anchorBalance,
                            0,
                            initialBudget)
recoveryFactor      = remainingBudget / initialBudget
nextRiskPercent     = originalRiskPercent × recoveryFactor
```

The factor is always between 0 and 1. Therefore this mode never risks more than the original selected risk per trade.

Example with a 100,000 account, a 10,000 risk budget, and original risk of 1%:

| Balance P/L | Remaining budget | Next risk |
|---:|---:|---:|
| 0 | 10,000 | 1.0% |
| -2,000 | 8,000 | 0.8% |
| -3,000 | 7,000 | 0.7% |
| recovery to -1,000 | 9,000 | 0.9% |
| profit above anchor | capped at 10,000 | capped at 1.0% |

If the current base Max Risk is 0.5%, the same `-2%` balance example produces `0.4%`, not `0.8%`.

Additional safety:

- total concurrent SL risk must not exceed remaining adaptive budget;
- reserve risk when submitting a new trade so concurrent signals cannot oversubscribe the pool;
- an account-wide submission lock protects shared accounting;
- normalize volume downward when necessary; reject if no valid volume remains;
- persist anchor/pool state so restart does not reset drawdown protection accidentally.

Dashboard must show:

- current maximum risk per trade; and
- current total adaptive risk budget/remaining pool.

---

## 12. Indicator visuals

Use the common `BG alpha` parameter consistently. Clamp calculated alpha to the platform range.

### 12.1 Donchian

All Donchian lines share yellow `#FACC15` and the same line width as EMA, currently 1 px:

| Line | Style | Alpha |
|---|---|---|
| Upper | Solid | `BG alpha × 1.5` |
| Lower | Solid | `BG alpha × 1.5` |
| Middle | Dotted | `BG alpha × 1.0` |

The middle uses the same color but is visibly lighter. Do not use 2 px unless EMA's common width changes too.

Bollinger Bands must use a different color family so they cannot be mistaken for Donchian.

### 12.2 Ichimoku

All primary Ichimoku lines share one blue family, currently `#38BDF8`, with 1 px width. They are separated by style and alpha, not unrelated colors:

| Line | Style | Alpha |
|---|---|---|
| Conversion Line | Solid | `BG alpha × 1.5` |
| Base Line | Dashed/Lines | `BG alpha × 1.25` |
| Lagging Span | Solid | `BG alpha × 0.75` |

The cloud retains directional green/red fill. Hidden cloud boundary lines should not create extra visual clutter.

Native indicator alignment:

- `Shift = 0` in this cTrader integration;
- Conversion and Base stay on current bars;
- Lagging Span appears 26 bars left of current price;
- do not manually shift Conversion or Base into the future/past.

---

## 13. Dashboard contract

The top-right dashboard is a compact status view, not a second strategy engine.

Required layout/behavior:

- fixed columns `d1, h4, h1, m15, m5`;
- calculation and display order HTF → LTF;
- each cell starts with a colored, dedicated Trend/Bias score column, even when no event exists; use `-` with the neutral color for zero or unavailable bias, followed by the event/signal when present. Allocate enough width for cTrader control padding so one-character scores are never clipped;
- also show the most recent previous-closed-bar event short code;
- if a strategy/trade signal exists, show it instead of the raw event;
- multiple events can be joined compactly;
- no redundant timeframe text inside a cell;
- no obsolete `m30` or `Final` column;
- include current Max Risk per trade and total/remaining adaptive risk budget.

The dashboard and Trend/Bias trade gate must consume the same computed bias object. A display refresh must not mutate trading state.

---

## 14. Persistence, cache, and restart behavior

State that changes trade behavior across bars or restarts must be intentionally persisted or intentionally reconstructed. This includes:

- adaptive risk pool/anchor;
- strategy chain state where restart continuity is required;
- consumed signal/watermark information that prevents duplicate historical trades;
- selected strategy identity and position metadata needed for auto-exit.

Cache rules:

- cache results by symbol, timeframe, and closed-bar identity;
- invalidate on a new closed bar or relevant parameter/config change;
- a fast UI timer may read cache, but must not recalculate all strategies unnecessarily;
- never allow a stale cache to suppress a new closed-bar signal indefinitely.

After changing parameters or initialization behavior, restart the bot. After source sync/build, old running instances do not magically acquire new code.

---

## 15. Logging contract

Keep logs useful at live scale:

- log valid trigger followed by a specific confluence rejection;
- log failed order submission with concrete broker/error reason;
- log critical risk or missing-SL rejection;
- log state migration/reset when it affects behavior.

Suppress:

- per-scan “no matching signal” messages;
- repeated cache/no-op messages;
- generic rejection lists containing every confluence regardless of which failed;
- repeated identical messages on every timer tick.

Use signal identity, symbol, timeframe, strategy, and exact failed gate where helpful.

---

## 16. Testing and acceptance checklist

### 16.1 Before editing

- Read the startup files in section 1.
- Identify the exact symbols/functions with CodeGraph.
- Read the relevant strategy JSON and focused source ranges.
- Note any user changes in the same area and preserve them.

### 16.2 Static checks

- Parameter group/name/defaults are correct.
- Enum parsing and backward compatibility are preserved.
- Strategy id is preserved through detection, plan, execution, comment, and exit.
- Long/short calculations are mirror-symmetric where intended.
- Indexing uses closed bars and has enough warmup checks.
- No second implementation duplicates Trend/Bias or HTF resolution.
- New visual object names are stable and do not collide.

### 16.3 Deterministic runtime checks

- Event replay produces no duplicate completion.
- Multi-event bar displays more than one event.
- Unlisted symbol displays markers but submits no order.
- Qualified marker and trade gate agree.
- Exact failed confluence is logged once.
- Every market order has SL at submission.
- `n.Trades` splits total risk equally.
- `Now_Auto` uses strategy SL before fallback.
- `Now_Event` uses the opposite boundary plus buffer.
- Auto-exit only closes positions owned by the matching strategy/direction rule.

### 16.4 Risk checks

- Off uses base risk.
- Per Chain preserves legacy chain behavior.
- Balance Recovery reproduces 0.8, 0.7, 0.9, and capped 1.0 factors in the canonical example.
- Multiple simultaneous submissions cannot exceed the remaining pool.
- Gap/spread rejection does not create an unprotected position.
- Restart preserves intended adaptive state.

### 16.5 Visual checks

- Dashboard has all five fixed timeframe columns.
- Cells retain bias color/score without an event.
- Donchian and Ichimoku styles match section 12.
- Ichimoku Lagging Span is 26 bars left; Conversion/Base are current.
- Structure visual `No` draws nothing.
- LTF/HTF swing labels use correct prefixes and wick offset.
- Visual objects do not disappear after timer refresh or cleanup passes.

### 16.6 Delivery checks

- Update the build version string.
- Copy the complete repo file to cTrader.
- Verify checksums match.
- Build in cTrader.
- Report warnings honestly.
- Tell the user whether a bot/backtest restart is required.

---

## 17. Known pitfalls and unresolved validation areas

The next agent should not assume these are solved forever:

1. **Visual cleanup:** chart objects previously disappeared after some time. Any cleanup routine must distinguish stale owned objects from currently valid indicator/dashboard objects.
2. **Marker/trade mismatch:** raw detections can make charts look busy while few trades execute. Always verify which marker layer is enabled.
3. **Over-tight confluences:** a valid trigger can be eliminated by unintended migration of bias components into trade gates. Keep the layers separate.
4. **Backtest timeframe confusion:** cTrader chart timeframe and strategy signal timeframe can differ. Log/display the actual evaluated timeframe and do not infer it from the visible chart alone.
5. **Gap loss:** SL cannot guarantee exact fill through gaps. Validate abnormal fills and retain defensive limits.
6. **Historical comments:** removal of `ar:` affects new comments only.
7. **Native indicators:** cTrader library behavior can differ from TradingView conventions. Ichimoku currently depends on native `Shift = 0`; verify visually after platform updates.
8. **Old docs:** `docs/adaptive-risk-pool.md` describes the earlier public parameter surface. Use section 11 here for the current mode/UI contract, while using the older doc only for legacy pool concepts.

---

## 18. How to extend the system safely

For a new event:

1. define an unambiguous short code;
2. define closed-bar detection and invalidation;
3. define directional boundaries for `Now_Event`;
4. define whether it is raw, qualified, or directly tradable;
5. add deterministic historical replay;
6. add stable visual object ids;
7. make multiple same-bar events composable rather than overwriting;
8. add exact rejection/log reasons.

For a new strategy:

1. define stable strategy id and user-facing name;
2. define trigger, direction, warmup, and timeframe;
3. define SL and auto-exit in its strategy definition;
4. leave Entry, TP, and n.Trades to Trade Config;
5. define auto-SL/event-boundary fallback;
6. preserve identity on positions for matching auto-exit;
7. add dashboard/marker short code;
8. add replay and no-duplicate tests;
9. add risk, symbol-gate, and protective-SL tests;
10. sync and build using section 2.

For a new confluence:

1. decide whether it measures Trend/Bias or gates a trade;
2. implement it once in the correct common function;
3. support LTF/HTF/Yes semantics through the shared resolver;
4. return a specific machine-readable failure reason;
5. confirm its chart interpretation and code logic agree;
6. test bullish and bearish mirror cases.

---

## 19. Product vocabulary

Use consistent English names in UI and explanations:

| Preferred | Avoid/confusion |
|---|---|
| Conversion Line | misspelled “Conversation Line”; Japanese name when explaining to user |
| Base Line | Japanese-only name |
| Lagging Span | Japanese-only name |
| Donchian | “Douchian” |
| Opposing Level Clearance | vague “touch” gate |
| Balance Recovery | generic “Yes” adaptive mode |
| Per Chain | generic “Yes” adaptive mode |
| Sweep/Reclaim | ambiguous sweep-only label for the full chain |

Code may retain legacy enum/member names for compatibility, but user-facing text and documentation should use the preferred terms.

---

## 20. Final handoff rule

The next agent's first responsibility is not to rewrite the system. It is to locate the current implementation, compare it with the relevant requirement in this document, make the smallest coherent change, verify source-to-runtime parity, and leave the source, strategy definitions, active cTrader copy, build version, and documentation consistent.
