# Strategy Entry Models — Reference Guide

> Source-of-truth for `buildStrategyContext()`. Parsed at import time.
> Format: `## StrategyName` → description paragraph → `### Checklist` → `### Entry Models` → `#### ModelName`

---

## ICT
Inner Circle Trader methodology. Focuses on institutional order flow, liquidity engineering, and precision entry via PD arrays during London/NY killzone windows.

### Checklist
- [High] (Session) London or NY killzone active — London 02:00-05:00 EST / NY 07:00-10:00 EST
- [High] (Structure) HTF bias confirmed — D and 4H trend aligned in the same direction
- [High] (Structure) BOS or CHoCH confirmed on the execution timeframe (15M)
- [High] (PD_Arrays) Price in discount zone for buys (below 0.5 fib) or premium zone for sells (above 0.5 fib) of HTF swing range
- [High] (Liquidity) Draw on Liquidity (DOL) identified — unswept BSL/SSL or unfilled HTF FVG reachable within ADR
- [Medium] (PD_Arrays) Displacement candle present on LTF — strong impulsive move with visible imbalance (FVG) left behind
- [Medium] (Correlation) SMT divergence confirmed on correlated asset (e.g. FTSE vs DAX, DXY vs DJI)
- [Medium] (Risk) ADR not already exhausted — remaining daily range is sufficient to reach TP1
- [Low] (Risk) No high-impact news event within 30 minutes of planned entry

### Entry Models

#### OB + FVG Confluence
- **Trigger:** Price retraces into an OB zone (HTF or LTF) that contains an unfilled FVG. BOS already confirmed on 15M. Entry on 15M candle close inside OB with rejection wick present. The FVG inside the OB is the precise entry zone.
- **SL:** Below OB zone bottom for buys, above OB zone top for sells. Add 2-5 pip buffer beyond zone extreme.
- **TP:** TP1 = nearest LTF EQH/EQL. TP2 = HTF BSL/SSL. TP3 = HTF DOL target (PDH/PDL or weekly level).
- **Rules:** Must be in London or NY killzone. BOS must already be confirmed before entry — not anticipated.

#### Breaker Block Retest
- **Trigger:** A former bullish OB that price broke through becomes a bearish breaker (vice versa for bull). Price returns to retest the breaker zone. Entry on rejection candle close at the breaker boundary.
- **SL:** Beyond the breaker zone extreme by 3-5 pips.
- **TP:** TP1 = most recent swing high/low. TP2 = HTF FVG fill. TP3 = HTF liquidity pool.
- **Rules:** The original OB must have already been broken and flipped — not just tapped. Retest must respect the breaker zone.

#### Silver Bullet
- **Trigger:** VALID ONLY 10:00-11:00 AM EST. Displacement candle creates a FVG on 5M or 15M. Price retraces into that FVG. Entry on 5M candle close inside FVG. Do not enter if FVG was already fully filled before 10:00.
- **SL:** Below the low of the displacement candle that created the FVG (buy). Above the high for sells.
- **TP:** TP1 and TP2 within session range only. Do not hold Silver Bullet positions overnight.
- **Rules:** HARD TIME RULE: only valid between 10:00 and 11:00 AM EST. Outside this window this model is invalid regardless of setup quality.

#### Power of 3 (AMD)
- **Trigger:** Accumulation range identified in Asian session. London open creates manipulation leg — sweeps the range high (bear) or range low (bull) trapping early entries. 15M candle closes back inside the accumulation range. Entry on that close-back candle.
- **SL:** Beyond the manipulation sweep extreme + 5 pips.
- **TP:** TP targets are the opposing end of the daily range — the NY distribution leg completes the move.
- **Rules:** Entry only AFTER London manipulation leg completes and price closes back inside range. Never enter on the sweep itself. Asian accumulation range must be identifiable first.

