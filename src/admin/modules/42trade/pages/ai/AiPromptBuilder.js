import TRADE_PLAN_SCHEMA from "../../../../../config/schema/trade.json";
import ANALYSIS_SCHEMA from "../../../../../config/schema/analysis.json";
import GUIDE_SYSTEM from "../../../../../config/guide/system.md?raw";
import SCHEMA_CONFIG from "../../../../../config/config.json";

// Merge analysis.json into trade_plan_schema.analysis (backend does this at runtime too)
const MERGED_TRADE_PLAN_SCHEMA = {
  ...TRADE_PLAN_SCHEMA,
  analysis: ANALYSIS_SCHEMA,
};

// AI Prompt Builder — constants and functions for building AI analysis prompts

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY OPTIONS (from src/config/config.json — underscore → space for display)
// ─────────────────────────────────────────────────────────────────────────────

function configToDisplay(s) {
  return String(s || "").replace(/_/g, " ");
}

export const STRATEGY_OPTIONS = (SCHEMA_CONFIG.strategy || []).map(configToDisplay);
export const ORDER_SIDES = SCHEMA_CONFIG.order_side || ["BUY", "SELL"];
export const TF_WEIGHTS = SCHEMA_CONFIG.timeframe_weights || {};
export const DEFAULT_TF_TABS = SCHEMA_CONFIG.default_tf_tabs || ["ENTRY","1m","5m","15m","1h","4h","d","W"];
export const DEFAULT_WATCHLIST = [];

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY → ENTRY MODELS → CHECKLIST
//
// RELATIONSHIP:
//   Strategy    = the framework that defines HOW you read the market.
//                 Owns the checklist — gate conditions evaluated BEFORE
//                 any entry model is considered.
//   Checklist   = strategy-level gate. Scored by weight:
//                   High   = 3 pts. Blocker if failed.
//                   Medium = 2 pts. Reduces score only.
//                   Low    = 1 pt.  Minor supporting evidence.
//   Entry Model = the specific trigger pattern within that strategy.
//                 Only evaluated AFTER checklist gate is passed.
//
// GATE RULE:
//   high_weight_passed / high_weight_total >= 0.75 → scan entry models
//   If gate fails → no trade plan regardless of total score
//
// SCORE → RISK TIER:
//   >= 85 → risk 1.0% (Grade A requires RR >= min_rr * 1.5)
//   65–84 → risk 0.5% (Grade B requires RR >= min_rr)
//   50–64 → risk 0.25% (Grade C — marginal, consider skipping)
//   < 50  → no trade
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_ENTRY_MODELS = {
  ICT: {
    description:
      "Inner Circle Trader methodology. Focuses on institutional order flow, liquidity engineering, and precision entry via PD arrays during London/NY killzone windows.",
    checklist: [
      {
        description:
          "London or NY killzone active — London 02:00-05:00 EST / NY 07:00-10:00 EST",
        weight: "High",
        category: "Session",
      },
      {
        description:
          "HTF bias confirmed — D and 4H trend aligned in the same direction",
        weight: "High",
        category: "Structure",
      },
      {
        description: "BOS or CHoCH confirmed on the execution timeframe (15M)",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Price in discount zone for buys (below 0.5 fib) or premium zone for sells (above 0.5 fib) of HTF swing range",
        weight: "High",
        category: "PD_Arrays",
      },
      {
        description:
          "Draw on Liquidity (DOL) identified — unswept BSL/SSL or unfilled HTF FVG reachable within ADR",
        weight: "High",
        category: "Liquidity",
      },
      {
        description:
          "Displacement candle present on LTF — strong impulsive move with visible imbalance (FVG) left behind",
        weight: "Medium",
        category: "PD_Arrays",
      },
      {
        description:
          "SMT divergence confirmed on correlated asset (e.g. FTSE vs DAX, DXY vs DJI)",
        weight: "Medium",
        category: "Correlation",
      },
      {
        description:
          "ADR not already exhausted — remaining daily range is sufficient to reach TP1",
        weight: "Medium",
        category: "Risk",
      },
      {
        description:
          "No high-impact news event within 30 minutes of planned entry",
        weight: "Low",
        category: "Risk",
      },
    ],
    entry_models: [
      {
        name: "OB + FVG Confluence",
        trigger:
          "Price retraces into an OB zone (HTF or LTF) that contains an unfilled FVG. BOS already confirmed on 15M. Entry on 15M candle close inside OB with rejection wick present. The FVG inside the OB is the precise entry zone.",
        sl_logic:
          "Below OB zone bottom for buys, above OB zone top for sells. Add 2-5 pip buffer beyond zone extreme.",
        tp_logic:
          "TP1 = nearest LTF EQH/EQL. TP2 = HTF BSL/SSL. TP3 = HTF DOL target (PDH/PDL or weekly level).",
        consistency_rules:
          "Must be in London or NY killzone. BOS must already be confirmed before entry — not anticipated.",
      },
      {
        name: "Breaker Block Retest",
        trigger:
          "A former bullish OB that price broke through becomes a bearish breaker (vice versa for bull). Price returns to retest the breaker zone. Entry on rejection candle close at the breaker boundary.",
        sl_logic: "Beyond the breaker zone extreme by 3-5 pips.",
        tp_logic:
          "TP1 = most recent swing high/low. TP2 = HTF FVG fill. TP3 = HTF liquidity pool.",
        consistency_rules:
          "The original OB must have already been broken and flipped — not just tapped. Retest must respect the breaker zone.",
      },
      {
        name: "Silver Bullet",
        trigger:
          "VALID ONLY 10:00-11:00 AM EST. Displacement candle creates a FVG on 5M or 15M. Price retraces into that FVG. Entry on 5M candle close inside FVG. Do not enter if FVG was already fully filled before 10:00.",
        sl_logic:
          "Below the low of the displacement candle that created the FVG (buy). Above the high for sells.",
        tp_logic:
          "TP1 and TP2 within session range only. Do not hold Silver Bullet positions overnight.",
        consistency_rules:
          "HARD TIME RULE: only valid between 10:00 and 11:00 AM EST. Outside this window this model is invalid regardless of setup quality.",
      },
      {
        name: "Power of 3 (AMD)",
        trigger:
          "Accumulation range identified in Asian session. London open creates manipulation leg — sweeps the range high (bear) or range low (bull) trapping early entries. 15M candle closes back inside the accumulation range. Entry on that close-back candle.",
        sl_logic: "Beyond the manipulation sweep extreme + 5 pips.",
        tp_logic:
          "TP targets are the opposing end of the daily range — the NY distribution leg completes the move.",
        consistency_rules:
          "Entry only AFTER London manipulation leg completes and price closes back inside range. Never enter on the sweep itself. Asian accumulation range must be identifiable first.",
      },
      {
        name: "Judas Swing",
        trigger:
          "At London open, price makes a false directional move sweeping Asian session liquidity. 15M CHoCH forms confirming direction reversal. Entry on first pullback after CHoCH into a fresh 5M OB or FVG formed during the reversal.",
        sl_logic: "Beyond the Judas swing extreme — the false move high/low.",
        tp_logic:
          "NY session target levels — PDH, PDL, or weekly open on the opposite side.",
        consistency_rules:
          "Entry only AFTER CHoCH confirms — never on the sweep itself. Session must be London open context (02:00-05:00 EST or overlap).",
      },
      {
        name: "CISD (Change In State of Delivery)",
        trigger:
          "A displacement candle on 5M/15M shifts price delivery from bearish to bullish (or reverse). The shifting candle becomes a micro OB. Entry on retest of that candle's open/body range — not a wick retest.",
        sl_logic:
          "Below the CISD candle low for buys. Above the high for sells.",
        tp_logic:
          "Next HTF PD array above (buy) or below (sell). Then HTF liquidity.",
        consistency_rules:
          "Delivery state must visibly shift — impulsive candle with clear directional change. Body retest only, not wick.",
      },
      {
        name: "Midnight Open Rejection",
        trigger:
          "Price sweeps the 00:00 EST Midnight Open level. Rejection candle closes back through the level. Entry on the close of that candle.",
        sl_logic: "Beyond the wick extreme that swept the Midnight Open.",
        tp_logic:
          "Opposing session high/low or nearest HTF FVG in direction of rejection.",
        consistency_rules:
          "Midnight Open level must be clearly identifiable at 00:00 EST. The sweep must be a wick — not a full candle body — through the level.",
      },
    ],
  },

  SMC: {
    description:
      "Smart Money Concepts. Tracks institutional footprints via order blocks, imbalances, and liquidity grabs. Broader than ICT — valid outside strict killzone windows.",
    checklist: [
      {
        description:
          "HTF liquidity grab confirmed — price swept a visible EQH/EQL or PDH/PDL before reversing",
        weight: "High",
        category: "Liquidity",
      },
      {
        description:
          "Structure break (BOS) confirmed on HTF in the direction of the trade",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Unmitigated order block identified on execution TF — fresh, not previously tapped",
        weight: "High",
        category: "PD_Arrays",
      },
      {
        description:
          "FVG present between impulsive legs and overlaps or is adjacent to the OB entry zone",
        weight: "High",
        category: "PD_Arrays",
      },
      {
        description:
          "HTF bias alignment — LTF setup direction agrees with D/4H trend",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "CHoCH on LTF confirms reversal intent at or before the entry OB",
        weight: "Medium",
        category: "Structure",
      },
      {
        description:
          "Momentum or volume spike visible on the displacement candle",
        weight: "Medium",
        category: "Candle_Patterns",
      },
      {
        description:
          "No opposing unmitigated OB or unfilled FVG blocking the TP path",
        weight: "Low",
        category: "Risk",
      },
    ],
    entry_models: [
      {
        name: "OB Mitigation Entry",
        trigger:
          "Price returns to an unmitigated OB. A rejection candle (pin bar or engulfing) forms when price touches the 50% midpoint of the OB on 5M or 15M. Entry on close of that rejection candle.",
        sl_logic: "Beyond the full OB zone extreme — not just the 50% level.",
        tp_logic:
          "TP1 = opposing swing structure. TP2 = HTF imbalance fill. TP3 = HTF liquidity level.",
        consistency_rules:
          "OB must be unmitigated — times_touched = 0. A previously tapped OB has reduced probability.",
      },
      {
        name: "FVG Fill + Rejection",
        trigger:
          "Price retraces into an open FVG. Entry when price touches the 50% midpoint of the FVG and a rejection wick forms on 15M close. The wick must not fully close beyond FVG boundaries.",
        sl_logic: "Below/above the full FVG range — the complete gap boundary.",
        tp_logic:
          "Previous swing high/low as TP1. HTF OB or liquidity as TP2/TP3.",
        consistency_rules:
          "FVG must still be open — not already filled on any TF. Full fill before entry invalidates the model.",
      },
      {
        name: "Liquidity Sweep Reversal",
        trigger:
          "Price spikes through a visible EQH or EQL by 2-10 pips. Price immediately closes back below/above the EQH/EQL on the same candle or the next. Entry on that closing candle.",
        sl_logic: "Beyond the wick extreme of the sweep candle.",
        tp_logic: "Opposing liquidity pool. Then HTF OB or FVG.",
        consistency_rules:
          "Overshoot must be small (2-10 pips / 0.05-0.2%). A large break-through is a breakout, not a sweep reversal.",
      },
      {
        name: "BOS Retest",
        trigger:
          "A candle body closes cleanly beyond a key swing high or low (confirmed BOS — body close required, not just a wick). Price returns to retest the broken level. A rejection candle forms at the retest. Entry on close.",
        sl_logic: "Beyond the retest zone by 3-5 pips.",
        tp_logic:
          "Next major structural liquidity above (buy) or below (sell).",
        consistency_rules:
          "BOS requires a full candle body close beyond the swing — wick-only breaks do not qualify. Retest must touch the former swing level.",
      },
    ],
  },

  "Price Action": {
    description:
      "Pure candlestick and price structure reading without indicators. Focuses on key level reactions, candlestick pattern psychology, and trend context.",
    checklist: [
      {
        description:
          "HTF trend context clear — D/4H showing consistent HH/HL sequence (bull) or LH/LL sequence (bear)",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Price reacting at a defined key S/R level — not in the middle of a range",
        weight: "High",
        category: "PD_Arrays",
      },
      {
        description:
          "Candlestick confirmation present at the level (pin bar, engulfing, or inside bar)",
        weight: "High",
        category: "Candle_Patterns",
      },
      {
        description: "RR meets or exceeds the configured minimum",
        weight: "High",
        category: "Risk",
      },
      {
        description: "No high-impact scheduled news within 30 minutes of entry",
        weight: "Medium",
        category: "Risk",
      },
      {
        description:
          "Volume supports the move — confirmation candle has higher volume than preceding candles (if available)",
        weight: "Medium",
        category: "Candle_Patterns",
      },
      {
        description:
          "Pattern not forming inside a choppy/ranging HTF environment — trend must be established",
        weight: "Low",
        category: "Structure",
      },
    ],
    entry_models: [
      {
        name: "Pin Bar Rejection",
        trigger:
          "Candle wick is more than 2x the body size. Wick pierces into the key level, body closes away. Entry on open of the next candle, or on retest of the pin bar 50% body level.",
        sl_logic:
          "Beyond the pin bar wick tip — the absolute extreme of the rejection.",
        tp_logic:
          "TP1 = next key S/R level. TP2/TP3 = HTF swing high/low or DOL.",
        consistency_rules:
          "Wick-to-body ratio must be confirmed — small pin bars at non-key levels do not qualify. The level must be pre-identified, not drawn after the fact.",
      },
      {
        name: "Engulfing at Structure",
        trigger:
          "Current candle body fully engulfs the previous candle body at a key HTF level. Must close decisively beyond the prior candle's body. Entry on close or on retest of the engulfing candle midpoint.",
        sl_logic:
          "Beyond the low (bull engulf) or high (bear engulf) of the engulfing candle.",
        tp_logic:
          "Nearest opposing structure level as TP1. HTF swing targets for TP2/TP3.",
        consistency_rules:
          "Body engulf only — the current candle body must exceed the prior body on both sides. Wick-to-wick engulf alone is insufficient.",
      },
      {
        name: "Inside Bar Breakout",
        trigger:
          "Current candle full range is contained within the prior candle (mother bar). Entry on the breakout candle that closes beyond the mother bar high (buy) or low (sell).",
        sl_logic:
          "Opposite side of the mother bar — beyond mother bar low for buys, above high for sells.",
        tp_logic:
          "TP1 = 1x mother bar range projected. TP2 = 2x projection or next S/R.",
        consistency_rules:
          "Mother bar must be identifiable as a consolidation — not a small candle inside a trend. Inside bar low/high must not have been breached before breakout.",
      },
      {
        name: "Fakey (False Breakout)",
        trigger:
          "An inside bar forms at a key level. Price breaks out beyond the mother bar trapping breakout traders, then reverses and closes back inside the mother bar range within 1-2 candles. Entry on the candle that closes back inside.",
        sl_logic:
          "Beyond the false break wick extreme — the furthest point of the failed breakout.",
        tp_logic:
          "Opposing side of the mother bar (TP1) and prior swing beyond it (TP2).",
        consistency_rules:
          "Inside bar must have formed FIRST before the false breakout. The reverse-back candle must close INSIDE the mother bar range — not just retrace.",
      },
      {
        name: "Quasimodo (QM)",
        trigger:
          "In uptrend: price makes HH then fails to make a higher low — instead forms a lower low. Entry at retest of the last HL (now resistance). Mirror for downtrend.",
        sl_logic:
          "Beyond the failed HH extreme (buy QM) or failed LL extreme (sell QM).",
        tp_logic: "TP1 = the LL that confirmed QM. TP2 = next major S/R below.",
        consistency_rules:
          "QM requires a prior established trend with at least 2 HH/HL (bull) or LH/LL (bear) before the failure. The lower low must be confirmed — not just forming.",
      },
      {
        name: "V-Shape Reversal",
        trigger:
          "Sharp impulsive drop with no consolidation. Within 1-2 candles a recovery candle closes above the 50% midpoint of the drop. Entry on the close of the recovery candle.",
        sl_logic: "Below the absolute low of the V-shape reversal.",
        tp_logic:
          "Full retracement to the origin of the drop. HTF resistance as TP2.",
        consistency_rules:
          "Drop must be sharp and impulsive — gradual declines do not produce valid V-shapes. Recovery must happen quickly (1-2 candles). Slow recoveries are retracements, not reversals.",
      },
    ],
  },

  "Market Structure": {
    description:
      "Reads market through swing high/low sequences. Trend confirmed via BOS/CHoCH chains across timeframes. Entries inside premium/discount zones aligned with institutional narrative.",
    checklist: [
      {
        description:
          "HTF narrative clear — consistent BOS sequence confirms trend on D and 4H timeframes",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "BOS/CHoCH sequence valid and unbroken on execution timeframe (15M)",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Entry in discount zone for buys or premium zone for sells relative to swing range",
        weight: "High",
        category: "PD_Arrays",
      },
      {
        description:
          "DOL target mapped — next unswept liquidity pool reachable within ADR",
        weight: "High",
        category: "Liquidity",
      },
      {
        description:
          "No conflicting structure on intermediate TF — e.g. 1H not opposing 15M direction",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Retracement proportional — not overextended beyond 0.79 fib of last impulsive leg",
        weight: "Medium",
        category: "Fibonacci",
      },
      {
        description:
          "Momentum of the most recent structural move confirms entry direction",
        weight: "Medium",
        category: "Candle_Patterns",
      },
    ],
    entry_models: [
      {
        name: "BOS + Retest",
        trigger:
          "A candle body closes clearly beyond a key swing high/low confirming BOS. Price then returns to retest the broken structural level. A rejection candle forms at the retest zone. Entry on close of that rejection candle.",
        sl_logic: "Beyond the retest zone extreme by 3-5 pips.",
        tp_logic:
          "TP1 = next swing high/low in BOS chain direction. TP2/TP3 = HTF liquidity and DOL.",
        consistency_rules:
          "BOS requires body close beyond the swing — wick-only breaks do not confirm BOS. Retest must touch the former swing level and show rejection, not just approach it.",
      },
      {
        name: "CHoCH Entry",
        trigger:
          "First CHoCH forms after an established trend — first higher high in a downtrend or first lower low in an uptrend. LTF pullback to CHoCH origin where a fresh OB or FVG has formed. Entry at that zone on rejection.",
        sl_logic:
          "Below the CHoCH swing low that triggered the structural change (buy). Above for sells.",
        tp_logic:
          "TP1 = previous significant swing high. TP2/TP3 = HTF BOS targets above.",
        consistency_rules:
          "Requires a prior established trend to change FROM — CHoCH is not valid in ranging markets. Must be the FIRST CHoCH of the reversal, not a continuation CHoCH.",
      },
      {
        name: "EQH/EQL Sweep + Reverse",
        trigger:
          "Two or more swing highs/lows at nearly the same price create visible EQH/EQL liquidity. Price spikes through them by a small margin. Next candle immediately closes back through the EQH/EQL. Entry on that closing candle.",
        sl_logic:
          "Beyond the sweep wick extreme — highest/lowest point of the spike.",
        tp_logic: "TP1 = opposing EQL/EQH. TP2/TP3 = HTF structural targets.",
        consistency_rules:
          "EQH/EQL requires at least 2 visible price touches at approximately the same level. Overshoot must be small — a large break is a breakout not a sweep.",
      },
      {
        name: "MSB Confirmation",
        trigger:
          "Major Structure Break (MSB) already confirmed on HTF (D or 4H) — a significant swing break that changes macro trend. LTF (15M) shows CHoCH in same direction. Entry on LTF pullback after CHoCH into fresh LTF OB or FVG.",
        sl_logic:
          "Below the LTF CHoCH swing low (buy) or above CHoCH swing high (sell).",
        tp_logic: "HTF structural targets from the MSB measured move.",
        consistency_rules:
          "HTF MSB must ALREADY be confirmed — not anticipated. Do not use this model to predict MSBs. LTF CHoCH must align directionally with the HTF MSB.",
      },
      {
        name: "Displacement + Rebalance",
        trigger:
          "Strong impulsive candle sequence leaves a visible FVG (gap between candle 1 high and candle 3 low, or vice versa). Entry when price retraces to the 50% midpoint of that FVG with a rejection visible on 5M.",
        sl_logic:
          "Below the full FVG range — below the lowest point of the gap for buys.",
        tp_logic:
          "TP1 = prior swing high/low before displacement. TP2/TP3 = HTF liquidity.",
        consistency_rules:
          "FVG must be created by an impulsive move — not by a small choppy candle. The gap must be clearly visible — no candle body fills the gap between creation candles.",
      },
    ],
  },

  Wyckoff: {
    description:
      "Volume-price relationship methodology. Identifies institutional accumulation and distribution cycles via Wyckoff schematics. Volume confirmation is mandatory for every signal.",
    checklist: [
      {
        description:
          "Wyckoff phase clearly identified — Accumulation, Markup, Distribution, or Markdown — with supporting volume evidence",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Spring (accumulation) or Upthrust (distribution) event confirmed with volume signature",
        weight: "High",
        category: "Candle_Patterns",
      },
      {
        description:
          "Volume confirmation present — spike on spring/upthrust, volume dry-up on subsequent test",
        weight: "High",
        category: "Candle_Patterns",
      },
      {
        description:
          "Sign of Strength (SOS) or Sign of Weakness (SOW) candle visible",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Markup or Markdown phase continuation aligns with entry direction",
        weight: "Medium",
        category: "Structure",
      },
      {
        description:
          "No climactic volume against the trade direction in the last 10 candles",
        weight: "Medium",
        category: "Risk",
      },
    ],
    entry_models: [
      {
        name: "Spring Reversal",
        trigger:
          "Price breaks below the support zone (BC/SC area) on declining volume — the Spring. Price immediately recovers back above support. A Test of the Spring follows on very low volume with a higher low. Entry on close of the Test candle.",
        sl_logic:
          "Below the Spring low — the absolute lowest point of the spring wick.",
        tp_logic:
          "TP1 = UAR (Upper Area of Resistance — top of the trading range). TP2 = prior swing high above the range.",
        consistency_rules:
          "Volume on the Spring break must be declining or climactic — not expanding. Test candle volume must be clearly lower than the Spring candle volume.",
      },
      {
        name: "LPS Entry (Last Point of Support)",
        trigger:
          "After a Sign of Strength breaks above resistance, price pulls back to the Last Point of Support — former resistance now acting as support. Volume declines on pullback. Entry on rejection candle at LPS zone.",
        sl_logic: "Below the LPS zone low.",
        tp_logic:
          "Measured move from the Trading Range depth projected upward from the LPS.",
        consistency_rules:
          "SOS must already be confirmed before looking for LPS. Volume must decline on the pullback to LPS — high-volume pullbacks are warning signs.",
      },
    ],
  },

  "EMA Trend": {
    description:
      "Trend-following using EMA stack alignment. Entries on pullbacks to the EMA zone in the direction of the established trend.",
    checklist: [
      {
        description:
          "EMA stack aligned on HTF — fast EMA above slow EMA (bull) or below (bear) on D or 4H",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Price has pulled back to the fast EMA zone — not extended far above/below",
        weight: "High",
        category: "PD_Arrays",
      },
      {
        description:
          "Trend continuation candle forms at EMA zone — pin bar or engulfing touching EMA",
        weight: "High",
        category: "Candle_Patterns",
      },
      {
        description:
          "Momentum confirms — RSI above 50 for bull entries, below 50 for bear entries",
        weight: "Medium",
        category: "Indicators",
      },
      {
        description:
          "ADR expanding, not contracting — avoid entries in tightening range environments",
        weight: "Medium",
        category: "Risk",
      },
    ],
    entry_models: [
      {
        name: "EMA Pullback Continuation",
        trigger:
          "Price in established uptrend pulls back to touch or slightly pierce the fast EMA. A rejection candle (pin bar or engulfing) forms at the EMA. Entry on close of that rejection candle. Fast EMA must be above slow EMA.",
        sl_logic:
          "Below the slow EMA plus a small buffer — not just below the fast EMA.",
        tp_logic:
          "TP1 = previous swing high. TP2/TP3 = next HTF resistance levels.",
        consistency_rules:
          "EMA stack must be confirmed — fast above slow (bull), fast below slow (bear). A recent EMA cross makes this model invalid until stack is re-established.",
      },
      {
        name: "EMA Cross Retest",
        trigger:
          "Fast EMA crosses above the slow EMA (bull) or below (bear) — a trend shift signal. Price rallies then pulls back to retest the cross zone. Entry on rejection candle at the cross zone.",
        sl_logic:
          "Beyond the cross zone — below the slow EMA for bull cross entries.",
        tp_logic: "TP1 = 1.5-2x SL distance. TP2/TP3 = next S/R levels.",
        consistency_rules:
          "Cross must be confirmed — the fast EMA must have closed on the other side of the slow EMA. The retest must respect the cross zone, not simply drift back through.",
      },
    ],
  },

  Breakout: {
    description:
      "Identifies clearly defined consolidation ranges and enters on confirmed candle body breakout, validated by retest hold.",
    checklist: [
      {
        description:
          "Range clearly defined — at least 3 touches on both upper and lower boundaries",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Breakout candle body closes decisively beyond range boundary — wick-only breakouts do not qualify",
        weight: "High",
        category: "Candle_Patterns",
      },
      {
        description:
          "Retest of broken boundary holds — at least one candle closes back on the breakout side",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "Volume expands on the breakout candle relative to average range candles",
        weight: "Medium",
        category: "Candle_Patterns",
      },
      {
        description:
          "No major HTF S/R level sitting immediately beyond the breakout point",
        weight: "Medium",
        category: "Risk",
      },
    ],
    entry_models: [
      {
        name: "Breakout Retest Entry",
        trigger:
          "Price breaks range boundary with a candle body close. Price pulls back to retest the boundary. A rejection candle confirms the level holds. Entry on close of confirmation candle at the retest.",
        sl_logic:
          "Back inside the range — beyond the breakout boundary on the range side.",
        tp_logic: "TP1 = 1x range height from breakout point. TP2 = 1.5-2x.",
        consistency_rules:
          "Range must have at least 3 touches on each boundary — 2-touch ranges are too weak. Retest candle must close on the breakout side, not just touch and reverse.",
      },
      {
        name: "Anticipatory Breakout",
        trigger:
          "Price compressing near the boundary with progressively smaller candle bodies (triangle/wedge). Entry on the candle that closes beyond the boundary — no retest wait. Only when compression is extreme and momentum is building.",
        sl_logic:
          "Back to the range midpoint — wider than retest entry due to no confirmation.",
        tp_logic:
          "Range height measured from first boundary touch, projected from entry.",
        consistency_rules:
          "Use only when compression is clear and candle bodies are visibly shrinking over 5+ candles. Avoid if compression is not obvious — use Breakout Retest Entry instead.",
      },
    ],
  },

  VWAP: {
    description:
      "Session-anchored VWAP used as dynamic institutional reference. Entries on VWAP reclaim or rejection with supporting PD array or S/R confluence.",
    checklist: [
      {
        description:
          "Session VWAP bias clear — price spending majority of session above VWAP (bull) or below (bear)",
        weight: "High",
        category: "Structure",
      },
      {
        description:
          "VWAP reclaim candle (bull) or VWAP rejection candle (bear) confirmed with candle close",
        weight: "High",
        category: "Candle_Patterns",
      },
      {
        description:
          "Correct session VWAP used — anchored to current session open, not prior session",
        weight: "High",
        category: "Session",
      },
      {
        description:
          "VWAP level coincides with nearby S/R, OB, or FVG — not VWAP alone",
        weight: "Medium",
        category: "PD_Arrays",
      },
      {
        description:
          "SL placed beyond VWAP standard deviation band, not just the VWAP line",
        weight: "Medium",
        category: "Risk",
      },
    ],
    entry_models: [
      {
        name: "VWAP Reclaim",
        trigger:
          "In a bullish session, price temporarily dips below VWAP. A candle then closes back above VWAP — the reclaim. Entry on that reclaim close, ideally at a confluence zone (OB or S/R near VWAP).",
        sl_logic: "Below the low of the reclaim candle.",
        tp_logic:
          "TP1 = VWAP +1 standard deviation band. TP2 = session high or prior swing.",
        consistency_rules:
          "Session must have established a bullish bias before the dip. A session that opened below VWAP and has not reclaimed it is not a reclaim setup.",
      },
      {
        name: "VWAP Rejection",
        trigger:
          "In bearish session (price below VWAP), price rallies to VWAP. A rejection candle closes back below VWAP. Entry on that close.",
        sl_logic: "Above VWAP plus a small buffer.",
        tp_logic: "TP1 = session low. TP2 = VWAP -1 standard deviation.",
        consistency_rules:
          "Session must have established a bearish bias below VWAP. Rally to VWAP must be a retracement, not a trend change. If price reclaims VWAP convincingly, this setup is invalid.",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARD COMPATIBILITY — STRATEGY_CHECKLIST
// FIX: Previous version returned STRATEGY_ENTRY_MODELS directly, which broke
// any existing code expecting flat string arrays. Now correctly derived.
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_CHECKLIST = Object.fromEntries(
  Object.entries(STRATEGY_ENTRY_MODELS).map(([strategy, data]) => [
    strategy,
    data.checklist.map((item) => item.description),
  ]),
);

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE PRESETS
// FIX: day rr raised from "1" to "2". scalper from "1" to "1.5".
//      min_rr of 1.0 allowed Grade A at 1:1 RR which is unacceptably low.
// ─────────────────────────────────────────────────────────────────────────────

export const PROFILE_PRESETS = {
  position: {
    label: "Position (w+d / 4h / 1h)",
    htf_tfs: ["w", "d"],
    exec_tfs: ["4h"],
    conf_tfs: ["1h"],
    sessions: "Any",
    rr: "3",
  },
  swing: {
    label: "Swing (d+4h / 1h / 15m)",
    htf_tfs: ["d", "4h"],
    exec_tfs: ["1h"],
    conf_tfs: ["15m"],
    sessions: "Any",
    rr: "2",
  },
  day: {
    label: "Daily (d+4h / 15m / 5m)",
    htf_tfs: ["d", "4h"],
    exec_tfs: ["15m"],
    conf_tfs: ["5m"],
    sessions: "Any",
    rr: "1.5",
  },
  scalper: {
    label: "Scalping (4h+1h / 5m / 1m)",
    htf_tfs: ["4h", "1h"],
    exec_tfs: ["5m"],
    conf_tfs: ["1m"],
    sessions: "Any",
    rr: "1",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = {
  symbol: "",
  symbols: [],
  asset: "Auto detect",
  session: "Any",
  rr: "2",
  min_trades: "0",
  max_trades: "2",
  narrative_language: "English",
  risk: "1",
  lookbackBars: "2000",
  snapshotQuality: "80",
  mergeSnapshots: true,
  broker: "",
  refreshSnapshot: true,
  strategies: ["SMC", "Price Action", "Market Structure"],
  profile: "day",
  htf_tfs: [...PROFILE_PRESETS.day.htf_tfs],
  exec_tfs: [...PROFILE_PRESETS.day.exec_tfs],
  conf_tfs: [...PROFILE_PRESETS.day.conf_tfs],
  htfbias: "",
  dir: "Direction: Both",
  news: "",
  notes: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// AI RESPONSE SCHEMA
//
// DESIGN PRINCIPLES:
//   1. HTF (D, 4H, W) — bias, price narrative, DOL, and reference zones ONLY.
//      Every reference zone must have a relevance tag — no zone listed without purpose.
//      No PD array listings, no confluence scoring, no path steps at HTF level.
//   2. LTF (15M, 5M, 1M) — full execution detail: structure, PD arrays,
//      key levels, expected path, key events.
//   3. Confluence checklist belongs to the STRATEGY, not the entry model.
//      Only PASSED items in passed_items[]. Only failed HIGH-weight items in
//      failed_critical[]. Medium/Low failures silently reflected in score only.
//   4. Trade plan is pure execution output.
//      Entry from LTF PD array. SL from entry model sl_logic. TP1 from LTF levels.
//      TP2/TP3 anchored to HTF reference_zones by ID.
//   5. estimate_candles_that_entry_happens = 0 means entry condition is already
//      met right now. Use Market order. Higher = further away.
//   6. skip_reasons[] only populated when trade_decision is NOT "Proceed".
//   7. Multiple active strategies: score each independently. Use the best
//      individual strategy score. Name the winning strategy in trade_plan[].strategy.
//
// NOTE: JS comments in this object are for developer reference only.
//       JSON.stringify strips them — the AI receives clean JSON.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_RESPONSE_SCHEMA_VERSION = "3.1";
export const AI_RESPONSE_SCHEMA = [MERGED_TRADE_PLAN_SCHEMA];
export const SCHEMA_SYSTEM = AI_RESPONSE_SCHEMA;
export const SCHEMA_USER_DEFAULT = "{}";
export const GUIDE_USER_DEFAULT = "";
export { GUIDE_SYSTEM };

// ─────────────────────────────────────────────────────────────────────────────
// GUIDE TEXT — injected directly into the prompt.
// This is the most critical instruction block.
// Every rule must be unambiguous. The AI reads this as its operating procedure.
// ─────────────────────────────────────────────────────────────────────────────

// ── Split GUIDE / SCHEMA into system + user parts ──
// System = readonly, always included, never saved to template.
// User   = editable textarea, saved to template, appended after system.
//
// Final Guide  = GUIDE_SYSTEM + "\n\n## USER INSTRUCTIONS\n" + guideUser
// Final Schema = { ...SCHEMA_SYSTEM, extra: schemaUserObj }

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function getEffectiveTfConfig(cfg) {
  const profileKey = String(cfg?.profile || "")
    .trim()
    .toLowerCase();
  const preset = PROFILE_PRESETS[profileKey] || PROFILE_PRESETS.day;
  return {
    profile: PROFILE_PRESETS[profileKey] ? profileKey : "day",
    htf_tfs:
      Array.isArray(cfg?.htf_tfs) && cfg.htf_tfs.length
        ? cfg.htf_tfs
        : [...preset.htf_tfs],
    exec_tfs:
      Array.isArray(cfg?.exec_tfs) && cfg.exec_tfs.length
        ? cfg.exec_tfs
        : [...preset.exec_tfs],
    conf_tfs:
      Array.isArray(cfg?.conf_tfs) && cfg.conf_tfs.length
        ? cfg.conf_tfs
        : [...preset.conf_tfs],
    sessions: cfg?.session || preset.sessions,
    rr: cfg?.rr || preset.rr,
  };
}

// Builds the active strategy block injected into the prompt.
// CRITICAL: includes checklist items with weights AND full entry model details —
// not just names. Without this the AI cannot score confluence or validate triggers.
//
// Source-of-truth: src/config/guide/strategies.md (parsed at import time).
import strategiesRaw from "../../../../../config/guide/strategies.md?raw";

function parseStrategyGuide(md) {
  const strategies = {};
  const blocks = md.split(/\n---\n/);
  for (const block of blocks) {
    const lines = block.split("\n");
    let i = 0;
    while (i < lines.length && !lines[i].startsWith("## ")) i++;
    if (i >= lines.length) continue;
    const name = lines[i].slice(3).trim();
    i++;
    const descLines = [];
    while (
      i < lines.length &&
      !lines[i].startsWith("###") &&
      !lines[i].startsWith("---")
    ) {
      const t = lines[i].trim();
      if (t && !t.startsWith(">")) descLines.push(t);
      i++;
    }
    const description = descLines.join(" ");
    const checklist = [];
    const entryModels = [];
    let section = null;
    let cur = null;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("### ")) {
        const sec = line.slice(4).trim().toLowerCase();
        if (sec === "checklist") {
          section = "checklist";
          cur = null;
        } else if (sec.startsWith("entry model")) {
          section = "models";
          cur = null;
        }
      } else if (line.startsWith("#### ")) {
        cur = {
          name: line.slice(5).trim(),
          trigger: "",
          sl_logic: "",
          tp_logic: "",
          consistency_rules: "",
        };
        entryModels.push(cur);
        section = "model";
      } else if (section === "checklist") {
        const m = line.match(/- \[(High|Medium|Low)\] \(([^)]+)\) (.+)/);
        if (m)
          checklist.push({
            weight: m[1],
            category: m[2],
            description: m[3].trim(),
          });
      } else if (section === "model" && cur) {
        const m = line.match(/- \*\*(Trigger|SL|TP|Rules):\*\* (.+)/);
        if (m) {
          const v = m[2].trim();
          if (m[1] === "Trigger") cur.trigger = v;
          else if (m[1] === "SL") cur.sl_logic = v;
          else if (m[1] === "TP") cur.tp_logic = v;
          else if (m[1] === "Rules") cur.consistency_rules = v;
        }
      }
      i++;
    }
    if (name && description)
      strategies[name] = { description, checklist, entry_models: entryModels };
  }
  return strategies;
}

const _strategies = parseStrategyGuide(strategiesRaw);

export function buildStrategyContext(strategies) {
  return strategies
    .filter((s) => _strategies[s])
    .map((s) => {
      const data = _strategies[s];

      const checklistBlock = data.checklist
        .map(
          (item) =>
            `    [${item.weight}] (${item.category}) ${item.description}`,
        )
        .join("\n");

      const modelsBlock = data.entry_models
        .map(
          (m) =>
            `    • ${m.name}\n` +
            `      Trigger: ${m.trigger}\n` +
            `      SL: ${m.sl_logic}\n` +
            `      TP: ${m.tp_logic}\n` +
            `      Rules: ${m.consistency_rules}`,
        )
        .join("\n\n");

      return (
        `━━━ STRATEGY: ${s} ━━━\n` +
        `  ${data.description}\n\n` +
        `  CHECKLIST (score buy and sell independently against these):\n${checklistBlock}\n\n` +
        `  ENTRY MODELS (evaluate only after checklist gate passes):\n${modelsBlock}`
      );
    })
    .join("\n\n");
}

// FIX: now serializes the actual AI_RESPONSE_SCHEMA so the AI sees the exact
// output field structure. Previous version only returned enums — the AI had
// to guess field names.
export function buildSchemaString(userSchemaJson) {
  var base = SCHEMA_SYSTEM;
  var extra = {};
  try {
    if (userSchemaJson) extra = JSON.parse(userSchemaJson);
  } catch (_) {}
  if (typeof extra !== "object" || !extra) extra = {};
  // Keep array as array — Object.assign({}, arr) turns [{...}] into {"0":{...}}
  if (Array.isArray(base)) {
    if (Object.keys(extra).length) {
      return JSON.stringify([...base, extra], null, 2);
    }
    return JSON.stringify(base, null, 2);
  }
  var merged = Object.assign({}, base);
  if (Object.keys(extra).length) merged.extra = extra;
  return JSON.stringify(merged, null, 2);
}

// Builds enum and constraint reference appended after the schema.
export function buildEnumString() {
  // config.json has all fields at top level.
  // Separate enum arrays from scoring/grade metadata to match old prompt format.
  const ENUM_KEYS = new Set([
    "htf_timeframe",
    "ltf_timeframe",
    "trend",
    "structure",
    "phase",
    "bias",
    "direction",
    "order_side",
    "order_type",
    "profile",
    "session",
    "broker_name",
    "ltf_structure",
    "macro",
    "strategy",
    "entry_model",
    "weight",
    "confidence",
    "poi_freshness",
    "ob_freshness",
    "ob_type",
    "fvg_type",
    "liquidity_type",
    "poi_type",
    "premium_discount_position",
    "choch_sub_type",
    "choch_type",
    "choch_used_as",
    "mss_type",
    "bos_type",
    "candle_pattern",
    "fib_level",
    "harmonic_type",
    "divergence_indicator",
    "divergence_class",
    "wyckoff_phase",
    "wyckoff_event",
    "wyckoff_range_type",
    "vsa_signal",
    "volume_level",
    "idm_type",
    "entry_trigger_type",
    "news_impact",
    "assets_checked",
    "correlation_alignment",
    "overextension_risk",
    "breakeven_condition",
    "tp1_logic",
    "tp2_logic",
    "tp3_logic",
    "when_price",
    "risk_grade",
    "suggested_action",
    "checklist_ai_confirm",
    "zone_relevance",
    "zone_status",
  ]);
  const enums = {};
  const meta = {};
  for (const [k, v] of Object.entries(SCHEMA_CONFIG)) {
    if (ENUM_KEYS.has(k)) enums[k] = v;
    else meta[k] = v;
  }
  return JSON.stringify(
    {
      schema_version: "3.1",
      output_format: "single JSON object matching trade_plan_schema.json",
      enums,
      ...meta,
    },
    null,
    2,
  );
}

export function buildPrompt(cfg, guideUser, schemaUser) {
  if (!guideUser) guideUser = "";
  if (!schemaUser) schemaUser = "{}";
  const tfConfig = getEffectiveTfConfig(cfg);
  const profileLabel =
    { position: "position", swing: "swing", day: "daily", scalper: "scalping" }[
      tfConfig.profile
    ] || "daily";
  const symbol = String(cfg.symbol || "UK100").trim() || "UK100";
  const symbols = Array.isArray(cfg.symbols)
    ? cfg.symbols.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const symbolList = symbols.length ? symbols : [symbol];
  const strategy = cfg.strategies.join(", ") || "ICT";

  const context = [];
  if (cfg.htfbias) context.push(`htf_bias_override: "${cfg.htfbias}"`);
  if (cfg.dir) context.push(`direction: "${cfg.dir}"`);
  if (cfg.news) context.push(`news_risk: "${cfg.news}"`);
  if (cfg.session && cfg.session !== "Any")
    context.push(`session: "${cfg.session}"`);
  if (cfg.notes) context.push(`notes: "${cfg.notes}"`);

  const strategyContext = buildStrategyContext(cfg.strategies);

  return `## SESSION CONFIG
Asset: ${cfg.asset} | Session: ${cfg.session || "Any"} | Profile: ${profileLabel}
Symbols: ${symbolList.join(", ")}
MinTrades: ${cfg.min_trades || "0"} | MaxTrades: ${cfg.max_trades || "2"} | MinRR: ${tfConfig.rr} | MaxRisk: ${cfg.risk}% | NarrativeLanguage: ${cfg.narrative_language || "English"}
HTF: ${tfConfig.htf_tfs.map((x) => String(x).toUpperCase()).join(", ")}
Execution: ${tfConfig.exec_tfs.map((x) => String(x).toUpperCase()).join(", ")}
Confirmation: ${tfConfig.conf_tfs.map((x) => String(x).toUpperCase()).join(", ")}
Active Strategies: ${strategy}
${context.length ? `Overrides: ${context.join(" | ")}` : ""}

## ACTIVE STRATEGIES — CHECKLISTS AND ENTRY MODELS
${strategyContext}

## ANALYSIS INSTRUCTIONS
${GUIDE_SYSTEM}${guideUser ? "\n\n## USER INSTRUCTIONS\n" + guideUser : ""}

## PRICE PRECISION RULE (MANDATORY)
For each symbol, detect the market price precision from the provided chart/current price values and keep it consistent.
If current price uses N decimals, all price outputs in trade_plan must also use exactly N decimals:
- entry_price / entry
- stop_loss / sl
- take_profit / tp
- multiple_exits.tp1.price / tp2.price / tp3.price
- breakeven_trigger / be_trigger
Do not round to fewer decimals than the symbol precision.

## EXPECTED OUTPUT SCHEMA
Return your response as JSON exactly matching this structure:
${buildSchemaString(schemaUser)}

## FIELD CONSTRAINTS
${buildEnumString()}`;
}

export function buildJsonConfig(cfg) {
  const tfConfig = getEffectiveTfConfig(cfg);
  return JSON.stringify(
    {
      version: "2.6",
      saved_at: new Date().toISOString(),
      config: {
        symbol: cfg.symbol,
        symbols: symbolList,
        profile: tfConfig.profile,
        asset_class: cfg.asset,
        note_language: cfg.language || "English",
        narrative_language: cfg.narrative_language || "English",
        strategy: cfg.strategies.join(" + "),
        strategies: cfg.strategies,
        session: cfg.session,
        min_trades: Number(cfg.min_trades || 0),
        max_trades: Number(cfg.max_trades || 4),
        min_rr: Number(tfConfig.rr),
        max_risk_pct: Number(cfg.risk),
        daily_adr_filter: true,
        killzones_est: ["02:00-05:00", "07:00-10:00"],
        risk_tiers_pct: {
          high_confluence_gt_85: 1.0,
          standard: 0.5,
          high_risk: 0.25,
        },
        checklist_gate: {
          min_high_weight_ratio: 0.75,
          min_weighted_score: 65,
        },
        grade_thresholds: {
          A: { min_score: 85, rr_multiplier: 1.5 },
          B: { min_score: 65, rr_multiplier: 1.0 },
          C: { min_score: 50, rr_multiplier: 0.9 },
        },
        lookback_bars: Number(cfg.lookbackBars),
        timeframe_array: {
          htf_bias_tfs: tfConfig.htf_tfs,
          execution_tf: tfConfig.exec_tfs,
          confirmation_tf: tfConfig.conf_tfs,
        },
      },
    },
    null,
    2,
  );
}
