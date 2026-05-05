// AI Prompt Builder — constants and functions for building AI analysis prompts
// Extracted from ChartSnapshotsPage

export const STRATEGY_OPTIONS = [
  "ICT", "SMC", "Price Action", "Market Structure", "Wyckoff",
  "EMA Trend", "Breakout", "VWAP", "Mean Reversion", "Order Flow",
  "Volatility", "Trend Following", "Divergence",
];

export const STRATEGY_CHECKLIST = {
  ICT: ["Liquidity sweep","BOS/CHoCH confirmed","PD Array reaction","Displacement candle","London/NY killzone alignment"],
  "Market Structure": ["HTF narrative clear","BOS/CHoCH sequence valid","Premium/Discount aligned","DOL target mapped","No structure conflict"],
  SMC: ["Liquidity grab","Structure break","Order block mitigation","Imbalance/FVG reaction","HTF bias alignment"],
  "Price Action": ["Trend context clear","Key S/R reaction","Candlestick confirmation","RR >= target","No major news conflict"],
  Wyckoff: ["Phase identified","Spring/Upthrust event","Volume confirmation","Sign of strength/weakness","Markup/markdown continuation"],
  "EMA Trend": ["EMA stack aligned","Pullback to EMA zone","Trend continuation candle","Momentum confirmation","Avoid chop/range"],
  Breakout: ["Range clearly defined","Valid breakout close","Retest holds","Volume expansion","False-break risk checked"],
  VWAP: ["Price vs VWAP bias","VWAP reclaim/reject","Session anchor context","Confluence with S/R","Risk controlled around VWAP"],
};

export const PROFILE_PRESETS = {
  position: { label: "Position (w+d / 4h / 1h)", htf_tfs: ["w","d"], exec_tfs: ["4h"], conf_tfs: ["1h"], sessions: "Any", rr: "3" },
  swing: { label: "Swing (d+4h / 1h / 15m)", htf_tfs: ["d","4h"], exec_tfs: ["1h"], conf_tfs: ["15m"], sessions: "Any", rr: "2" },
  day: { label: "Daily (d+4h / 15m / 5m)", htf_tfs: ["d","4h"], exec_tfs: ["15m"], conf_tfs: ["5m"], sessions: "Any", rr: "1" },
  scalper: { label: "Scalping (4h+1h / 5m / 1m)", htf_tfs: ["4h","1h"], exec_tfs: ["5m"], conf_tfs: ["1m"], sessions: "Any", rr: "1" },
};

export const DEFAULT_CONFIG = {
  symbol: "", asset: "Auto detect", session: "Any", rr: "2", risk: "1",
  lookbackBars: "300", strategies: ["ICT","Price Action","Market Structure"],
  profile: "day",
  htf_tfs: [...PROFILE_PRESETS.day.htf_tfs],
  exec_tfs: [...PROFILE_PRESETS.day.exec_tfs],
  conf_tfs: [...PROFILE_PRESETS.day.conf_tfs],
  htfbias: "", dir: "Direction: Both", news: "", notes: "",
};

export const AI_RESPONSE_SCHEMA = {
  symbol: "",
  timeframes: [{ tf: "MN|W|D|4H|1H|15M|5M|1M", trend: "Bullish|Bearish|Ranging", structure: "BOS|CHoCH|MSB|Continuation|Ranging", phase: "Trending|Retracement|Reversal|Consolidation|Breakout|Breakdown|Distribution|Accumulation", bias: "Long|Short|Neutral", poiAlign: true, strongEvents: [{ event: "BOS|CHoCH|MSB|Retest|Sweep|Discount|Premium|Rejection|Doji|Engulfing|Cross_EMA|EQH|EQL|BSL|SSL", price: null, time: null, direction: "Bull|Bear" }] }],
  tradePlan: [{ dir: "BUY|SELL", profile: "Position|Swing|Intraday|Scalp", type: "Limit|Stop Limit|Market", strategy: "", entry_model: "", entry: null, sl: null, be: null, tp: null, tp2: null, tp3: null, rr: null, estimated_bars: null, confluence_checklist: ["Checklist1","Checklist2"], action: { exit_condition: "", entry_condition: "", risk_management: "none|low|normal|high", recommendation: "Skip|Proceed|Wait" }, note: "" }],
};

export const GUIDE_TEXT = `Compact ICT guide:
- Analyze HTF to LTF. did=factual past move, next=likely path.
- Keep only relevant PD arrays near current price and swept/key liquidity.
- Evaluate buy and sell independently using High/Medium evidence only.
- Generate max 2 plans only when highPassed/highTotal >= 0.6.
- Use empty strings for weak narrative; avoid filler.`;

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
  if (cfg.dir) context.push(`direction: "${cfg.dir}"`);
  if (cfg.news) context.push(`news_risk: "${cfg.news}"`);
  if (cfg.session && cfg.session !== "Any") context.push(`session: "${cfg.session}"`);
  if (cfg.notes) context.push(`notes: "${cfg.notes}"`);
  const tfJson = JSON.stringify({ htf_bias_tfs: tfConfig.htf_tfs, execution_tf: tfConfig.exec_tfs, confirmation_tf: tfConfig.conf_tfs }, null, 2);

  return `## CONTEXT
Symbol:${symbol}|Class:${cfg.asset}|Session:${cfg.session || "Any"}|Profile:${profileLabel}|MinRR:${cfg.rr}|MaxRisk:${cfg.risk}%
TFs:${[...tfConfig.htf_tfs, ...tfConfig.exec_tfs, ...tfConfig.conf_tfs].map((x) => String(x).toUpperCase()).join(",")}
Strategies:${strategy}
${context.length ? `Notes:${context.join("; ")}` : ""}

## INSTRUCTIONS
Analyze attached charts HTF->LTF. Per TF identify trend, structure, phase, bias, what price did, and likely next path.
Include only relevant PD arrays near current price, key liquidity/open levels, one DOL, concise buy/sell checklist, and max 2 trade plans.
Prior cached analysis, if present in context, is reference only: re-derive scores and flag changed bias/broken POIs/invalidated plans.
Return compact JSON only; backend appends schema/enums/array limits.`;
}

export function buildJsonConfig(cfg) {
  const tfConfig = getEffectiveTfConfig(cfg);
  return JSON.stringify({
    version: "2.1", saved_at: new Date().toISOString(),
    config: {
      symbol: cfg.symbol, profile: tfConfig.profile, asset_class: cfg.asset,
      strategy: cfg.strategies.join(" + "), strategies: cfg.strategies,
      session: cfg.session, min_rr: Number(cfg.rr), max_risk_pct: Number(cfg.risk),
      daily_adr_filter: true, killzones_est: ["02:00-05:00","07:00-10:00"],
      risk_tiers_pct: { high_confluence_gt_85: 1.0, standard: 0.5, high_risk: 0.25 },
      required_patterns: ["V-Shape","Quasimodo","Flag","Triangle","Pin Bar","Inside Bar","Fakey"],
      lookback_bars: Number(cfg.lookbackBars),
      timeframe_array: { htf_bias_tfs: tfConfig.htf_tfs, execution_tf: tfConfig.exec_tfs, confirmation_tf: tfConfig.conf_tfs },
    },
  }, null, 2);
}
