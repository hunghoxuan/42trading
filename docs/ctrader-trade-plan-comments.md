# Trade Plan comments

Every new strategy order carries the exact effective Trade Plan selection in its broker comment:

`<plan>.<leg>-<bars>`

Examples: `Now.1-1`, `Wait_BetterEntry.1-5`, `WaitConfirm.1-5`, and `WaitConfirm_Wick_L08_R3.2-5`.

- `plan`: the selected Trade Plan value, including any strategy-specific effective override.
- `leg`: the split leg within that plan, starting at 1; this is not the Trade Plan slot number.
- `bars`: bars from the original pattern end to the confirmation; immediate plans use 1.

## Separate executions

As of `v2026.11.02 - trade-plan-comments`, Wait_BetterEntry and WaitConfirm plans submit their own protected orders. They no longer increase the volume of a matching Now position. This gives each execution its own immutable broker comment, entry price, protection and exit lifecycle. The original Now position keeps its volume, comment and protection. Each plan continues to share the configured parent risk allocation with the other enabled plan slots and split legs. Normal account/idea risk, session, confluence and position-cap checks still apply.

Successful broker acceptance records the delayed action as consumed, before protection verification and post-entry reporting; unsuccessful submissions do not consume the action key. Logs use `[Strategy] TradePlan` with MATCHED, BLOCKED and ACCEPTED stages, the exact plan token, and the accepted ticket/comment.

Historical positions and already-running backtests retain their existing comments and execution behavior. The new behavior requires a run started with the updated build. This change does not alter the confirmation window, eligibility rules, Orders Expiry selection, or parameter choices.