#### Judas Swing
- **Trigger:** At London open, price makes a false directional move sweeping Asian session liquidity. 15M CHoCH forms confirming direction reversal. Entry on first pullback after CHoCH into a fresh 5M OB or FVG formed during the reversal.
- **SL:** Beyond the Judas swing extreme — the false move high/low.
- **TP:** NY session target levels — PDH, PDL, or weekly open on the opposite side.
- **Rules:** Entry only AFTER CHoCH confirms — never on the sweep itself. Session must be London open context (02:00-05:00 EST or overlap).

#### CISD (Change In State of Delivery)
- **Trigger:** A displacement candle on 5M/15M shifts price delivery from bearish to bullish (or reverse). The shifting candle becomes a micro OB. Entry on retest of that candle's open/body range — not a wick retest.
- **SL:** Below the CISD candle low for buys. Above the high for sells.
- **TP:** Next HTF PD array above (buy) or below (sell). Then HTF liquidity.
- **Rules:** Delivery state must visibly shift — impulsive candle with clear directional change. Body retest only, not wick.

#### Midnight Open Rejection
- **Trigger:** Price sweeps the 00:00 EST Midnight Open level. Rejection candle closes back through the level. Entry on the close of that candle.
- **SL:** Beyond the wick extreme that swept the Midnight Open.
- **TP:** Opposing session high/low or nearest HTF FVG in direction of rejection.
- **Rules:** Midnight Open level must be clearly identifiable at 00:00 EST. The sweep must be a wick — not a full candle body — through the level.

---

## SMC
Smart Money Concepts. Tracks institutional footprints via order blocks, imbalances, and liquidity grabs. Broader than ICT — valid outside strict killzone windows.

### Checklist
- [High] (Liquidity) HTF liquidity grab confirmed — price swept a visible EQH/EQL or PDH/PDL before reversing
- [High] (Structure) Structure break (BOS) confirmed on HTF in the direction of the trade
- [High] (PD_Arrays) Unmitigated order block identified on execution TF — fresh, not previously tapped
- [High] (PD_Arrays) FVG present between impulsive legs and overlaps or is adjacent to the OB entry zone
- [High] (Structure) HTF bias alignment — LTF setup direction agrees with D/4H trend
- [Medium] (Structure) CHoCH on LTF confirms reversal intent at or before the entry OB
- [Medium] (Candle_Patterns) Momentum or volume spike visible on the displacement candle
- [Low] (Risk) No opposing unmitigated OB or unfilled FVG blocking the TP path

### Entry Models

#### OB Mitigation Entry
- **Trigger:** Price returns to an unmitigated OB. A rejection candle (pin bar or engulfing) forms when price touches the 50% midpoint of the OB on 5M or 15M. Entry on close of that rejection candle.
- **SL:** Beyond the full OB zone extreme — not just the 50% level.
- **TP:** TP1 = opposing swing structure. TP2 = HTF imbalance fill. TP3 = HTF liquidity level.
- **Rules:** OB must be unmitigated — times_touched = 0. A previously tapped OB has reduced probability.

#### FVG Fill + Rejection
- **Trigger:** Price retraces into an open FVG. Entry when price touches the 50% midpoint of the FVG and a rejection wick forms on 15M close. The wick must not fully close beyond FVG boundaries.
- **SL:** Below/above the full FVG range — the complete gap boundary.
- **TP:** Previous swing high/low as TP1. HTF OB or liquidity as TP2/TP3.
- **Rules:** FVG must still be open — not already filled on any TF. Full fill before entry invalidates the model.

#### Liquidity Sweep Reversal
- **Trigger:** Price spikes through a visible EQH or EQL by 2-10 pips. Price immediately closes back below/above the EQH/EQL on the same candle or the next. Entry on that closing candle.
- **SL:** Beyond the wick extreme of the sweep candle.
- **TP:** Opposing liquidity pool. Then HTF OB or FVG.
- **Rules:** Overshoot must be small (2-10 pips / 0.05-0.2%). A large break-through is a breakout, not a sweep reversal.

