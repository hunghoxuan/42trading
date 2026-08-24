# cTrader Bridge — Events, Visuals & Params Reference

Source of truth: `src/mt5-bridge/clients/TVBridge_CTrader.cs` (cTrader bot, class `TVBridgeCBot`).

This document catalogs the trade-trigger events (short codes), the Chart Visuals combos, the SMC zone detection presets, and the on-chart panels/grids. Keep it in sync when event options, combo values, or params change.

## Workflow (non-negotiable)

1. Edit `src/mt5-bridge/clients/TVBridge_CTrader.cs` (repo file is the long-term source of truth).
2. Full-file copy to the cTrader compile file: `cp src/mt5-bridge/clients/TVBridge_CTrader.cs /Users/macmini/cAlgo/Sources/Robots/tvbridge/tvbridge/tvbridge.cs`
3. Build: `/usr/local/share/dotnet/dotnet build /Users/macmini/cAlgo/Sources/Robots/tvbridge/tvbridge/tvbridge.csproj -c Release -v minimal` — must end "Build succeeded, 0 errors".
4. Verify repo == compile (`shasum -a 256` both).
5. User restarts the bot in cTrader. Params only apply on a full stop + start.

> The compile file is sometimes edited directly by the user between turns — always re-sync before building.

## Single-file engine architecture

The bridge remains one compilable `.cs` file, but reusable behavior is owned by focused top-level classes in the same namespace. `TVBridgeCBot` keeps cTrader lifecycle, parameters, UI controls, account state, and order dispatch. Do not move platform callbacks or parameter declarations into the engines.

| Class | Owns | Safe handoff scope |
|---|---|---|
| `CTraderBrokerCommentEngine` | SID/note parsing, source normalization, compact entry/TP/SL/RR comments | Broker comment changes |
| `CTraderTimeFrameEngine` | Timeframe parsing, minute conversion, canonical `m15`/`h1`/`d1` labels | Timeframe naming and conversion |
| `CTraderSequenceEngine` | Generic same-close event de-duplication, highest-timeframe retention | Duplicate LTF/HTF event behavior |
| `CTraderStrategyEngine` | Complete deterministic strategy runtime: signal construction and direction rules, entry-mode selection and retracements, candle/pattern/swing/invalidation protection, Auto SL/TP priority, directional level selection, confluence scoring, RR targets, split entries, and final protection validation | Copy this class with `CTraderStrategyLevelCandidate` and the strategy source enums; cTrader `Bars`, indicators, sessions, canonical-event lookup, caching, logging, and order dispatch remain adapters in `TVBridgeCBot` |
| `CTraderExecutionEngine` | Complete deterministic execution runtime: exit-mode capabilities, break-even trigger, stopped-position reversal plans, market/pending protection distances, fill-price re-anchoring, protection presence/tolerance and adjustment, split-leg affordability, partial-close sizing, and shared SL/TP movement | Copy this class with `CTraderExecutionProtectionPlan` and `CTraderExecutionReversePlan`; cTrader order/position API calls, broker-result retries, reflection compatibility, risk/account gates, logging, acknowledgements, and snapshots remain adapters in `TVBridgeCBot` |
| `CTraderRiskEngine` | Broker-aware risk/PnL arithmetic and symbol price normalization | Risk amount calculations |
| `CTraderRiskPolicyEngine` | Per-trade, same-idea, total-risk, daily-PnL, and equity-drawdown decisions | Risk-gate policy and rejection messages |
| `CTraderAllocationEngine` | Strategy-chain and split-entry risk weights | Multi-leg risk distribution |
| `CTraderSessionEngine` | Session-local datetime and overnight interval math | Session boundary behavior |
| `CTraderTechnicalEngine` | Crosses, EMA/SMA/VWAP, RSI, Stochastic, ATR, range and volatility math | Technical indicator/event calculations |
| `CTraderTransportEngine` | API URLs, HTTP timeout behavior, transport exception classification, response-error formatting | Server communication behavior |
| `CTraderPersistenceEngine` | JSON serialization and atomic cache/config writes | Local persistence behavior |
| `CTraderCacheEngine` | Complete cache mechanics: timed lookup, bounded FIFO eviction, analysis dirty/flush lifecycle, canonical loaded/tracked registry, master-timer thread-owned `Bars` reuse with off-thread bypass, and ordered persistence task chaining | Copy this one class for cache timing, eviction, lifecycle, timer scope, or persistence scheduling; TSV formats and domain snapshot cloning remain cBot adapters |
| `CTraderCandlePatternEngine` | Complete platform-neutral candle runtime: canonical OHLC statistics, strict and neutral pattern geometry, Big Candle and Harami direction/context, prior-pressure classification, multi-candle sequences, inside/outside bars, reversal wicks, and follow-through/rejection decisions | Copy this class with `CTraderCandleStats`; cTrader `Bars` extraction, pattern caches, chart rendering, and confluence lookups remain adapters in `TVBridgeCBot` |
| `CTraderStructureEngine` | Complete platform-neutral structure runtime: swings, BOS/CHOCH/sweeps, OB/FVG and key-level analysis, strict rejection/breakout predicates, structure-bias scoring, equal-high/low and double-top/bottom classification, sweep-pattern selection, and bounded snapshot reuse | Copy this class with the `CTraderStructure*`/`CTraderSweep*` result DTOs and `MarketAnalysisService`; cTrader `Bars` extraction, private DTO mapping, volume gates, cache-key construction, canonical-event mapping, and chart rendering remain adapters in `TVBridgeCBot` |
| `CTraderRuleEngine` | Complete platform-neutral shared-rule runtime: text/JSON parsing, final rule-result mapping, named-function dispatch, candle-rule detection and context filters, recursive boolean/comparison/arithmetic execution, cross/level evaluation, artifact construction/sequencing/de-duplication, normalization, context lookup and bias derivation | Copy this class plus the three `SharedRule*` result DTOs and `CTraderCandlePatternEngine`; cTrader `Bars`/indicator context assembly remains in `TVBridgeCBot` |
| `CTraderConfidenceEngine` | Confluence score normalization and RR/volume scaling | Confidence sizing curve |
| `MarketAnalysisService` | Independent swing, structure, zone, key-level, candle-pattern, confluence, and trade-plan analysis | Market-analysis logic |