cTrader exposes [Position.Comment](https://help.ctrader.com/ctrader-algo/references/Trading/Positions/Position/Comment/) as a getter; modifying an existing position cannot replace its comment.

## Wait_flip

Available in Trade Plan 1, 2 and 3, beside Wait_BetterEntry. Saved numeric value: 1301; all existing plan IDs/defaults are unchanged. Strategy JSON settings accept `Wait_flip` through the same plan parser.

Wait_flip uses the same candle confirmation and Sequence/Window Size as Wait_BetterEntry, evaluated against the original strategy direction. It does not require another directional event (WaitConfirm does). Only after confirmation does it reverse the planned execution side: with Signal Direction = Original, a qualified BUY becomes SELL and SELL becomes BUY. It submits a separate protected order with `Wait_flip.1-n` (and the corresponding leg number for split entries).

Reversal uses the existing Now_flip direction/protection resolver, including the reverse wick, configured SL buffer and selected TP. The plan reversal composes with Signal Direction and Adaptive Bias in the same way as Now_flip: another Flip cancels it. Session, confluence, directional-strategy, position and risk gates remain authoritative; a missing valid stop rejects the trade. No opposite position is closed just because this plan confirms.

## Directional wait and exit plans

Build `v2026.11.02 - trade-plan-exits` offers this compact menu in Trade Plan 1, 2 and 3:

`No`, `Now`, `Now_flip`, `Wait_BetterEntry`, `Wait_flip`, `Wait_DirectionConfirm`, `WaitConfirm`, `OnExit_cont`, `OnExit_flip`, `OnTP_cont`, `OnTP_flip`, `OnSL_cont`, `OnSL_flip`.

### Wait_BetterEntry

This is the renamed **Wait**, retaining saved value 617 and its original behavior. BUY waits for a green confirmation candle whose entire range is below the original candle; SELL waits for a red candle wholly above it. Old numeric native presets retain the selection; the shared JSON parser accepts the old textual `Wait` and legacy `Wait_*` presets as aliases. Old native presets using enum names may need `Wait` reselected as `Wait_BetterEntry`.

### Wait_DirectionConfirm

BUY requires a green candle closing strictly above the original candle's high. SELL requires a red candle closing strictly below its low. A wick may overlap the original range; doji candles and closes exactly on the boundary do not confirm. It uses the existing Sequence/Window Size and first-eligible, closed-bar freshness rules. Confirmation uses the expected execution side after Signal Direction and Adaptive Bias; the detector retains its original side for its strategy rules. A directional breakout does not inherit the better-entry route's 1R chase cap; configured SL/TP, risk sizing and account exposure gates still apply.

### OnExit direction rules

| Closed trade | Reason | OnExit_cont | OnExit_flip |
| --- | --- | --- | --- |
| SELL | SL | BUY | SELL |
| SELL | TP | SELL | BUY |
| BUY | TP | BUY | SELL |
| BUY | SL | SELL | BUY |

These use the broker's TP/SL reason, regardless of net profit. A profitable trailing-stop or break-even SL close still follows the SL row. Manual closes, partial closes and stop-outs do not trigger them. The explicit exit mapping is not flipped again by Signal Direction or Adaptive Bias; adaptive sizing/reduced-risk rules remain applicable.

An entry plan or an existing owned position must seed an exit plan. OnExit choices do not create trades directly from strategy signals. A verified position from this cBot instance triggers one protected replacement for each selected OnExit slot. Each original entry position may trigger each matching exit slot once, after it fully closes. A follow-up never triggers another exit trade, even in its own slot. Initial split positions may each trigger their own one-time follow-up. Duplicate callbacks do not create additional orders.

The source strategy, symbol and source timeframe are preserved. New orders use the configured entry, SL, buffer, TP, exit management and shared risk allocation. Current session, confluence, directional-strategy and mandatory risk/profit checks remain authoritative. A fresh detector/AND/sequence event is not required because the broker exit is the trigger. Exit callbacks queue their follow-ups for the shared scheduler. Definite temporary submission failures have bounded retries; blocked exits do not reopen later outside the original event. Explicit OnExit handling takes precedence over the legacy SL-only Exit Management reversal to prevent duplicate orders.

Comments identify the exact plan (`OnExit_cont.1-1` or `OnExit_flip.1-1`), `exit_slot`, parent `from` ticket, and `exit:TP`/`exit:SL`. New strategy submissions carry a persisted instance `owner` token; manual trades, other instances and unowned positions from older builds are not adopted. Duplicate close callbacks are consumed, and accepted exit groups participate in the existing instance journal. Backtests isolate ownership and persistence from live instances.

SL/indicator decisions use the latest available completed source candle at the exit time; time restrictions use the actual exit clock. Later/future prices cannot alter that earlier decision. OnExit orders appear in the separate broker fill/exit marker layer; they do not fabricate market-data event boxes or historical predictions.

The feature requires `TVBridge_CTrader.TradePlans.cs` and `TVBridge_CTrader.Execution.cs` beside the other six files in both the repository and active native build directory. See [shared execution management](ctrader-shared-execution.md) for policy snapshots, ownership, retries and recovery.

## TP-only / SL-only plans and naming (2026-11-04)

All Trade Plan menus and newly submitted trade comments use `_cont` and `_flip`.
`NowReverse` is now `Now_flip`; `WaitReverse` is `Wait_flip`. The existing
`OnExit_Continue` / `OnExit_Reverse` choices are `OnExit_cont` / `OnExit_flip`.
Numeric IDs 1300–1304 are preserved. New choices use IDs 1305–1308.

| Plan | Trigger | Closed BUY becomes | Closed SELL becomes |
|---|---|---|---|
| OnTP_cont | TP only | BUY | SELL |
| OnTP_flip | TP only | SELL | BUY |
| OnSL_cont | SL only | SELL | BUY |
| OnSL_flip | SL only | BUY | SELL |

Continue follows the price direction that produced the TP/SL exit; flip takes
the opposite direction. The broker close reason remains authoritative, including
a profitable trailing-stop exit classified as SL. Nonmatching reasons create no
queued action and do not fall back to legacy SL reversal. A follow-up never
creates another exit trade. Ordinary/manual close reasons
never trigger these plans. All six exit plans share the scheduler, ownership,
protection, risk, expiry and duplicate-action management.

Strategy JSON, saved execution policies and restored exit jobs accept the old
plan names; `OnTP_Reversve` / `OnSL_Reversve` are accepted input aliases too. New
output is canonical. Existing broker/history comments are immutable and retain
the names originally submitted.

## Broker comment limit (2026-11-04)

Build `v2026.11.04 - broker-comment-identity` recognizes stamped strategy
comments independently of the optional descriptive TP/SL tail. Instance 4's
100-character broker comments had lost that tail, so the previous classifier
silently skipped trailing management and exit plans.

New stamped comments fit within 100 characters. When shortening is necessary,
`o` means owner, `a` means action, and `x` means exit slot; `cfg`, `from` and
`exit` retain their names. The direction, timeframe, exact plan and required
identity/chain fields are preserved. Verbose event suffixes can be shortened;
full event evidence remains in `TradeEvidenceJson`. For example:

`B|m5.bias_align|OnSL_flip.1-1|o:BACKTEST|cfg:abcdefghijkl|a:mnopqrstuvwx|x:2|from:2|exit:SL`

Older long-key comments remain readable, including broker-truncated comments
whose owner, cfg and action fields survived. Ownership checks still reject
foreign or unowned exit parents. Exit action status/rejection logs bypass the
normal log filter so an absent follow-up has a visible reason. A backtest
already running the old assembly needs a new run to use the fix.

## Exit protection choices (2026-11-04)

Build `v2026.11.04 - exit-protection-modes` pairs each TP/SL exit plan:

| Auto/Scalp stop | Swing stop |
| --- | --- |
| OnExit_cont | OnExit_cont_Swing |
| OnExit_flip | OnExit_flip_Swing |
| OnTP_cont | OnTP_cont_Swing |
| OnTP_flip | OnTP_flip_Swing |
| OnSL_cont | OnSL_cont_Swing |
| OnSL_flip | OnSL_flip_Swing |

The plan owns its SL family: standard exit plans use the shared Auto_Scalp
resolver (5-candle extreme / far EMA); Swing variants use the configured,
confirmed source-timeframe Swing resolver. They do not need the parent's
pattern, event invalidation or original SL. Direction and TP/SL trigger
mappings are unchanged. The current strategy/shared TP, SL Buffer, entry,
risk, expiry and exit-management settings still apply.

First use a valid protective level relative to the new entry. If price has
already crossed all candidate levels, calculate the same family's raw SL
distance relative to the latest completed source candle's close and shift
that distance to the entry. A shifted Swing stop is a swing-derived distance,
not the old swing's absolute price. This is marked `Reanchored` in the internal
protection source. Broker minimum distance is respected and SL Buffer applies
once afterward. The forming candle and future data never determine the stop.

Missing/flat history or a missing confirmed swing still rejects the order;
there is no unprotected entry or invented fixed-price fallback. Exit action
logs identify `exit_stop_unavailable:<family>` where no usable plan exists.
Trade comments retain the selected name, for example
`OnSL_flip_Swing.1-1`. Very long identity/parent combinations can shorten
`from` to `p` and `exit` to `e` to stay within the 100-character broker limit;
long and short keys remain readable.

## Exit submission minimum (2026-11-04)

Build `v2026.11.04 - exit-minimum-stop` aligns automatic exit trades with the
shared creation gate's current minimum stop distance. Causal plans use a
historical spread floor; the execution gate uses the current spread/ATR floor.
Instance 4 therefore produced valid directional stops that were still rejected
as too close at submission (for example 27 pips versus a 30-pip minimum).

After planning, SL Buffer and any marketable-pending conversion, exit plans
widen an insufficient SL outward to the current required distance plus one
tick. RR-based TP is recalculated from the final SL. RR below 1 also reserves
enough SL distance for TP to clear the same minimum. Non-RR target selections
retain their original target and its normal validation. Position volume is
calculated afterward from the final stop and the existing risk allocation.
The shared creation/broker gates still validate the result; the global
`OnSlTpError=Reject` policy and ordinary strategy entry levels are unchanged.
Adjustments are visible as `[Execution] Exit protection widened ...`.

The earlier native minimum-stop verification exposed recursive chains (parent #4
created #5, then #5 created #6). The original-only policy below supersedes that
lifecycle; #5 must never seed #6. History comments retain `OnSL_flip.1-1`,
`x:2`, and the original `from` parent. A saved verification snapshot contains the broker
create/stop events, final SL/TP/volume and accepted exit journal entries.

## Original positions only (2026-11-04)

Build `v2026.11.04 - exit-original-only` makes every OnTP/OnSL/OnExit plan,
including cont/flip and Swing variants, a single-generation follow-up.

- An original Now, Now_flip or Wait entry must fully close by TP or SL first.
- Each matching configured exit slot can submit once for that original position.
- Its child cannot trigger its own exit slot, another exit slot, or a legacy SL
  reversal, even when settings change after the child was opened.
- Partial closes, manual closes and duplicate callbacks retain their normal guards.

Descendants are identified by parent/exit metadata, exit-plan names (including
old aliases and truncated comments), and legacy reversal markers. The close
callback, queue, persisted-job recovery and final execution stage enforce the
same original-parent rule. Queued jobs retain the original parent's identity;
old jobs need recoverable broker-history evidence and otherwise fail closed.
SL/TP planning, current minimum distance, RR targets and risk sizing retain
the existing behavior.