#### BOS Retest
- **Trigger:** A candle body closes cleanly beyond a key swing high or low (confirmed BOS — body close required, not just a wick). Price returns to retest the broken level. A rejection candle forms at the retest. Entry on close.
- **SL:** Beyond the retest zone by 3-5 pips.
- **TP:** Next major structural liquidity above (buy) or below (sell).
- **Rules:** BOS requires a full candle body close beyond the swing — wick-only breaks do not qualify. Retest must touch the former swing level.

---

## Price Action
Pure candlestick and price structure reading without indicators. Focuses on key level reactions, candlestick pattern psychology, and trend context.

### Checklist
- [High] (Structure) HTF trend context clear — D/4H showing consistent HH/HL sequence (bull) or LH/LL sequence (bear)
- [High] (PD_Arrays) Price reacting at a defined key S/R level — not in the middle of a range
- [High] (Candle_Patterns) Candlestick confirmation present at the level (pin bar, engulfing, or inside bar)
- [High] (Risk) RR meets or exceeds the configured minimum
- [Medium] (Risk) No high-impact scheduled news within 30 minutes of entry
- [Medium] (Candle_Patterns) Volume supports the move — confirmation candle has higher volume than preceding candles (if available)
- [Low] (Structure) Pattern not forming inside a choppy/ranging HTF environment — trend must be established

### Entry Models

#### Pin Bar Rejection
- **Trigger:** Candle wick is more than 2x the body size. Wick pierces into the key level, body closes away. Entry on open of the next candle, or on retest of the pin bar 50% body level.
- **SL:** Beyond the pin bar wick tip — the absolute extreme of the rejection.
- **TP:** TP1 = next key S/R level. TP2/TP3 = HTF swing high/low or DOL.
- **Rules:** Wick-to-body ratio must be confirmed — small pin bars at non-key levels do not qualify. The level must be pre-identified, not drawn after the fact.

#### Engulfing at Structure
- **Trigger:** Current candle body fully engulfs the previous candle body at a key HTF level. Must close decisively beyond the prior candle's body. Entry on close or on retest of the engulfing candle midpoint.
- **SL:** Beyond the low (bull engulf) or high (bear engulf) of the engulfing candle.
- **TP:** Nearest opposing structure level as TP1. HTF swing targets for TP2/TP3.
- **Rules:** Body engulf only — the current candle body must exceed the prior body on both sides. Wick-to-wick engulf alone is insufficient.

#### Inside Bar Breakout
- **Trigger:** Current candle full range is contained within the prior candle (mother bar). Entry on the breakout candle that closes beyond the mother bar high (buy) or low (sell).
- **SL:** Opposite side of the mother bar — beyond mother bar low for buys, above high for sells.
- **TP:** TP1 = 1x mother bar range projected. TP2 = 2x projection or next S/R.
- **Rules:** Mother bar must be identifiable as a consolidation — not a small candle inside a trend. Inside bar low/high must not have been breached before breakout.

#### Fakey (False Breakout)
- **Trigger:** An inside bar forms at a key level. Price breaks out beyond the mother bar trapping breakout traders, then reverses and closes back inside the mother bar range within 1-2 candles. Entry on the candle that closes back inside.
- **SL:** Beyond the false break wick extreme — the furthest point of the failed breakout.
- **TP:** Opposing side of the mother bar (TP1) and prior swing beyond it (TP2).
- **Rules:** Inside bar must have formed FIRST before the false breakout. The reverse-back candle must close INSIDE the mother bar range — not just retrace.

#### Quasimodo (QM)
- **Trigger:** In uptrend: price makes HH then fails to make a higher low — instead forms a lower low. Entry at retest of the last HL (now resistance). Mirror for downtrend.
- **SL:** Beyond the failed HH extreme (buy QM) or failed LL extreme (sell QM).
- **TP:** TP1 = the LL that confirmed QM. TP2 = next major S/R below.
- **Rules:** QM requires a prior established trend with at least 2 HH/HL (bull) or LH/LL (bear) before the failure. The lower low must be confirmed — not just forming.

