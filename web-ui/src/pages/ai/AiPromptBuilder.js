// AI Prompt Builder — constants and functions for building AI analysis prompts

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_OPTIONS = [
  "ICT",
  "SMC",
  "Price Action",
  "Market Structure",
  "Wyckoff",
  "EMA Trend",
  "Breakout",
  "VWAP",
  "Mean Reversion",
  "Order Flow",
  "Volatility",
  "Trend Following",
  "Divergence",
];

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY → ENTRY MODELS → CHECKLIST
//
// RELATIONSHIP:
//   Strategy   = the framework that defines HOW you read the market.
//                Owns the checklist — conditions that must pass BEFORE
//                any entry model is evaluated.
//   Entry Model = the specific trigger pattern within that strategy.
//                 Only evaluated AFTER the strategy checklist score is sufficient.
//   Checklist   = strategy-level gate. Each item has a weight:
//                   High   = blocker if failed (trade must be skipped)
//                   Medium = reduces confidence score
//                   Low    = minor supporting evidence
//
// RULE:
//   high_weight_passed / high_weight_total >= 0.75  →  proceed to entry model scan
//   weighted_score >= 85                            →  riskPct = 1.0%
//   weighted_score 65–84                            →  riskPct = 0.5%
//   weighted_score < 65                             →  skip or riskPct = 0.25%
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY_ENTRY_MODELS = {
  ICT: {
    description: "Inner Circle Trader methodology. Focuses on institutional order flow, liquidity engineering, and precision entry via PD arrays during killzone windows.",
    checklist: [
      { description: "London or NY killzone active (London 02:00-05:00 EST / NY 07:00-10:00 EST)", weight: "High", category: "Session" },
      { description: "HTF bias confirmed — D and 4H trend aligned in same direction", weight: "High", category: "Structure" },
      { description: "BOS or CHoCH confirmed on execution timeframe", weight: "High", category: "Structure" },
      { description: "Price entering from premium (sell) or discount (buy) zone — below/above 0.5 fib of HTF range", weight: "High", category: "PD_Arrays" },
      { description: "DOL identified — BSL/SSL or unfilled HTF FVG within ADR reach", weight: "High", category: "Liquidity" },
      { description: "Displacement candle present — strong impulsive move leaving imbalance", weight: "Medium", category: "PD_Arrays" },
      { description: "SMT divergence confirmed on correlated asset (e.g. FTSE vs DAX / DXY vs DJI)", weight: "Medium", category: "Correlation" },
      { description: "ADR not already exhausted — remaining ADR range covers TP1 at minimum", weight: "Medium", category: "Risk" },
      { description: "No major news event within 30 minutes of entry", weight: "Low", category: "Risk" },
    ],
    entry_models: [
      {
        name: "OB + FVG Confluence",
        trigger: "Price retraces into HTF or LTF OB zone that contains an unfilled FVG. BOS already confirmed above/below. Entry on 15M candle close inside OB with rejection wick present.",
        sl_logic: "Below OB zone bottom (buy) or above OB zone top (sell) + 2-5 pip buffer.",
        tp_logic: "TP1 = nearest EQH/EQL. TP2 = HTF BSL/SSL. TP3 = HTF DOL target (PDH/PDL or weekly level).",
      },
      {
        name: "Breaker Block Retest",
        trigger: "Former bullish OB that was broken and became a bearish breaker (or vice versa). Price returns to retest the breaker zone. Entry on rejection candle close at breaker boundary.",
        sl_logic: "Beyond the breaker zone by 3-5 pips.",
        tp_logic: "TP1 = most recent swing high/low. TP2 = HTF FVG fill. TP3 = HTF liquidity.",
      },
      {
        name: "Silver Bullet",
        trigger: "10:00-11:00 AM EST window only. Displacement candle creates a FVG on 5M/15M. Price retraces back into that FVG. Entry on 5M candle close inside the FVG.",
        sl_logic: "Below the low of the displacement candle that created the FVG.",
        tp_logic: "TP1/TP2 within session range. Not held overnight.",
      },
      {
        name: "Power of 3 (AMD)",
        trigger: "Accumulation range identified in Asian session. London open manipulates (sweeps) range high or low (Judas swing). 15M closes back inside the accumulation range. Entry on close back inside range.",
        sl_logic: "Beyond the sweep extreme + 5 pips.",
        tp_logic: "TP targets are the opposing side of the daily range (NY distribution leg).",
      },
      {
        name: "Judas Swing",
        trigger: "London open creates false move sweeping Asian session liquidity. 15M CHoCH forms in opposite direction. Entry on first pullback after CHoCH — ideally into a fresh 5M OB or FVG.",
        sl_logic: "Beyond the sweep high/low.",
        tp_logic: "NY session target levels — PDH/PDL or weekly open.",
      },
      {
        name: "CISD (Change In State of Delivery)",
        trigger: "A displacement candle shifts delivery from bearish to bullish (or opposite). Entry on retest of the candle that caused the CISD — this candle becomes a micro OB.",
        sl_logic: "Below the CISD candle low.",
        tp_logic: "Next HTF PD array or liquidity pool.",
      },
      {
        name: "Midnight Open Rejection",
        trigger: "Price sweeps the midnight open level (00:00 EST), sharp rejection candle closes back through it. Entry on the close of the rejection candle.",
        sl_logic: "Beyond midnight open sweep extreme.",
        tp_logic: "Opposing session high/low or nearest HTF FVG.",
      },
    ],
  },

  SMC: {
    description: "Smart Money Concepts. Tracks institutional footprints via order blocks, imbalances, and liquidity grabs. Closely related to ICT but focuses more on structural breaks and mitigation.",
    checklist: [
      { description: "HTF liquidity grab confirmed — price swept a visible EQH/EQL or PDH/PDL", weight: "High", category: "Liquidity" },
      { description: "Structure break (BOS) on HTF in direction of trade", weight: "High", category: "Structure" },
      { description: "Order block identified and unmitigated on execution TF", weight: "High", category: "PD_Arrays" },
      { description: "Imbalance (FVG) present between impulsive legs and aligns with entry zone", weight: "High", category: "PD_Arrays" },
      { description: "HTF bias alignment — LTF setup agrees with D/4H direction", weight: "High", category: "Structure" },
      { description: "Choch on LTF confirms reversal intent at OB", weight: "Medium", category: "Structure" },
      { description: "Volume or momentum spike on displacement candle", weight: "Medium", category: "Candle_Patterns" },
      { description: "No opposing OB or FVG within the TP path", weight: "Low", category: "Risk" },
    ],
    entry_models: [
      {
        name: "OB Mitigation Entry",
        trigger: "Price returns to an unmitigated OB. Entry when price touches OB 50% level and a rejection candle forms (pin bar or engulfing) on 5M/15M.",
        sl_logic: "Beyond the full OB zone.",
        tp_logic: "TP1 = opposing structure. TP2 = HTF imbalance fill. TP3 = HTF liquidity.",
      },
      {
        name: "FVG Fill + Rejection",
        trigger: "Price retraces into an open FVG zone. Entry on 15M close at the 50% midpoint of FVG with a rejection wick.",
        sl_logic: "Below/above the full FVG range.",
        tp_logic: "Previous swing high/low then HTF targets.",
      },
      {
        name: "Liquidity Sweep Reversal",
        trigger: "Price spikes through visible EQH/EQL (2-10 pip overshoot), immediately closes back below/above on the same or next candle. Entry on that close.",
        sl_logic: "Beyond the wick extreme.",
        tp_logic: "Opposing liquidity pool or OB.",
      },
      {
        name: "BOS Retest",
        trigger: "Candle closes beyond a key swing high/low (BOS). Price returns to retest the broken level. Entry on rejection candle at retest zone.",
        sl_logic: "Beyond retest zone.",
        tp_logic: "Next major liquidity above/below.",
      },
    ],
  },

  "Price Action": {
    description: "Pure candlestick and structure reading without indicators. Focuses on key level reactions, candlestick patterns, and trend context.",
    checklist: [
      { description: "HTF trend context clear — D/4H showing consistent HH/HL (bull) or LH/LL (bear)", weight: "High", category: "Structure" },
      { description: "Price reacting at a key S/R level — not in middle of range", weight: "High", category: "PD_Arrays" },
      { description: "Candlestick confirmation present at the level (pin bar, engulfing, inside bar)", weight: "High", category: "Candle_Patterns" },
      { description: "RR >= minimum configured (default 2.0)", weight: "High", category: "Risk" },
      { description: "No major scheduled news within 30 minutes", weight: "Medium", category: "Risk" },
      { description: "Volume supports the move (if available)", weight: "Medium", category: "Candle_Patterns" },
      { description: "Pattern not forming in a choppy/ranging HTF environment", weight: "Low", category: "Structure" },
    ],
    entry_models: [
      {
        name: "Pin Bar Rejection",
        trigger: "Candle with wick > 2x body size at a key level. Wick points into the level, body closes away. Entry on the open of the next candle or on retest of pin bar 50%.",
        sl_logic: "Beyond the pin bar wick tip.",
        tp_logic: "Next key S/R level. TP2/TP3 at HTF swing levels.",
      },
      {
        name: "Engulfing at Structure",
        trigger: "Full body engulf of the previous candle at a key HTF level. The engulfing candle must close decisively beyond the prior candle's body. Entry on close or retest.",
        sl_logic: "Beyond the low/high of the engulfing candle.",
        tp_logic: "Nearest opposing structure level.",
      },
      {
        name: "Inside Bar Breakout",
        trigger: "Candle range fully inside the prior candle (mother bar). Consolidation complete. Entry on breakout candle close beyond mother bar high/low.",
        sl_logic: "Opposite side of the mother bar.",
        tp_logic: "1x or 2x mother bar range projected forward.",
      },
      {
        name: "Fakey (False Breakout)",
        trigger: "Inside bar setup breaks out but immediately reverses back inside the mother bar range within 1-2 candles. Entry on close back inside the range. This is a trap for breakout traders.",
        sl_logic: "Beyond the false break wick extreme.",
        tp_logic: "Opposing side of mother bar and beyond.",
      },
      {
        name: "Quasimodo (QM)",
        trigger: "Failed higher high in an uptrend — price makes HH then fails to make a higher low, forms a lower low. Entry at retest of the last HL (which becomes resistance). Opposite for downtrend.",
        sl_logic: "Beyond the failed HH extreme.",
        tp_logic: "The lower low formed, then next major S/R.",
      },
      {
        name: "V-Shape Reversal",
        trigger: "Sharp impulsive drop (or rally) followed by an equally sharp recovery candle that closes above the midpoint of the drop. Entry on the recovery candle close.",
        sl_logic: "Below the V-shape reversal low.",
        tp_logic: "Origin of the initial drop (full retracement target).",
      },
    ],
  },

  "Market Structure": {
    description: "Reads the market through sequence of highs and lows. Identifies trend via BOS/CHoCH chains and maps premium/discount zones for entries aligned with institutional narrative.",
    checklist: [
      { description: "HTF narrative clear — consistent BOS sequence confirms trend direction on D/4H", weight: "High", category: "Structure" },
      { description: "BOS/CHoCH sequence valid and unbroken on execution TF", weight: "High", category: "Structure" },
      { description: "Entry positioned in premium (sell) or discount (buy) — 0.5 fib or better", weight: "High", category: "PD_Arrays" },
      { description: "DOL target mapped and reachable within current ADR", weight: "High", category: "Liquidity" },
      { description: "No conflicting structure on intermediate TF (e.g. 1H opposing 15M)", weight: "High", category: "Structure" },
      { description: "Retracement depth proportional — not overextended beyond 0.79 fib", weight: "Medium", category: "Fibonacci" },
      { description: "Momentum of the structural move aligns with entry direction", weight: "Medium", category: "Candle_Patterns" },
    ],
    entry_models: [
      {
        name: "BOS + Retest",
        trigger: "Clean BOS candle closes beyond a key swing point. Price returns to retest the broken structure level. Entry on rejection candle (pin bar or engulfing) at retest.",
        sl_logic: "Beyond the retest level by 3-5 pips.",
        tp_logic: "Next structural target in the BOS chain direction.",
      },
      {
        name: "CHoCH Entry",
        trigger: "First CHoCH after a downtrend (or uptrend). LTF confirms: pullback to CHoCH origin forms a fresh OB or FVG. Entry at that zone on rejection.",
        sl_logic: "Below the CHoCH swing low that triggered the change.",
        tp_logic: "Previous swing high (HTF). TP2/TP3 extend to HTF BOS targets.",
      },
      {
        name: "EQH/EQL Sweep + Reverse",
        trigger: "Price spikes through equal highs or equal lows by a small margin (liquidity grab). Immediate close back through the EQH/EQL level. Entry on that closing candle.",
        sl_logic: "Beyond the sweep wick.",
        tp_logic: "Opposing EQL/EQH. Then HTF structural targets.",
      },
      {
        name: "MSB Confirmation",
        trigger: "Major structure break confirmed on HTF. LTF shows a CHoCH in the same direction. Entry on LTF pullback after CHoCH — into a fresh OB or FVG on LTF.",
        sl_logic: "Below the LTF CHoCH low.",
        tp_logic: "HTF structural targets defined by the MSB.",
      },
      {
        name: "Displacement + Rebalance",
        trigger: "Strong impulsive move leaves a visible FVG (imbalance). Entry when price returns to fill the 50% of that gap with a rejection reaction.",
        sl_logic: "Below the full FVG range.",
        tp_logic: "Prior swing high/low and HTF liquidity.",
      },
    ],
  },

  Wyckoff: {
    description: "Volume-based institutional accumulation and distribution cycle analysis. Identifies markup/markdown phases via Wyckoff schematics.",
    checklist: [
      { description: "Wyckoff phase clearly identified — Accumulation, Markup, Distribution, or Markdown", weight: "High", category: "Structure" },
      { description: "Spring (accumulation) or Upthrust (distribution) event confirmed", weight: "High", category: "Candle_Patterns" },
      { description: "Volume confirmation — volume spike on spring/upthrust, dry-up on test", weight: "High", category: "Candle_Patterns" },
      { description: "Sign of Strength (SOS) or Sign of Weakness (SOW) candle present", weight: "High", category: "Structure" },
      { description: "Markup or markdown continuation phase aligned with entry", weight: "Medium", category: "Structure" },
      { description: "No climactic volume against the trade direction", weight: "Medium", category: "Risk" },
    ],
    entry_models: [
      {
        name: "Spring Reversal",
        trigger: "Price breaks below support (BC/SC zone) on low volume — the spring. Immediately recovers above support. Entry on the test candle after spring with volume dry-up.",
        sl_logic: "Below the spring low.",
        tp_logic: "UAR (upper area of resistance) then prior swing high.",
      },
      {
        name: "LPS Entry (Last Point of Support)",
        trigger: "After SOS break, price retests the broken resistance (now support) on declining volume. Entry at LPS zone on rejection candle.",
        sl_logic: "Below LPS zone.",
        tp_logic: "Measured move from the TR (trading range) depth.",
      },
    ],
  },

  "EMA Trend": {
    description: "Trend-following using EMA stack alignment. Entries on pullbacks to EMA zone in direction of trend.",
    checklist: [
      { description: "EMA stack aligned — fast EMA above slow EMA (bull) or below (bear) on HTF", weight: "High", category: "Structure" },
      { description: "Price pulled back to EMA zone — not extended far from EMAs", weight: "High", category: "PD_Arrays" },
      { description: "Trend continuation candle forms at EMA zone (pin bar, engulfing)", weight: "High", category: "Candle_Patterns" },
      { description: "Momentum indicator confirms (RSI > 50 for bull, < 50 for bear)", weight: "Medium", category: "Indicators" },
      { description: "Market not in chop — ADR expanding not contracting", weight: "Medium", category: "Risk" },
    ],
    entry_models: [
      {
        name: "EMA Pullback Continuation",
        trigger: "Price in uptrend pulls back to the fast EMA zone. Rejection candle forms touching or piercing EMA. Entry on close of rejection candle.",
        sl_logic: "Below the slow EMA + buffer.",
        tp_logic: "Previous swing high. Extend to HTF resistance.",
      },
      {
        name: "EMA Cross Retest",
        trigger: "Fast EMA crosses above/below slow EMA (trend shift). Price retests the cross level. Entry on rejection at the cross zone.",
        sl_logic: "Beyond the cross zone.",
        tp_logic: "1.5-2x the distance from SL to entry, extended to next S/R.",
      },
    ],
  },

  Breakout: {
    description: "Identifies range boundaries and enters on confirmed breakout candle close with retest validation.",
    checklist: [
      { description: "Range clearly defined — at least 3 touches on both boundaries", weight: "High", category: "Structure" },
      { description: "Breakout candle closes decisively beyond range boundary (not just a wick)", weight: "High", category: "Candle_Patterns" },
      { description: "Retest of broken boundary holds — closes back on breakout side", weight: "High", category: "Structure" },
      { description: "Volume expansion on breakout candle relative to range candles", weight: "Medium", category: "Candle_Patterns" },
      { description: "False-break risk checked — no major S/R just beyond the breakout level", weight: "Medium", category: "Risk" },
    ],
    entry_models: [
      {
        name: "Breakout Retest Entry",
        trigger: "Price breaks range cleanly with body close. Retests the breakout level. Rejection candle confirms hold. Entry on confirmation candle close.",
        sl_logic: "Back inside the range beyond the boundary.",
        tp_logic: "1x range height projected from breakout point.",
      },
      {
        name: "Anticipatory Breakout",
        trigger: "Price compressing near boundary with decreasing candle size (triangle/wedge). Entry on close beyond boundary — no retest wait.",
        sl_logic: "Back inside range midpoint.",
        tp_logic: "Range height measured from the first touch of the boundary.",
      },
    ],
  },

  VWAP: {
    description: "Session-anchored VWAP used as dynamic S/R. Entries on reclaim or rejection of VWAP in context of session bias.",
    checklist: [
      { description: "Price vs VWAP bias clear — above VWAP (bull) or below (bear) for the session", weight: "High", category: "Structure" },
      { description: "VWAP reclaim (bull) or VWAP rejection (bear) candle confirmed", weight: "High", category: "Candle_Patterns" },
      { description: "Session anchor context aligned — not using prior session VWAP for current session", weight: "High", category: "Session" },
      { description: "VWAP confluence with nearby S/R or PD array", weight: "Medium", category: "PD_Arrays" },
      { description: "Risk controlled — SL beyond VWAP deviation band not just VWAP line", weight: "Medium", category: "Risk" },
    ],
    entry_models: [
      {
        name: "VWAP Reclaim",
        trigger: "Price dips below VWAP intraday, then candle closes back above VWAP. Entry on the reclaim close.",
        sl_logic: "Below the low of the reclaim candle.",
        tp_logic: "VWAP +1 standard deviation band. Then prior high.",
      },
      {
        name: "VWAP Rejection",
        trigger: "Price rallies to VWAP from below (in downtrend) and fails — rejection candle closes back below. Entry on close.",
        sl_logic: "Above VWAP + small buffer.",
        tp_logic: "Session low. Then VWAP -1 deviation.",
      },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// PROFILE PRESETS
// ─────────────────────────────────────────────────────────────────────────────

export const PROFILE_PRESETS = {
  position: { label: "Position (w+d / 4h / 1h)", htf_tfs: ["w", "d"], exec_tfs: ["4h"], conf_tfs: ["1h"], sessions: "Any", rr: "3" },
  swing:    { label: "Swing (d+4h / 1h / 15m)",  htf_tfs: ["d", "4h"], exec_tfs: ["1h"], conf_tfs: ["15m"], sessions: "Any", rr: "2" },
  day:      { label: "Daily (d+4h / 15m / 5m)",  htf_tfs: ["d", "4h"], exec_tfs: ["15m"], conf_tfs: ["5m"], sessions: "Any", rr: "1" },
  scalper:  { label: "Scalping (4h+1h / 5m / 1m)", htf_tfs: ["4h", "1h"], exec_tfs: ["5m"], conf_tfs: ["1m"], sessions: "Any", rr: "1" },
};

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT CONFIG
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG = {
  symbol: "", asset: "Auto detect", session: "Any", rr: "2", risk: "1",
  lookbackBars: "300", strategies: ["ICT", "Price Action", "Market Structure"],
  profile: "day",
  htf_tfs: [...PROFILE_PRESETS.day.htf_tfs],
  exec_tfs: [...PROFILE_PRESETS.day.exec_tfs],
  conf_tfs: [...PROFILE_PRESETS.day.conf_tfs],
  htfbias: "", dir: "Direction: Both", news: "", notes: "",
};

// ─────────────────────────────────────────────────────────────────────────────
// AI RESPONSE SCHEMA
//
// DESIGN PRINCIPLES:
//   1. HTF (D, 4H etc.) — bias, reference zones, and DOL ONLY.
//      HTF zones are included only when they serve a specific role:
//      TP_Target | Entry_Boundary | DOL | Invalidation.
//      No full PD array listing, no checklist, no path steps at HTF.
//   2. LTF (15M, 5M etc.) — full detail: structure, PD arrays, key levels,
//      expected path, and key events. This is the execution layer.
//   3. Confluence checklist belongs to the STRATEGY, not the entry model.
//      Only PASSED items are listed. Failed HIGH-weight items are listed
//      separately as failed_critical (blockers). Medium/Low failures omitted.
//   4. Trade plan is pure execution output. Entry, SL, TP all derived from
//      LTF analysis anchored to HTF reference zones.
//   5. estimate_candles_that_entry_happens = 0 means entry condition is
//      already met (e.g. price already inside OB). Higher = further away.
// ─────────────────────────────────────────────────────────────────────────────

export const AI_RESPONSE_SCHEMA = {
  symbol: "",

  ai_full_analysis: {

    // ── HTF LAYER ─────────────────────────────────────────────────
    // Purpose: define bias, price narrative, DOL, and zones that
    //          anchor TP levels or define entry region boundaries.
    // Do NOT: list full PD arrays, key events, or path steps here.
    // ─────────────────────────────────────────────────────────────
    htf_context: [
      {
        timeframe: "D|4H|W",
        trend: "Bullish|Bearish|Ranging",
        bias: "Long|Short|Neutral",
        what_price_just_did: "",       // factual — last confirmed structural move
        what_price_likely_does_next: "", // forward narrative — one sentence

        draw_on_liquidity: {
          narrative: "",               // WHY this is the target
          target_price: null,
          target_type: "BSL|SSL|FVG|OB|Void|PDH|PDL|EQH|EQL",
        },

        // HTF zones included ONLY if they play a specific role in the trade.
        // Each zone must have a relevance tag — do not list zones without one.
        reference_zones: [
          {
            id: "",                    // e.g. "D-OB-1", "4H-FVG-2"
            type: "OB|FVG|Breaker|Void|BSL|SSL|PDH|PDL|EQH|EQL|WeeklyOpen|DailyOpen|MidnightOpen",
            direction: "Bullish|Bearish",
            zone_top: null,
            zone_bottom: null,
            status: "Fresh|Tested|Mitigated|Broken",
            relevance: "TP_Target|Entry_Boundary|DOL|Invalidation",
          },
        ],
      },
    ],

    // ── LTF LAYER ─────────────────────────────────────────────────
    // Purpose: identify exact entry structure, PD arrays, key levels,
    //          confirmation events, and step-by-step expected path.
    // This is the execution and confirmation timeframe detail.
    // ─────────────────────────────────────────────────────────────
    ltf_analysis: [
      {
        timeframe: "15M|5M|1M",
        trend: "Bullish|Bearish|Ranging",
        structure: "BOS|CHoCH|MSB|Continuation|Ranging",
        phase: "Trending|Retracement|Reversal|Consolidation|Breakout|Breakdown|Distribution|Accumulation",
        bias: "Long|Short|Neutral",
        poi_aligned: true,              // true if price is at or approaching a valid POI
        what_price_just_did: "",        // factual last structural event on this TF
        what_price_likely_does_next: "",

        // Significant structural or candle events on this LTF
        key_events: [
          {
            event: "BOS|CHoCH|MSB|Sweep|Rejection|Engulfing|PinBar|Doji|EQH|EQL|BSL|SSL",
            price: null,
            time: null,                 // ISO string or unix if available
            direction: "Bullish|Bearish",
          },
        ],

        // Step-by-step path price must take before entry is valid.
        // entry model is only triggered when step conditions are met in sequence.
        expected_path: [
          {
            step: 1,
            action: "Retrace|Continue|Sweep|Reverse|Break|Consolidate",
            target_price: null,
            required_condition: "",     // exact condition needed before next step
          },
        ],

        // LTF PD arrays near current price that directly influence entry/SL
        pd_arrays: [
          {
            id: "",                     // e.g. "15M-OB-1", "5M-FVG-1"
            type: "OB|FVG|Breaker|Mitigation|Void|Rejection|Propulsion",
            direction: "Bullish|Bearish",
            strength: "Strong|Weak",
            zone_top: null,
            zone_bottom: null,
            status: "Fresh|Tested|Mitigated|Broken",
            times_touched: 0,
            note: "",
          },
        ],

        // Key price levels on LTF relevant to entry/SL/TP1
        key_levels: [
          {
            name: "PDH|PDL|WeeklyOpen|DailyOpen|MidnightOpen|NYOpen|EQH|EQL|BSL|SSL",
            price: null,
            already_swept: false,
          },
        ],
      },
    ],

    // ── CONFLUENCE CHECKLIST ──────────────────────────────────────
    // Belongs to the STRATEGY, not the entry model.
    // Evaluated before entry model is considered.
    //
    // passed_items   : only items that ARE confirmed. Do not list unmet items here.
    // failed_critical: only High-weight items that are NOT met (blockers).
    //                  Medium/Low failures are omitted — they are reflected in score only.
    //
    // weighted_score calculation:
    //   High item passed   = 3 points
    //   Medium item passed = 2 points
    //   Low item passed    = 1 point
    //   Score = (sum of passed points / sum of all possible points) * 100
    // ─────────────────────────────────────────────────────────────
    confluence_checklist: {
      buy: {
        weighted_score: 0,            // 0-100
        high_weight_passed: 0,        // count of High-weight items that passed
        high_weight_total: 0,         // total High-weight items for this strategy
        passed_items: [
          {
            strategy: "ICT|SMC|Price Action|Market Structure|Wyckoff|EMA Trend|Breakout|VWAP",
            category: "Structure|PD_Arrays|Liquidity|Session|Fibonacci|Candle|Correlation|Risk",
            description: "",          // what condition was confirmed — be specific
            weight: "High|Medium|Low",
            linked_array_id: null,    // references htf reference_zones.id or ltf pd_arrays.id
          },
        ],
        failed_critical: [
          {
            strategy: "",
            description: "",          // which High-weight condition was NOT met
            impact: "",               // why this matters — consequence of missing it
          },
        ],
      },
      sell: {
        weighted_score: 0,
        high_weight_passed: 0,
        high_weight_total: 0,
        passed_items: [],
        failed_critical: [],
      },
    },
  },

  // ── TRADE PLAN ────────────────────────────────────────────────
  // Pure execution output. Only populated when:
  //   - high_weight_passed / high_weight_total >= 0.75
  //   - weighted_score >= 65
  //   - RR >= min_rr configured
  //   - ADR has room for TP1 minimum
  // Return empty array [] if no valid setup exists.
  // Max 2 plans, sorted by confidence_pct descending.
  //
  // Entry, SL, and TP must be derived from LTF pd_arrays and
  // anchored to HTF reference_zones. Never arbitrary.
  // ─────────────────────────────────────────────────────────────
  trade_plan: [
    {
      // ── IDENTITY ──────────────────────────────────────────────
      direction: "BUY|SELL",
      profile: "Position|Swing|Intraday|Scalp",
      order_type: "Limit|Stop Limit|Market",
      // Use Market only when entry condition is already met and
      // waiting risks missing the trade entirely.
      session: "Asian|London|NewYork|Overlap",
      strategy: "ICT|SMC|Price Action|Market Structure|Wyckoff|EMA Trend|Breakout|VWAP",
      entry_model: "",  // exact name from STRATEGY_ENTRY_MODELS e.g. "OB + FVG Confluence"

      // ── LEVELS ────────────────────────────────────────────────
      entry_price: null,
      stop_loss: null,
      breakeven_trigger: null,    // price at which to move SL to entry (usually after TP1 hit)
      take_profits: [
        {
          price: null,
          close_position_pct: 50, // partial close percentage
          reward_to_risk: null,
          reference: "",          // HTF reference_zones.id that justifies this TP level
        },
        {
          price: null,
          close_position_pct: 30,
          reward_to_risk: null,
          reference: "",
        },
        {
          price: null,
          close_position_pct: 20,
          reward_to_risk: null,
          reference: "",
        },
      ],

      // ── RISK ──────────────────────────────────────────────────
      risk_reward: null,          // calculated from entry to SL vs entry to TP1
      risk_percent: null,         // 1.0 if score>=85 | 0.5 if score 65-84 | 0.25 if score<65
      estimated_candles_to_tp1: null, // expected candle count on execution TF to reach TP1

      // ── TIMING ────────────────────────────────────────────────
      // 0 = entry condition already met right now — act immediately or use Market.
      // 1-5 = within a few candles on execution TF.
      // 6+ = setup needs more time to develop — set limit order and wait.
      estimate_candles_that_entry_happens: null,

      // ── CONDITIONS ────────────────────────────────────────────
      entry_trigger: "",          // exact condition: "15M candle closes inside 15M-OB-1 with rejection wick"
      mid_trade_invalidation: "", // condition that cancels trade AFTER entry e.g. "15M closes below OB zone"
      pre_entry_invalidation: "", // condition that cancels setup BEFORE entry e.g. "price closes above 4H-OB-1"

      // ── DECISION ──────────────────────────────────────────────
      confluence_score: 0,        // mirrors confluence_checklist buy/sell weighted_score
      trade_decision: "Proceed|Wait|Reduce|Skip",
      skip_reasons: [
        {
          reason: "",
          severity: "High|Medium|Low",
        },
      ],

      // ── VERDICT ───────────────────────────────────────────────
      grade: "A|B|C|NoTrade",     // A = score>=85 + all high passed | B = score 65-84 | C = marginal
      confidence_pct: 0,          // 0-100 overall conviction including timing and context
      note: "",
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// GUIDE TEXT
// This is injected into the prompt. It is the most critical instruction block.
// ─────────────────────────────────────────────────────────────────────────────

export const GUIDE_TEXT = `
ANALYSIS APPROACH — READ THIS CAREFULLY BEFORE ANALYZING:

═══════════════════════════════════════════════════
STEP 1 — HTF ANALYSIS (Bias, Direction, Targets)
═══════════════════════════════════════════════════
Use D and 4H charts ONLY to establish:
  1. Trend direction — sequence of HH/HL (bull) or LH/LL (bear).
  2. Where price is in the macro range — premium (above 0.5 fib) or discount (below).
  3. Draw on Liquidity (DOL) — the nearest unswept BSL or SSL, or an unfilled HTF FVG / OB that price is being pulled toward. This becomes TP2 or TP3.
  4. Reference zones — HTF OB/FVG/key levels that act as TP targets, entry region boundaries, or invalidation levels. ONLY map zones with a clear role. Do not list every zone you see.
  5. What price just did and what it is likely to do next — one sentence each.

HTF defines the CONTEXT. It tells you WHERE entries are valid and WHERE TPs should be anchored.
Do not look for entries on HTF. Do not score confluence on HTF.

═══════════════════════════════════════════════════
STEP 2 — LTF ANALYSIS (Entry, Confirmation, Precision)
═══════════════════════════════════════════════════
Use 15M (execution) and 5M (confirmation) to identify:
  1. Current LTF structure — BOS/CHoCH chain confirming alignment with HTF bias.
  2. PD arrays near current price — OB, FVG, Breaker. Only those within 1-2% of current price.
  3. Key levels — PDH, PDL, MidnightOpen, EQH, EQL. Only those directly relevant to the setup.
  4. Expected path — step by step what price must do before entry is valid.
  5. Key events — BOS, CHoCH, sweeps, rejection candles. Include price and time.

LTF defines the ENTRY TIMING. Entry, SL, and TP1 must come from LTF zones.
TP2 and TP3 must be anchored to HTF reference zones mapped in Step 1.

═══════════════════════════════════════════════════
STEP 3 — STRATEGY CHECKLIST SCORING
═══════════════════════════════════════════════════
For each active strategy, score buy and sell independently.
  - High item passed = 3 points. Medium = 2 points. Low = 1 point.
  - weighted_score = (passed points / total possible points) * 100.
  - List ONLY passed items in passed_items[].
  - List ONLY failed High-weight items in failed_critical[] with impact explanation.
  - Do not list failed Medium or Low items — they are noise.

GATE: high_weight_passed / high_weight_total must be >= 0.75 to proceed.
If gate fails → trade_plan = [] regardless of score.

═══════════════════════════════════════════════════
STEP 4 — ENTRY MODEL SELECTION
═══════════════════════════════════════════════════
Only scan for entry models AFTER checklist gate is passed.
Select the entry model that best matches current LTF conditions.
The entry model name MUST exactly match a name from the ACTIVE ENTRY MODELS section above.
Do not use entry models not listed there.

The strategy, entry_model, profile, order_type, session, and trade direction must ALL be internally consistent.

STEP 5 — TRADE PLAN CONSTRUCTION
═══════════════════════════════════════════════════
Only construct a trade plan when ALL of the following are true:
  ✓ Checklist gate passed (high_weight_passed / high_weight_total >= 0.75)
  ✓ weighted_score >= 65
  ✓ A valid entry model trigger is identifiable on LTF
  ✓ RR >= configured min_rr (use the MinRR value from CONTEXT above)
  ✓ ADR has sufficient remaining range to reach TP1
  ✓ No conflicting HTF structure opposing the trade direction

If any condition fails → return trade_plan as empty array []. Do not force a setup.

ENTRY PRICE: from LTF PD array (OB top/bottom, FVG midpoint).
STOP LOSS: beyond the LTF PD array extreme + buffer. Derived from entry model SL logic.
TP1: nearest LTF liquidity target (EQH/EQL or PDH/PDL). Must be reachable within ADR.
TP2: HTF reference zone mapped in htf_context (BSL/SSL or HTF FVG/OB).
TP3: HTF DOL target (draw_on_liquidity.target_price).

TP references must link to htf_context.reference_zones[].id — never arbitrary.

ORDER TYPE RULES:
  - Limit: use when price has not yet reached the entry zone.
  - Stop Limit: use when entry requires a breakout confirmation before filling.
  - Market: ONLY when estimate_candles_that_entry_happens = 0 AND waiting risks missing the trade.

ESTIMATE CANDLES THAT ENTRY HAPPENS:
  0 = entry condition met RIGHT NOW — can use Market order.
  1-5 = entry expected within a few candles — set Limit order.
  6+ = setup needs development — set Limit and monitor.

RISK SIZING:
  weighted_score >= 85 AND grade = A → risk_percent = 1.0%
  weighted_score 65-84 AND grade = B → risk_percent = 0.5%
  weighted_score < 65 OR grade = C  → risk_percent = 0.25% (or skip)

GRADE RULES:
  A = score >= 85 AND all High-weight items passed AND RR >= configured min_rr
  B = score 65-84 AND high_weight_passed/high_weight_total >= 0.75 AND RR >= configured min_rr
  C = score 50-64 OR RR borderline — reduce size, consider skipping
  NoTrade = score < 50 OR high gate failed OR RR < configured min_rr

SKIP REASONS (skip_reasons[]):
  Only populate when trade_decision !== "Proceed". Leave empty [] when Proceed.
  Each entry: { reason: "...", severity: "critical" | "warning" }
  Critical = gate/score/RR failure. Warning = borderline ADR, uncertain model trigger.

MULTI-STRATEGY SCORING:
  When multiple strategies are active, score each independently for both BUY and SELL.
  Do NOT average scores across strategies. Each direction's score is the BEST among active strategies.
  If one strategy passes the gate and another fails, only the passing strategy's direction is valid.
  The winning strategy must be listed in trade_plan[].strategy.

═══════════════════════════════════════════════════
GENERAL RULES
═══════════════════════════════════════════════════
- Analyze HTF to LTF in sequence. Never reverse this order.
- Maximum 2 trade plans. Sort by confidence_pct descending.
- what_price_just_did must be factual (past tense). what_price_likely_does_next is forward-looking.
- Do not generate plans for both BUY and SELL unless both pass the checklist gate independently.
- Keep only relevant PD arrays near current price. Do not list every array visible on chart.
- Use empty string "" for narrative fields when evidence is weak — do not fabricate narrative.
- Return STRICT JSON only. No markdown, no prose, no explanation outside the JSON.
`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

export function getEffectiveTfConfig(cfg) {
  const profileKey = String(cfg?.profile || "").trim().toLowerCase();
  const preset = PROFILE_PRESETS[profileKey] || PROFILE_PRESETS.day;
  return {
    profile: PROFILE_PRESETS[profileKey] ? profileKey : "day",
    htf_tfs: Array.isArray(cfg?.htf_tfs) && cfg.htf_tfs.length ? cfg.htf_tfs : [...preset.htf_tfs],
    exec_tfs: Array.isArray(cfg?.exec_tfs) && cfg.exec_tfs.length ? cfg.exec_tfs : [...preset.exec_tfs],
    conf_tfs: Array.isArray(cfg?.conf_tfs) && cfg.conf_tfs.length ? cfg.conf_tfs : [...preset.conf_tfs],
    sessions: cfg?.session || preset.sessions,
    rr: cfg?.rr || preset.rr,
  };
}

export function buildPrompt(cfg) {
  const tfConfig = getEffectiveTfConfig(cfg);
  const profileLabel = { position: "position", swing: "swing", day: "daily", scalper: "scalping" }[tfConfig.profile] || "daily";
  const symbol = String(cfg.symbol || "UK100").trim() || "UK100";
  const strategy = cfg.strategies.join(", ") || "ICT";

  const context = [];
  if (cfg.htfbias) context.push(`htf_bias_override: "${cfg.htfbias}"`);
  if (cfg.dir)     context.push(`direction: "${cfg.dir}"`);
  if (cfg.news)    context.push(`news_risk: "${cfg.news}"`);
  if (cfg.session && cfg.session !== "Any") context.push(`session: "${cfg.session}"`);
  if (cfg.notes)   context.push(`notes: "${cfg.notes}"`);

  // Build active strategy reference with checklist items and entry model details
  const strategyRef = cfg.strategies
    .filter((s) => STRATEGY_ENTRY_MODELS[s])
    .map((s) => {
      const def = STRATEGY_ENTRY_MODELS[s];
      const checkItems = def.checklist
        .map((c) => `  [${c.weight}] ${c.description}`)
        .join("\n");
      const models = def.entry_models
        .map((m) => `  ${m.name} | Trigger: ${m.trigger} | SL: ${m.sl_logic} | TP: ${m.tp_logic}`)
        .join("\n");
      return `${s}:
Checklist:\n${checkItems}\nEntry Models:\n${models}`;
    })
    .join("\n\n  ");

  return `## CONTEXT
Symbol:${symbol} | Class:${cfg.asset} | Session:${cfg.session || "Any"} | Profile:${profileLabel} | MinRR:${cfg.rr} | MaxRisk:${cfg.risk}%
HTF:${tfConfig.htf_tfs.map((x) => String(x).toUpperCase()).join(",")} | Execution:${tfConfig.exec_tfs.map((x) => String(x).toUpperCase()).join(",")} | Confirmation:${tfConfig.conf_tfs.map((x) => String(x).toUpperCase()).join(",")}
Strategies: ${strategy}
${context.length ? `Overrides: ${context.join("; ")}` : ""}

## ACTIVE ENTRY MODELS
  ${strategyRef}

## INSTRUCTIONS
${GUIDE_TEXT}

## OUTPUT
Return strict JSON matching the AI_RESPONSE_SCHEMA. No markdown. No prose. JSON only.
Backend appends full schema, enums, and array limits separately.`;
}

export function buildJsonConfig(cfg) {
  const tfConfig = getEffectiveTfConfig(cfg);
  return JSON.stringify(
    {
      version: "2.2",
      saved_at: new Date().toISOString(),
      config: {
        symbol: cfg.symbol,
        profile: tfConfig.profile,
        asset_class: cfg.asset,
        strategy: cfg.strategies.join(" + "),
        strategies: cfg.strategies,
        session: cfg.session,
        min_rr: Number(cfg.rr),
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
        lookback_bars: Number(cfg.lookbackBars),
        timeframe_array: {
          htf_bias_tfs: tfConfig.htf_tfs,
          execution_tf: tfConfig.exec_tfs,
          confirmation_tf: tfConfig.conf_tfs,
        },
      },
    },
    null,
    2
  );
}

/** Build compact schema/enum string for backend to append to prompt */
export function buildSchemaString() {
  return JSON.stringify({
    schema_version: "2.2",
    enums: {
      tf: ["MN","W","D","4H","1H","15M","5M","1M"],
      trend: ["Bullish","Bearish","Ranging"],
      structure: ["BOS","CHoCH","MSB","Continuation","Ranging"],
      phase: ["Trending","Retracement","Reversal","Consolidation","Breakout","Breakdown","Distribution","Accumulation"],
      bias: ["Long","Short","Neutral"],
      direction: ["Bull","Bear"],
      weight: ["High","Medium","Low"],
      order_type: ["Limit","Stop Limit","Market"],
      trade_decision: ["Proceed","Skip"],
      severity: ["critical","warning"],
      grade: ["A","B","C","NoTrade"],
    },
    arrays: { max_trade_plans: 2, max_pd_arrays: 6, max_key_levels: 6, max_reference_zones: 6 },
  });
}

// Backward compatibility alias
export const STRATEGY_CHECKLIST = STRATEGY_ENTRY_MODELS;