Compatibility methods remain on `TVBridgeCBot` and delegate to these engines. This preserves existing params and call sites while allowing one engine class to be copied for focused review. Engine methods should stay deterministic; live cTrader state must be passed in explicitly rather than read from hidden globals.

## Events catalog (Event1–Event5 combos)

Each event carries a direction (bullish/bearish) except the trend-bias *against* options, which invert. Short codes appear in chart markers and in trade comments: `bot_{TF}|{event}|ltf:+N|htf:+N|in:..|tp:..|sl:..`.

### Structure events (canonical)

| Combo option | Short code | Notes |
|---|---|---|
| Change Of Character | `CHOCH` | |
| Break Of Structure | `BOS` | |
| Sweep Reclaim | `SR` | |
| Rejection (key level) | `RJ` | SL = level/zone height |
| Breakout (structure) | `BR` | |
| Pullback (EMA reclaim) | `PB` | |
| Continuation (VWAP reclaim) | `CT` | |
| Impulse (momentum shift) | `IM` | |
| **Any Structure Event** | resolves to real code(s) | OR-selector over all structure events; the label resolves down to the **actual** event that fired (e.g. `RJ`, `BOS`, `SR+CHOCH`), and SL uses that real event's zone height |
| **Divergence** | `DIV` | RSI swing divergence on latest closed bar; drawn with directional icon |

### Candle patterns

| Combo option | Short code | Bars |
|---|---|---|
| Pin Bar | `PIN` | 1 |
| Engulfing | `ENG` | 2 |
| Big Candle | `BIG` | 1 |
| Morning Star | `MOR` | 3 |
| Evening Star | `EVE` | 3 |
| Hammer | `HAM` | 1 |
| Hanging Man | `HGM` | 1 |
| Shooting Star | `SST` | 1 |
| Inverted Hammer | `IHM` | 1 |
| Piercing Line | `PRC` | 2 |
| Dark Cloud Cover | `DCC` | 2 |
| Three White Soldiers | `3WS` | 3 |
| Three Black Crows | `3BC` | 3 |
| Harami | `HAR` | 3 |
| **Any Candle Pattern** | resolves to real code(s) | OR-selector over all patterns; the label resolves down to the **actual** pattern that fired (e.g. `PIN`, `ENG`, `MOR+HAM`); SL uses the 3-bar span (safe upper bound) |