#### V-Shape Reversal
- **Trigger:** Sharp impulsive drop with no consolidation. Within 1-2 candles a recovery candle closes above the 50% midpoint of the drop. Entry on the close of the recovery candle.
- **SL:** Below the absolute low of the V-shape reversal.
- **TP:** Full retracement to the origin of the drop. HTF resistance as TP2.
- **Rules:** Drop must be sharp and impulsive — gradual declines do not produce valid V-shapes. Recovery must happen quickly (1-2 candles). Slow recoveries are retracements, not reversals.

---

## Market Structure
Reads market through swing high/low sequences. Trend confirmed via BOS/CHoCH chains across timeframes. Entries inside premium/discount zones aligned with institutional narrative.

### Checklist
- [High] (Structure) HTF narrative clear — consistent BOS sequence confirms trend on D and 4H timeframes
- [High] (Structure) BOS/CHoCH sequence valid and unbroken on execution timeframe (15M)
- [High] (PD_Arrays) Entry in discount zone for buys or premium zone for sells relative to swing range
- [High] (Liquidity) DOL target mapped — next unswept liquidity pool reachable within ADR
- [High] (Structure) No conflicting structure on intermediate TF — e.g. 1H not opposing 15M direction
- [Medium] (Fibonacci) Retracement proportional — not overextended beyond 0.79 fib of last impulsive leg
- [Medium] (Candle_Patterns) Momentum of the most recent structural move confirms entry direction

### Entry Models

#### BOS + Retest
- **Trigger:** A candle body closes clearly beyond a key swing high/low confirming BOS. Price then returns to retest the broken structural level. A rejection candle forms at the retest zone. Entry on close of that rejection candle.
- **SL:** Beyond the retest zone extreme by 3-5 pips.
- **TP:** TP1 = next swing high/low in BOS chain direction. TP2/TP3 = HTF liquidity and DOL.
- **Rules:** BOS requires body close beyond the swing — wick-only breaks do not confirm BOS. Retest must touch the former swing level and show rejection, not just approach it.

#### CHoCH Entry
- **Trigger:** First CHoCH forms after an established trend — first higher high in a downtrend or first lower low in an uptrend. LTF pullback to CHoCH origin where a fresh OB or FVG has formed. Entry at that zone on rejection.
- **SL:** Below the CHoCH swing low that triggered the structural change (buy). Above for sells.
- **TP:** TP1 = previous significant swing high. TP2/TP3 = HTF BOS targets above.
- **Rules:** Requires a prior established trend to change FROM — CHoCH is not valid in ranging markets. Must be the FIRST CHoCH of the reversal, not a continuation CHoCH.

#### EQH/EQL Sweep + Reverse
- **Trigger:** Two or more swing highs/lows at nearly the same price create visible EQH/EQL liquidity. Price spikes through them by a small margin. Next candle immediately closes back through the EQH/EQL. Entry on that closing candle.
- **SL:** Beyond the sweep wick extreme — highest/lowest point of the spike.
- **TP:** TP1 = opposing EQL/EQH. TP2/TP3 = HTF structural targets.
- **Rules:** EQH/EQL requires at least 2 visible price touches at approximately the same level. Overshoot must be small — a large break is a breakout not a sweep.

#### MSB Confirmation
- **Trigger:** Major Structure Break (MSB) already confirmed on HTF (D or 4H) — a significant swing break that changes macro trend. LTF (15M) shows CHoCH in same direction. Entry on LTF pullback after CHoCH into fresh LTF OB or FVG.
- **SL:** Below the LTF CHoCH swing low (buy) or above CHoCH swing high (sell).
- **TP:** HTF structural targets from the MSB measured move.
- **Rules:** HTF MSB must ALREADY be confirmed — not anticipated. Do not use this model to predict MSBs. LTF CHoCH must align directionally with the HTF MSB.