### Indicator events

| Combo option | Short code |
|---|---|
| EMA Price Cross | `pxe` |
| EMA Fast/Mid Cross | `emx` |
| EMA Mid/Slow Cross | `emt` |
| VWAP Price Cross | `vwx` |
| VWAP Rejection | `vwr` |
| Bollinger Mid Cross | `bbx` |
| Bollinger Band Reject | `bbr` |
| RSI Midline Cross | `r50` |
| RSI Exit Oversold | `ros` |
| RSI Exit Overbought | `rob` |
| Stoch Cross | `stx` |
| Stoch Exit Extreme | `sto` |
| MACD Signal Cross | `mdx` |
| MACD Zero Cross | `md0` |

### Trend bias filters

| Combo option | Short code | Meaning |
|---|---|---|
| LTF Trend Bias | `ltf` | trade with the lower-TF bias |
| HTF Trend Bias | `htf` | trade with the higher-TF bias |
| LTF Trend Bias (against) | `ltfX` | counter to the lower-TF bias |
| HTF Trend Bias (against) | `htfX` | counter to the higher-TF bias |

Event combos combine via the **AND / OR** mode (`StrategyCustomEventsMode`). Default SL for a custom-trade signal = height of the related event (candle span / OB-FVG zone height); `M. risk/idea` caps total risk.

## Chart Visuals combos

All four master combos follow the same shape: `All | None | Per Item | <specific>` (`Per Item` = use the individual per-item params/toolbar toggles).

### SMC Zones
`All | None | Per Item | Order Blocks | FVG Zones | Key Levels | Liquidity | Higher Timeframe Zones | Killer Zones | Supply/Demand`

### Structure Events
`All | None | Per Item | Sweep | BOS | CHOCH | Rejection | Breakout | Pullback | Continuation | Impulse`

### Momentum Technical
`All | All Custom | None | Per Item | Ema | Vwap | Bollinger | Ichimoku | Ema Events | Vwap Events | Bollinger Events | Rsi Events | Stoch Events | Macd Events`

- `All` → renders via built-in cTrader API indicators.
- `All Custom` → renders with the bot's own line styles (custom draw); native indicators are removed.
- `None` → **all indicators are removed** (overlays + RSI/Stoch/MACD panels) — the combo re-syncs native indicators after applying.

### Candles
`All | None | Per Item | Pin Bar | Engulfing | Big Candle | Morning Star | Evening Star | Hammer | Hanging Man | Shooting Star | Inverted Hammer | Piercing Line | Dark Cloud Cover | Three White Soldiers | Three Black Crows | Harami`

## SMC Zones detection presets

Combo-style presets for the OB/FVG visual detection (each first option ignores the check):

| Param | Options → value |
|---|---|
| Zones Vol Surge | `No` (off) \| `5%` \| `10%` \| `15%` \| `20%` |
| FVG Displacement | `No`→0 \| `Loose`→1.05 \| `Normal`→1.15 \| `Tight`→1.30 \| `Strict`→1.50 |
| FVG Body Ratio | `No`→0 \| `Low`→0.40 \| `Medium`→0.55 \| `High`→0.70 \| `Full`→0.85 |
| FVG Gap % | `No`→0 \| `Tiny`→0.05 \| `Small`→0.10 \| `Normal`→0.18 \| `Large`→0.30 |
| Skip Revisited | `No` = draw revisited zones too, `Skip` = hide them |
| Zone Lookback | `All`→0 \| `Bars 50` \| `Bars 80` \| `Bars 120` \| `Bars 200` |
| Max Zones | `All`→no cap \| `Few`→4 \| `Normal`→8 \| `Many`→12 \| `Max`→16 |

Volume-surge gating for the visuals is separate from `Structure Events › Vol Surge` (which gates event *detection* and defaults to 20%).

## Splitter Grid

Param: `Chart Visuals › Splitter Grid` — `No | Auto | 30m | 1h | 2h | 4h | 8h | 1d | 1w` (default `Auto`).

- `No` → grid off; leftover grid objects are swept.
- `Auto` → step = **HTF1** timeframe (`HTF Auto 1`); e.g. 4H on a 15m chart, 1D on a 4H chart.
- Fixed steps: 2h/8h derive from the largest native timeframe that divides the step (2h = every 2nd 1h open, 8h = every 2nd 4h open), so lines stay on real bar boundaries (broker roll time).
- Grid object prefix: `SPLIT_` (legacy `H4SPLIT_`/`DSPLIT_` still swept).

Note: cTrader's **native** period separators are separate. The bot forces `Grid = false` and `PeriodSeparators = false` on 4H+ charts at runtime (they revert when the bot stops — remove them via Chart Settings → uncheck "Period separators"/"Grid" for a persistent change).

## On-chart panels

- **Chart toolbar (bottom-left)** — `_chartButtonPanel`: symbol/direction/orders-per-click combos, then (when a concrete entry symbol is selected) `B` `S` market, `B.l` `S.l` split-limit, `B.s` `S.s` stop; with open positions/orders also `SL -/+`, `TP -/+`, `Sync`, `C.30%` `C.50%` `C.all`, `C.order`; always `-` `+` (zoom days) and `R` (force refresh). Trade handlers print unfiltered `[Click]` diagnostics (entry + silent reject reasons) for debugging button/selection issues.
- `Panel_DBG` — dashboard at **bottom-right**: `v{version} {time}`, optional server line, and a single `Strategies: {runtime} | {session} | News: {news}` row. (Debug `E/M/D` rows removed.)
- `Panel_GATE` — risk table at top-center (`Day Loss`, `Drawdown`, `DD Mode`, `M. Trade Risk`, `M. Total Risk`, `Same idea Risk`), per risk template.
- **Symbol & TF summary** — top-right panel (`_chartSummaryPanel`) per chart toolbar symbol, showing live Win/Lose/Orders and **trend-bias cells** per timeframe:

  | Bias score | Meaning | Color |
  |---|---|---|
  | `+4` | Bullish break of structure (BOS) | Green |
  | `+3` | Bullish change of character (CHOCH) | Green |
  | `+2` | Bullish sweep reclaim / swing bias | Light green |
  | `+1` | Weak bullish (partial swing alignment) | Pale green |
  | `0` | Neutral / no clear bias | Gray |
  | `-1` | Weak bearish | Pale red |
  | `-2` | Bearish sweep / swing bias | Light red |
  | `-3` | Bearish CHOCH | Red |
  | `-4` | Bearish BOS | Red |

  The same scores appear in trade comments as `ltf:+N|htf:+N`.
- Divergence & trendlines draw solid, thickness 1, alpha 60. Divergence is an event: directional icon (`▲`/`▼` or `↑`/`↓` per Marker Symbol) + `▲ div`-style label.
- **HTF candle highlights** (background + HTF1/HTF2 boxes), per **last-completed** HTF candle (1D always, 4H when chart < 15m, NY 30m when chart ≤ 15m, plus the HTF1/HTF2 slots), bottom → top:
  1. **high & low guide lines** (thin solid, TF color) — always.
  2. **surrounding box** (green/red by candle direction, soft blurry fill) — always.
  3. **background HTF candle (wick + body)** drawn **on top of the box with lower alpha**, plus a `{tf}.{pattern}` label in the TF color (e.g. `4h.pin`, `1d.eng`) — **only when the completed candle matched a pattern**. Wicks + body are low-alpha **filled strips** (wick 16 / body 34, non-background ZIndex 5) so body vs wick separation is clearly visible above the blurry box.
  Frames already drawn by the background path are skipped by the HTF1/HTF2 path, so no frame is drawn twice.
  Alpha values (lower = blurrier): background candle body 24 / wick 14 / border 70; highlight box fill 30 / border 130; pattern body 34 / wick 16 / wick border 110 / body border 85; guide lines 65.
  `[HTFHL]` prints (unfiltered) the frame/index and the detected pattern per completed HTF candle.
  Mini-chart pattern markers use the **same pattern code** as the LTF highlight (via `ResolveMarkerPatternFallbackLabel` when the marker has no explicit label) — the generic `pat` fallback was removed.

## Related docs

- [integrations-storage.md](./integrations-storage.md) — MT5 bridge integration context
- [trading-backtests.md](./trading-backtests.md) — strategy/backtest engine context