#### Displacement + Rebalance
- **Trigger:** Strong impulsive candle sequence leaves a visible FVG (gap between candle 1 high and candle 3 low, or vice versa). Entry when price retraces to the 50% midpoint of that FVG with a rejection visible on 5M.
- **SL:** Below the full FVG range — below the lowest point of the gap for buys.
- **TP:** TP1 = prior swing high/low before displacement. TP2/TP3 = HTF liquidity.
- **Rules:** FVG must be created by an impulsive move — not by a small choppy candle. The gap must be clearly visible — no candle body fills the gap between creation candles.

---

## Wyckoff
Volume-price relationship methodology. Identifies institutional accumulation and distribution cycles via Wyckoff schematics. Volume confirmation is mandatory for every signal.

### Checklist
- [High] (Structure) Wyckoff phase clearly identified — Accumulation, Markup, Distribution, or Markdown — with supporting volume evidence
- [High] (Candle_Patterns) Spring (accumulation) or Upthrust (distribution) event confirmed with volume signature
- [High] (Candle_Patterns) Volume confirmation present — spike on spring/upthrust, volume dry-up on subsequent test
- [High] (Structure) Sign of Strength (SOS) or Sign of Weakness (SOW) candle visible
- [Medium] (Structure) Markup or Markdown phase continuation aligns with entry direction
- [Medium] (Risk) No climactic volume against the trade direction in the last 10 candles

### Entry Models

#### Spring Reversal
- **Trigger:** Price breaks below the support zone (BC/SC area) on declining volume — the Spring. Price immediately recovers back above support. A Test of the Spring follows on very low volume with a higher low. Entry on close of the Test candle.
- **SL:** Below the Spring low — the absolute lowest point of the spring wick.
- **TP:** TP1 = UAR (Upper Area of Resistance — top of the trading range). TP2 = prior swing high above the range.
- **Rules:** Volume on the Spring break must be declining or climactic — not expanding. Test candle volume must be clearly lower than the Spring candle volume.

#### LPS Entry (Last Point of Support)
- **Trigger:** After a Sign of Strength breaks above resistance, price pulls back to the Last Point of Support — former resistance now acting as support. Volume declines on pullback. Entry on rejection candle at LPS zone.
- **SL:** Below the LPS zone low.
- **TP:** Measured move from the Trading Range depth projected upward from the LPS.
- **Rules:** SOS must already be confirmed before looking for LPS. Volume must decline on the pullback to LPS — high-volume pullbacks are warning signs.

---

## EMA Trend
Trend-following using EMA stack alignment. Entries on pullbacks to the EMA zone in the direction of the established trend.

### Checklist
- [High] (Structure) EMA stack aligned on HTF — fast EMA above slow EMA (bull) or below (bear) on D or 4H
- [High] (PD_Arrays) Price has pulled back to the fast EMA zone — not extended far above/below
- [High] (Candle_Patterns) Trend continuation candle forms at EMA zone — pin bar or engulfing touching EMA
- [Medium] (Indicators) Momentum confirms — RSI above 50 for bull entries, below 50 for bear entries
- [Medium] (Risk) ADR expanding, not contracting — avoid entries in tightening range environments

### Entry Models

#### EMA Pullback Continuation
- **Trigger:** Price in established uptrend pulls back to touch or slightly pierce the fast EMA. A rejection candle (pin bar or engulfing) forms at the EMA. Entry on close of that rejection candle. Fast EMA must be above slow EMA.
- **SL:** Below the slow EMA plus a small buffer — not just below the fast EMA.
- **TP:** TP1 = previous swing high. TP2/TP3 = next HTF resistance levels.
- **Rules:** EMA stack must be confirmed — fast above slow (bull), fast below slow (bear). A recent EMA cross makes this model invalid until stack is re-established.

#### EMA Cross Retest
- **Trigger:** Fast EMA crosses above the slow EMA (bull) or below (bear) — a trend shift signal. Price rallies then pulls back to retest the cross zone. Entry on rejection candle at the cross zone.
- **SL:** Beyond the cross zone — below the slow EMA for bull cross entries.
- **TP:** TP1 = 1.5-2x SL distance. TP2/TP3 = next S/R levels.
- **Rules:** Cross must be confirmed — the fast EMA must have closed on the other side of the slow EMA. The retest must respect the cross zone, not simply drift back through.

---

## Breakout
Identifies clearly defined consolidation ranges and enters on confirmed candle body breakout, validated by retest hold.

### Checklist
- [High] (Structure) Range clearly defined — at least 3 touches on both upper and lower boundaries
- [High] (Candle_Patterns) Breakout candle body closes decisively beyond range boundary — wick-only breakouts do not qualify
- [High] (Structure) Retest of broken boundary holds — at least one candle closes back on the breakout side
- [Medium] (Candle_Patterns) Volume expands on the breakout candle relative to average range candles
- [Medium] (Risk) No major HTF S/R level sitting immediately beyond the breakout point

### Entry Models

#### Breakout Retest Entry
- **Trigger:** Price breaks range boundary with a candle body close. Price pulls back to retest the boundary. A rejection candle confirms the level holds. Entry on close of confirmation candle at the retest.
- **SL:** Back inside the range — beyond the breakout boundary on the range side.
- **TP:** TP1 = 1x range height from breakout point. TP2 = 1.5-2x.
- **Rules:** Range must have at least 3 touches on each boundary — 2-touch ranges are too weak. Retest candle must close on the breakout side, not just touch and reverse.

#### Anticipatory Breakout
- **Trigger:** Price compressing near the boundary with progressively smaller candle bodies (triangle/wedge). Entry on the candle that closes beyond the boundary — no retest wait. Only when compression is extreme and momentum is building.
- **SL:** Back to the range midpoint — wider than retest entry due to no confirmation.
- **TP:** Range height measured from first boundary touch, projected from entry.
- **Rules:** Use only when compression is clear and candle bodies are visibly shrinking over 5+ candles. Avoid if compression is not obvious — use Breakout Retest Entry instead.

---

## VWAP
Session-anchored VWAP used as dynamic institutional reference. Entries on VWAP reclaim or rejection with supporting PD array or S/R confluence.

### Checklist
- [High] (Structure) Session VWAP bias clear — price spending majority of session above VWAP (bull) or below (bear)
- [High] (Candle_Patterns) VWAP reclaim candle (bull) or VWAP rejection candle (bear) confirmed with candle close
- [High] (Session) Correct session VWAP used — anchored to current session open, not prior session
- [Medium] (PD_Arrays) VWAP level coincides with nearby S/R, OB, or FVG — not VWAP alone
- [Medium] (Risk) SL placed beyond VWAP standard deviation band, not just the VWAP line

### Entry Models

#### VWAP Reclaim
- **Trigger:** In a bullish session, price temporarily dips below VWAP. A candle then closes back above VWAP — the reclaim. Entry on that reclaim close, ideally at a confluence zone (OB or S/R near VWAP).
- **SL:** Below the low of the reclaim candle.
- **TP:** TP1 = VWAP +1 standard deviation band. TP2 = session high or prior swing.
- **Rules:** Session must have established a bullish bias before the dip. A session that opened below VWAP and has not reclaimed it is not a reclaim setup.

#### VWAP Rejection
- **Trigger:** In bearish session (price below VWAP), price rallies to VWAP. A rejection candle closes back below VWAP. Entry on that close.
- **SL:** Above VWAP plus a small buffer.
- **TP:** TP1 = session low. TP2 = VWAP -1 standard deviation.
- **Rules:** Session must have established a bearish bias below VWAP. Rally to VWAP must be a retracement, not a trend change. If price reclaims VWAP convincingly, this setup is invalid.
