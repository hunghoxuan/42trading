import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createChart } from "lightweight-charts";
import { showDateTime, isSameDay } from "../../utils/format";

import { api } from "../../api";
import { SignalDetailCard } from "../../components/SignalDetailCard";
import TradeSignalChart from "../../components/TradeSignalChart";
import { SymbolChart } from "../../components/charts/ChartTile";
import { chartFetchManager } from "../../services/chartFetchManager";

const STORAGE_KEY = "chart_prompt_builder_templates_v2";

const STRATEGY_OPTIONS = [
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

const STRATEGY_CHECKLIST = {
  ICT: [
    "Liquidity sweep",
    "BOS/CHoCH confirmed",
    "PD Array reaction",
    "Displacement candle",
    "London/NY killzone alignment",
  ],
  "Market Structure": [
    "HTF narrative clear",
    "BOS/CHoCH sequence valid",
    "Premium/Discount aligned",
    "DOL target mapped",
    "No structure conflict",
  ],
  SMC: [
    "Liquidity grab",
    "Structure break",
    "Order block mitigation",
    "Imbalance/FVG reaction",
    "HTF bias alignment",
  ],
  "Price Action": [
    "Trend context clear",
    "Key S/R reaction",
    "Candlestick confirmation",
    "RR >= target",
    "No major news conflict",
  ],
  Wyckoff: [
    "Phase identified",
    "Spring/Upthrust event",
    "Volume confirmation",
    "Sign of strength/weakness",
    "Markup/markdown continuation",
  ],
  "EMA Trend": [
    "EMA stack aligned",
    "Pullback to EMA zone",
    "Trend continuation candle",
    "Momentum confirmation",
    "Avoid chop/range",
  ],
  Breakout: [
    "Range clearly defined",
    "Valid breakout close",
    "Retest holds",
    "Volume expansion",
    "False-break risk checked",
  ],
  VWAP: [
    "Price vs VWAP bias",
    "VWAP reclaim/reject",
    "Session anchor context",
    "Confluence with S/R",
    "Risk controlled around VWAP",
  ],
};

const DEFAULT_TEMPLATE_ID = "__default__";
const SYMBOLS_SETTING_TYPE = "SYMBOLS";

const DEFAULT_WATCHLIST = [
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "BTCUSD",
  "ETHUSD",
  "XAUUSD",
  "US30",
  "US500",
  "USTEC",
  "DXY",
];

// Fixed default sets for asset-type filter tabs
const DEFAULT_CRYPTO_SYMBOLS = [
  "BTCUSD",
  "ETHUSD",
  "BNBUSD",
  "SOLUSD",
  "XRPUSD",
  "LINKUSD",
  "NEARUSD",
  "BCHUSD",
  "LTCUSD",
  "DOGEUSD",
  "HBARUSD",
  "AVAXUSD",
  "ADAUSD",
  "DOTUSD",
  "1000XSHIBUSD",
  "XLMUSD",
  "XTZUSD",
];
const DEFAULT_FOREX_SYMBOLS = [
  "EURUSD",
  "EURGBP",
  "EURJPY",
  "EURCAD",
  "EURSGD",
  "EURNZD",
  "EURAUD",
  "EURHKD",
  "USDJPY",
  "USDCAD",
  "USDHKD",
  "USDSGD",
  "GBPJPY",
  "GBPUSD",
  "GBPNZD",
  "GBPCAD",
  "GBPAUD",
  "AUDCHF",
  "AUDCAD",
  "AUDNZD",
  "AUDJPY",
  "AUDUSD",
  "NZDUSD",
  "NZDJPY",
];
const DEFAULT_COMMODITY_SYMBOLS = [
  "XAUGBP",
  "XAUUSD",
  "XAUEUR",
  "XAUJPY",
  "XAGUSD",
  "XTIUSD",
  "XPTUSD",
  "XNGUSD",
  "XBRUSD",
];
const DEFAULT_INDICES_SYMBOLS = [
  "US500",
  "US30",
  "USTEC",
  "UK100",
  "TECDE30",
  "DE40",
  "DE30",
  "CA60",
  "CHINAH",
  "SWI20",
  "AUS200",
  "CHINA50",
  "JP225",
];

const DEFAULT_SMT_GROUPS = [
  { name: "EUR / GBP", symbols: ["EURUSD", "GBPUSD"] },
  { name: "BTC / ETH", symbols: ["BTCUSD", "ETHUSD"] },
  { name: "AUD / NZD", symbols: ["AUDUSD", "NZDUSD"] },
  { name: "GOLD / SILVER", symbols: ["XAUUSD", "XAGUSD"] },
  { name: "DXY / EUR", symbols: ["DXY", "EURUSD"] },
  { name: "Indices (US30 / NAS / SPX)", symbols: ["US30", "NAS100", "SPX500"] },
  { name: "DXY / Indices", symbols: ["DXY", "SPX500"] },
  { name: "Oil / CAD", symbols: ["USOIL", "USDCAD"] },
];
const DEFAULT_SMT_SYMBOLS = [
  ...new Set(DEFAULT_SMT_GROUPS.flatMap((g) => g.symbols)),
];

// Classify a symbol as crypto/forex/other (deterministic, conservative)
const CRYPTO_PREFIXES = new Set([
  "BTC",
  "ETH",
  "ADA",
  "BNB",
  "XRP",
  "SOL",
  "DOGE",
  "LTC",
  "LINK",
  "DOT",
  "BCH",
  "MATIC",
  "TRX",
  "AVAX",
  "SHIB",
  "UNI",
  "ATOM",
  "ETC",
  "FIL",
  "ALGO",
  "VET",
  "ICP",
  "FTM",
  "GRT",
  "SAND",
  "MANA",
  "AXS",
  "GALA",
  "NEAR",
  "HBAR",
  "XLM",
  "XTZ",
]);
const FOREX_PAIRS = new Set([
  "EURUSD",
  "USDJPY",
  "GBPUSD",
  "AUDUSD",
  "USDCAD",
  "USDCHF",
  "NZDUSD",
  "EURGBP",
  "EURJPY",
  "EURCHF",
  "GBPJPY",
  "GBPCHF",
  "AUDJPY",
  "AUDNZD",
  "AUDCAD",
  "AUDCHF",
  "CADJPY",
  "CADCHF",
  "CHFJPY",
  "NZDJPY",
  "NZDCAD",
  "NZDCHF",
  "EURAUD",
  "EURCAD",
  "EURNZD",
  "GBPAUD",
  "GBPCAD",
  "GBPNZD",
  "USDSGD",
  "SGDJPY",
  "EURHUF",
  "USDHUF",
  "USDTRY",
  "EURTRY",
  "USDNOK",
  "USDDKK",
  "USDPLN",
  "EURSEK",
  "EURNOK",
  "EURDKK",
  "EURPLN",
  "EURSGD",
  "EURHKD",
  "USDHKD",
]);
const COMMODITY_PREFIXES = new Set(["XAU", "XAG", "XTI", "XBR", "XNG", "XPT"]);
const INDICES_SET = new Set([
  "US500",
  "US30",
  "USTEC",
  "UK100",
  "TECDE30",
  "DE40",
  "DE30",
  "CA60",
  "CHINAH",
  "SWI20",
  "AUS200",
  "CHINA50",
  "JP225",
  "NAS100",
  "SPX500",
]);

const classifySymbol = (s) => {
  const upper = String(s || "").toUpperCase();
  if (!upper) return "other";
  if (COMMODITY_PREFIXES.has(upper.substring(0, 3))) return "commodity";
  if (INDICES_SET.has(upper)) return "indices";
  const prefix = upper.replace(/USD$|USDT$/, "");
  if (
    CRYPTO_PREFIXES.has(prefix) &&
    (upper.endsWith("USD") || upper.endsWith("USDT"))
  )
    return "crypto";
  if (FOREX_PAIRS.has(upper)) return "forex";
  return "other";
};

const PROFILE_PRESETS = {
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
    rr: "1",
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

const DEFAULT_CONFIG = {
  symbol: "",
  asset: "Auto detect",
  session: "Any",
  rr: "2",
  risk: "1",
  lookbackBars: "300",
  strategies: ["ICT", "Price Action", "Market Structure"],
  profile: "day",
  htf_tfs: [...PROFILE_PRESETS.day.htf_tfs],
  exec_tfs: [...PROFILE_PRESETS.day.exec_tfs],
  conf_tfs: [...PROFILE_PRESETS.day.conf_tfs],
  htfbias: "",
  dir: "Direction: Both",
  news: "",
  notes: "",
};

const AI_RESPONSE_SCHEMA = {
  symbol: "",
  timeframes: [
    {
      tf: "MN|W|D|4H|1H|15M|5M|1M",
      trend: "Bullish|Bearish|Ranging",
      structure: "BOS|CHoCH|MSB|Continuation|Ranging",
      phase:
        "Trending|Retracement|Reversal|Consolidation|Breakout|Breakdown|Distribution|Accumulation",
      bias: "Long|Short|Neutral",
      poiAlign: true,
      strongEvents: [
        {
          event: "BOS|CHoCH|MSB|Retest|Sweep|Discount|Premium|Rejection|Doji|Engulfing|Cross_EMA|EQH|EQL|BSL|SSL",
          price: null,
          time: null,
          direction: "Bull|Bear",
        },
      ],
    },
  ],
  tradePlan: [
    {
      dir: "BUY|SELL",
      profile: "Position|Swing|Intraday|Scalp",
      type: "Limit|Stop Limit|Market",
      strategy: "",
      entry_model: "",
      entry: null,
      sl: null,
      be: null,
      tp: null,
      tp2: null,
      tp3: null,
      rr: null,
      estimated_bars: null,
      confluence_checklist: [
        "Checklist1",
        "Checklist2",
      ],
      action: {
        exit_condition: "",
        entry_condition: "",
        risk_management: "none|low|normal|high",
        recommendation: "Skip|Proceed|Wait"
      },
      note: "",
    },
  ],
};

const GUIDE_TEXT = `Compact ICT guide:
- Analyze HTF to LTF. did=factual past move, next=likely path.
- Keep only relevant PD arrays near current price and swept/key liquidity.
- Evaluate buy and sell independently using High/Medium evidence only.
- Generate max 2 plans only when highPassed/highTotal >= 0.6.
- Use empty strings for weak narrative; avoid filler.`;

function normalizeTemplateConfig(raw) {
  const strategyValue = raw?.strategies || raw?.strategy || ["ICT"];
  const strategies = Array.isArray(strategyValue)
    ? strategyValue
    : [String(strategyValue || "ICT")];
  const profileRaw = String(raw?.profile || "")
    .trim()
    .toLowerCase();
  const profile = PROFILE_PRESETS[profileRaw]
    ? profileRaw
    : DEFAULT_CONFIG.profile;
  const preset = PROFILE_PRESETS[profile] || PROFILE_PRESETS.day;
  return {
    ...DEFAULT_CONFIG,
    ...(raw || {}),
    profile,
    htf_tfs:
      Array.isArray(raw?.htf_tfs) && raw.htf_tfs.length
        ? raw.htf_tfs
        : [...preset.htf_tfs],
    exec_tfs:
      Array.isArray(raw?.exec_tfs) && raw.exec_tfs.length
        ? raw.exec_tfs
        : [...preset.exec_tfs],
    conf_tfs:
      Array.isArray(raw?.conf_tfs) && raw.conf_tfs.length
        ? raw.conf_tfs
        : [...preset.conf_tfs],
    strategies: [
      ...new Set(strategies.map((x) => String(x || "").trim()).filter(Boolean)),
    ],
  };
}

function loadTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((x) => ({
          ...x,
          id: x.id || x.name,
          config: normalizeTemplateConfig(x?.config || {}),
        }))
      : [];
  } catch {
    return [];
  }
}

function saveTemplatesToLocal(next) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next || []));
}

function toggleArrayValue(arr, val) {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

function sanitizeSnapshotFileToken(value, fallback = "chart") {
  const raw = String(value || fallback)
    .trim()
    .toUpperCase();
  const token = raw
    .replace(/[^A-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || fallback;
}

function toTradingViewInterval(tfRaw) {
  const tf = String(tfRaw || "5")
    .trim()
    .toLowerCase();
  if (!tf) return "5";
  if (/^\d+$/.test(tf)) return tf;
  if (tf.endsWith("m")) return tf.slice(0, -1) || "5";
  if (tf.endsWith("h")) return String(Number(tf.slice(0, -1) || "1") * 60);
  if (tf.endsWith("d")) return "D";
  if (tf.endsWith("w")) return "W";
  if (tf.endsWith("mo") || tf.endsWith("mth")) return "M";
  return tf.toUpperCase();
}

function parseSnapshotMeta(it) {
  const fileName = String(it?.file_name || "");
  const base = fileName.replace(/\.(png|jpe?g)$/i, "");
  let parts = base.split("_");
  if (parts[0] === "UID" && parts.length >= 7) {
    parts = parts.slice(2);
  }
  if (parts.length < 3) return null;
  let tfToken = "";
  let sessionPrefix = "";
  let symbolParts = [];
  let tsFromName = 0;
  if (
    parts.length >= 5 &&
    /^\d{8}$/.test(parts[0]) &&
    /^\d{2}$/.test(parts[1]) &&
    /^\d{2}$/.test(parts[2])
  ) {
    const rest = parts.slice(3);
    if (rest.length < 2) return null;
    const hasDup = rest.length >= 3 && /^\d+$/.test(rest[rest.length - 1]);
    tfToken = String(
      hasDup ? rest[rest.length - 2] : rest[rest.length - 1],
    ).toUpperCase();
    symbolParts = rest.slice(0, hasDup ? -2 : -1);
    const yyyy = Number(parts[0].slice(0, 4));
    const mm = Number(parts[0].slice(4, 6));
    const dd = Number(parts[0].slice(6, 8));
    const hh = Number(parts[1]);
    const mi = Number(parts[2]);
    tsFromName = Date.UTC(yyyy, Math.max(mm - 1, 0), dd, hh, mi, 0, 0);
  } else {
    const hasDup = parts.length >= 4 && /^\d+$/.test(parts[parts.length - 1]);
    tfToken = String(
      hasDup ? parts[parts.length - 2] : parts[parts.length - 1],
    ).toUpperCase();
    sessionPrefix = String(
      hasDup ? parts[parts.length - 3] : parts[parts.length - 2] || "",
    ).toUpperCase();
    symbolParts = parts.slice(0, hasDup ? -3 : -2);
  }
  if (!symbolParts.length || !tfToken) return null;
  return {
    fileName,
    tfToken,
    sessionPrefix,
    symbolToken: symbolParts.join("_"),
    createdAtMs: Date.parse(it?.created_at || "") || tsFromName || 0,
  };
}

function makeSessionPrefix() {
  const now = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${now}${rnd}`.replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

function intervalTokenToLabel(token) {
  const t = String(token || "").toUpperCase();
  if (t === "D") return "1D";
  if (t === "W") return "1W";
  if (t === "M") return "1M";
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    if (n < 60) return `${n}m`;
    if (n % 60 === 0) return `${n / 60}h`;
    return `${n}m`;
  }
  return t;
}

// isSameDay imported from format.js

function formatCompactDateTime(dateLike) {
  return showDateTime(dateLike);
}

function parseNum(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  let raw = String(value ?? "").trim();
  if (!raw) return NaN;
  if (/^-?\d+,\d+$/.test(raw)) raw = raw.replace(",", ".");
  else raw = raw.replace(/,/g, "");
  const m = raw.match(/-?\d+(?:\.\d+)?/);
  if (!m) return NaN;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : NaN;
}

function formatNum3(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n * 1000) / 1000);
}

function parsePdZoneBounds(zoneRaw) {
  if (zoneRaw === null || zoneRaw === undefined)
    return { low: null, high: null };
  if (typeof zoneRaw === "number" && Number.isFinite(zoneRaw))
    return { low: zoneRaw, high: zoneRaw };
  const txt = String(zoneRaw).trim();
  if (!txt) return { low: null, high: null };
  const nums = txt.match(/-?\d+(?:\.\d+)?/g) || [];
  const a = nums[0] ? Number(nums[0]) : NaN;
  const b = nums[1] ? Number(nums[1]) : NaN;
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return { low: Math.min(a, b), high: Math.max(a, b) };
  }
  if (Number.isFinite(a)) return { low: a, high: a };
  return { low: null, high: null };
}

function getPlanTpCandidates(plan = {}) {
  const partials = Array.isArray(plan?.partial_tps) ? plan.partial_tps : [];
  const partialPrices = partials.map((x) =>
    x && typeof x === "object" ? x.price : x,
  );
  const compactTps = Array.isArray(plan?.tps)
    ? plan.tps.map((x) => (x && typeof x === "object" ? x.price : x))
    : [];
  const legacyLevels = Array.isArray(plan?.tp_levels) ? plan.tp_levels : [];
  const targets = Array.isArray(plan?.targets) ? plan.targets : [];
  return [
    plan?.tp,
    ...partialPrices,
    ...compactTps,
    ...legacyLevels,
    ...targets,
    plan?.take_profit,
    plan?.target,
    plan?.tp1,
    plan?.tp2,
    plan?.tp3,
  ];
}

function getPlanPrimaryTp(plan = {}) {
  for (const candidate of getPlanTpCandidates(plan)) {
    const value =
      candidate && typeof candidate === "object" ? candidate.price : candidate;
    const n = parseNum(value);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function normalizeAnalysisContract(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return parsed;
  const out = { ...parsed };
  if (
    !out.market_analysis &&
    (Array.isArray(out.timeframes) ||
      Array.isArray(out.pdArrays) ||
      Array.isArray(out.keyLevels) ||
      out.checklist ||
      out.dol)
  ) {
    out.market_analysis = {
      timeframes: (Array.isArray(out.timeframes) ? out.timeframes : []).map(
        (x) => ({
          tf: x?.tf || "",
          trend: x?.trend || "",
          structure: x?.structure || "",
          market_phase: x?.phase || "",
          bias: x?.bias || "",
          poi_alignment: Boolean(x?.poiAlign),
          price_action_summary: {
            recent_move: String(x?.did || ""),
            key_breaks: (Array.isArray(x?.keyBreaks) ? x.keyBreaks : []).map(
              (b) => ({
                event: b?.event || "",
                price_level: b?.price ?? null,
                direction:
                  b?.direction === "Bull"
                    ? "Bullish"
                    : b?.direction === "Bear"
                      ? "Bearish"
                      : b?.direction || "",
                bar_ref: b?.bar_ref ?? null,
              }),
            ),
          },
          price_prediction: {
            narrative: String(x?.next || ""),
            expected_path: (Array.isArray(x?.path) ? x.path : []).map((p) => ({
              step: p?.step ?? null,
              action: p?.action || "",
              target_price: p?.target ?? null,
              condition: p?.condition || "",
            })),
          },
          note: x?.note || "",
        }),
      ),
      pd_arrays: (Array.isArray(out.pdArrays) ? out.pdArrays : []).map((x) => ({
        id: x?.id ?? null,
        type: x?.type || "",
        direction:
          x?.dir === "Bull"
            ? "Bullish"
            : x?.dir === "Bear"
              ? "Bearish"
              : x?.direction || "",
        strength: x?.strength || "",
        price_top: x?.top ?? null,
        price_bottom: x?.bot ?? null,
        status: x?.status || "",
        touched: x?.touched ?? 0,
        timeframe: x?.tf || "",
        note: x?.note || "",
      })),
      key_levels: (Array.isArray(out.keyLevels) ? out.keyLevels : []).map(
        (x) => ({
          name: x?.name || "",
          price: x?.price ?? null,
          swept: Boolean(x?.swept),
        }),
      ),
      confluence_checklist: {
        buy: (Array.isArray(out.checklist?.buy?.items)
          ? out.checklist.buy.items
          : []
        ).map((x) => ({
          ...x,
          checked: Boolean(x?.passed),
          pd_array_ref: x?.pdRef ?? null,
        })),
        sell: (Array.isArray(out.checklist?.sell?.items)
          ? out.checklist.sell.items
          : []
        ).map((x) => ({
          ...x,
          checked: Boolean(x?.passed),
          pd_array_ref: x?.pdRef ?? null,
        })),
      },
    };
  }
  if (!out.trade_plan && Array.isArray(out.tradePlan)) {
    out.trade_plan = out.tradePlan.map((x) => ({
      direction: x?.direction || x?.dir || "",
      profile: x?.profile || "",
      type: x?.type || "",
      session_entry: x?.session || "",
      strategy: x?.strategy || "",
      entry_model: x?.entry_model || x?.model || "",
      entry: x?.entry ?? null,
      sl: x?.sl ?? null,
      be_trigger: x?.be ?? null,
      tp:
        x?.tp ??
        (Array.isArray(x?.tps) && x.tps[0] ? (x.tps[0].price ?? null) : null),
      tp2:
        x?.tp2 ??
        (Array.isArray(x?.tps) && x.tps[1] ? (x.tps[1].price ?? null) : null),
      tp3:
        x?.tp3 ??
        (Array.isArray(x?.tps) && x.tps[2] ? (x.tps[2].price ?? null) : null),
      estimated_bars: x?.estimated_bars ?? null,
      risk_pct: x?.riskPct ?? x?.risk_pct ?? null,
      rr: x?.rr ?? null,
      partial_tps: (Array.isArray(x?.tps) ? x.tps : []).map((t) => ({
        price: t?.price ?? null,
        size_pct: t?.pct ?? null,
        rr: t?.rr ?? null,
      })),
      confluence_checklist: Array.isArray(x?.confluence_checklist)
        ? x.confluence_checklist
        : [],
      reasons_to_skip: Array.isArray(x?.skipReasons)
        ? x.skipReasons
        : Array.isArray(x?.reasons_to_skip)
          ? x.reasons_to_skip
          : [],
      skip_recommendation:
        x?.skip_recommendation || x?.skip || x?.action?.recommendation || "",
      entry_condition: x?.action?.entry_condition || "",
      exit_condition: x?.action?.exit_condition || "",
      risk_management: x?.action?.risk_management || "",
      invalidation: x?.invalidation || out.verdict?.invalidation || "",
      confidence_pct: x?.confidence_pct ?? x?.confidence ?? null,
      note: x?.note || "",
    }));
  }
  if (!out.final_verdict && out.verdict) {
    out.final_verdict = {
      action: out.verdict.action || "",
      risk_tier: out.verdict.tier || "",
      confidence: out.verdict.confidence || 0,
      bias_shift_invalidation: out.verdict.invalidation || "",
      next_poi: {
        price: out.verdict.nextPoi?.price ?? null,
        timeframe: out.verdict.nextPoi?.tf || "",
        type: out.verdict.nextPoi?.type || "",
      },
      note: out.verdict.note || "",
    };
  }
  return out;
}

function normalizeTfLabelToLower(tfRaw) {
  const tf = String(tfRaw || "")
    .trim()
    .toLowerCase();
  if (!tf) return "15m";
  if (/^\d+$/.test(tf)) return `${tf}m`;
  if (
    tf.endsWith("m") ||
    tf.endsWith("h") ||
    tf.endsWith("d") ||
    tf.endsWith("w")
  )
    return tf;
  return tf;
}

function tfToSeconds(tfRaw) {
  const s = String(tfRaw || "")
    .trim()
    .toLowerCase();
  if (!s) return 900;
  if (/^\d+$/.test(s)) return Math.max(60, Number(s) * 60);
  const m = s.match(/^(\d+)\s*(m|min|h|d|w)$/i);
  if (!m) return 900;
  const n = Math.max(1, Number(m[1] || 1));
  const u = String(m[2] || "").toLowerCase();
  if (u === "m" || u === "min") return n * 60;
  if (u === "h") return n * 3600;
  if (u === "d") return n * 86400;
  if (u === "w") return n * 604800;
  return 900;
}

function normalizeSnapshotBars(snapshot, tfRaw = "") {
  const rawBars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
  if (!rawBars.length) return snapshot;

  const tfSec = tfToSeconds(
    tfRaw || snapshot?.tf_norm || snapshot?.timeframe || snapshot?.interval,
  );
  const nowSec = Math.floor(Date.now() / 1000);
  const dedup = new Map();

  rawBars.forEach((x) => {
    const t = Number(x?.time);
    const o = Number(x?.open);
    const h = Number(x?.high);
    const l = Number(x?.low);
    const c = Number(x?.close);
    if (
      !Number.isFinite(t) ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c)
    )
      return;

    // STRICT FUTURE FILTER: Avoid bars more than 1 period into the future
    if (t > nowSec + tfSec) return;

    dedup.set(t, { time: t, open: o, high: h, low: l, close: c });
  });

  let bars = [...dedup.values()].sort((a, b) => a.time - b.time);

  // TINY RANGE FILTER: Remove flat/buggy bars at the end (often artifacts from provider)
  if (bars.length >= 30) {
    const ranges = bars
      .map((b) => Math.abs(b.high - b.low))
      .filter((v) => v > 0);
    const medianRange = ranges.length
      ? ranges.sort((a, b) => a - b)[Math.floor(ranges.length / 2)]
      : 0;

    if (medianRange > 0) {
      const tinyThreshold = medianRange * 0.05;
      let trimCount = 0;
      for (let i = bars.length - 1; i >= 0; i -= 1) {
        const r = Math.abs(bars[i].high - bars[i].low);
        // If bar is basically a flat line AND close is weirdly far from previous close (artifact check)
        if (r <= tinyThreshold) trimCount += 1;
        else break;
      }
      if (trimCount >= 1) {
        bars = bars.slice(0, bars.length - trimCount);
      }
    }
  }

  if (!bars.length) return snapshot;
  return {
    ...(snapshot || {}),
    bars,
    bar_start: bars[0].time,
    bar_end: bars[bars.length - 1].time,
  };
}

function aiSourceFromModel(modelRaw) {
  const model = String(modelRaw || "")
    .trim()
    .toLowerCase();
  if (!model) return "ai_claude";
  if (model.includes("gpt") || model.includes("openai")) return "ai_openai";
  if (model.includes("gemini")) return "ai_gemini";
  if (model.includes("deepseek")) return "ai_deepseek";
  if (model.includes("claude")) return "ai_claude";
  return "ai_claude";
}

function liveTfToTradingViewInterval(tfRaw) {
  const s = String(tfRaw || "").toUpperCase();
  if (s === "W") return "W";
  if (s === "D") return "D";
  if (s === "4H") return "240";
  if (s === "15M") return "15";
  if (s === "5M") return "5";
  if (s === "1M") return "1";
  return "15";
}

function configTfToSnapshotTf(tfRaw) {
  const s = String(tfRaw || "")
    .trim()
    .toUpperCase();
  if (s === "W" || s === "W1") return "1w";
  if (s === "D" || s === "D1") return "1D";
  if (s === "4H") return "4h";
  if (s === "2H") return "2h";
  if (s === "1H") return "1h";
  if (s === "30M") return "30m";
  if (s === "15M") return "15m";
  if (s === "5M") return "5m";
  if (s === "3M") return "3m";
  if (s === "1M") return "1m";
  return String(tfRaw || "").trim();
}

function extractPositionFromAnalysis(parsed) {
  const tradePlans = [];
  if (Array.isArray(parsed?.trade_plan)) tradePlans.push(...parsed.trade_plan);
  if (
    parsed?.trade_plan &&
    typeof parsed.trade_plan === "object" &&
    !Array.isArray(parsed.trade_plan)
  )
    tradePlans.push(parsed.trade_plan);
  if (
    !tradePlans.length &&
    parsed?.trade_setup &&
    typeof parsed.trade_setup === "object"
  )
    tradePlans.push(parsed.trade_setup);
  if (!tradePlans.length && parsed && typeof parsed === "object")
    tradePlans.push(parsed);
  const bestPlan =
    tradePlans
      .map((x) => ({
        ...(x || {}),
        confidence_pct: parseNum(x?.confidence_pct),
      }))
      .sort((a, b) => {
        const ac = Number.isFinite(a.confidence_pct) ? a.confidence_pct : -1;
        const bc = Number.isFinite(b.confidence_pct) ? b.confidence_pct : -1;
        return bc - ac;
      })[0] || {};
  const plan = bestPlan;
  const directionRaw = String(plan.direction || parsed?.direction || "")
    .trim()
    .toUpperCase();
  const direction =
    directionRaw.includes("SELL") ||
    directionRaw.includes("SHORT") ||
    directionRaw === "S"
      ? "SELL"
      : directionRaw.includes("BUY") ||
          directionRaw.includes("LONG") ||
          directionRaw === "B"
        ? "BUY"
        : "";
  const entry = parseNum(plan.entry ?? parsed?.entry ?? parsed?.price);
  const sl = parseNum(plan.sl ?? parsed?.sl);
  const planTp = getPlanPrimaryTp(plan);
  const tp = Number.isFinite(planTp)
    ? planTp
    : parseNum(parsed?.tp ?? parsed?.take_profit);
  const rrRaw = parseNum(plan.rr ?? parsed?.rr);
  let rr = Number.isFinite(rrRaw) ? rrRaw : null;
  if (
    !Number.isFinite(rr) &&
    Number.isFinite(entry) &&
    Number.isFinite(sl) &&
    Number.isFinite(tp)
  ) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk > 0 && reward > 0) rr = Number((reward / risk).toFixed(2));
  }
  return {
    direction: direction || "BUY",
    entry: Number.isFinite(entry) ? formatNum3(entry) : "",
    tp: Number.isFinite(tp) ? formatNum3(tp) : "",
    sl: Number.isFinite(sl) ? formatNum3(sl) : "",
    rr: Number.isFinite(rr) ? formatNum3(rr) : "",
    trade_type:
      String(plan.type || parsed?.type || "limit")
        .trim()
        .toLowerCase() || "limit",
    note: String(
      plan.note || parsed?.invalidation || parsed?.note || "",
    ).trim(),
  };
}

function extractPositionFromPlan(plan, parsed = {}) {
  const item = plan && typeof plan === "object" ? plan : {};
  const directionRaw = String(item.direction || parsed?.direction || "")
    .trim()
    .toUpperCase();
  const direction =
    directionRaw.includes("SELL") || directionRaw.includes("SHORT")
      ? "SELL"
      : directionRaw.includes("BUY") || directionRaw.includes("LONG")
        ? "BUY"
        : "BUY";
  const entry = parseNum(item.entry ?? parsed?.entry ?? parsed?.price);
  const sl = parseNum(item.sl ?? parsed?.sl);
  const planTp = getPlanPrimaryTp(item);
  const tp = Number.isFinite(planTp)
    ? planTp
    : parseNum(parsed?.tp ?? parsed?.take_profit);
  const rrRaw = parseNum(item.rr ?? parsed?.rr);
  let rr = Number.isFinite(rrRaw) ? rrRaw : null;
  if (
    !Number.isFinite(rr) &&
    Number.isFinite(entry) &&
    Number.isFinite(sl) &&
    Number.isFinite(tp)
  ) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk > 0 && reward > 0) rr = Number((reward / risk).toFixed(2));
  }
  return {
    direction,
    entry: Number.isFinite(entry) ? formatNum3(entry) : "",
    tp: Number.isFinite(tp) ? formatNum3(tp) : "",
    sl: Number.isFinite(sl) ? formatNum3(sl) : "",
    rr: Number.isFinite(rr) ? formatNum3(rr) : "",
    trade_type:
      String(item.type || parsed?.type || "limit")
        .trim()
        .toLowerCase() || "limit",
    note: String(
      item.note || parsed?.invalidation || parsed?.note || "",
    ).trim(),
  };
}

function normalizeSignalSymbol(symbolRaw) {
  const s = String(symbolRaw || "")
    .trim()
    .toUpperCase();
  if (!s) return "";
  if (s.includes(":")) {
    const parts = s.split(":");
    return String(parts[parts.length - 1] || "")
      .trim()
      .toUpperCase();
  }
  return s;
}

function normalizeWatchSymbol(symbolRaw) {
  return normalizeSignalSymbol(symbolRaw).replace(/\s+/g, "");
}

function normalizeNoteForStorage(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function extractJsonCandidate(textRaw) {
  const text = String(textRaw || "").trim();
  if (!text) return "";
  let s = text
    .replace(/^\s*`+json\s*/i, "")
    .replace(/^\s*```json\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) s = fenced[1].trim();

  const findBalanced = (str, openChar, closeChar, startAt = 0) => {
    const start = str.indexOf(openChar, startAt);
    if (start < 0) return { content: "", start: -1 };
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < str.length; i += 1) {
      const ch = str[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === openChar) depth += 1;
      if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) return { content: str.slice(start, i + 1), start };
      }
    }
    return { content: "", start: -1 };
  };

  let longest = "";
  let searchPos = 0;
  while (searchPos < s.length) {
    const { content, start } = findBalanced(s, "{", "}", searchPos);
    if (start < 0) break;
    if (content.length > longest.length) longest = content;
    searchPos = start + 1;
  }

  searchPos = 0;
  while (searchPos < s.length) {
    const { content, start } = findBalanced(s, "[", "]", searchPos);
    if (start < 0) break;
    if (content.length > longest.length) longest = content;
    searchPos = start + 1;
  }

  return longest || s;
}

function tryParseJsonLoose(textRaw) {
  const candidate = extractJsonCandidate(textRaw);
  if (!candidate) return null;
  try {
    return JSON.parse(candidate);
  } catch {
    try {
      let repaired = "";
      let inString = false;
      let escaped = false;
      for (let i = 0; i < candidate.length; i += 1) {
        const ch = candidate[i];
        if (inString) {
          if (escaped) {
            repaired += ch;
            escaped = false;
            continue;
          }
          if (ch === "\\") {
            repaired += ch;
            escaped = true;
            continue;
          }
          if (ch === '"') {
            repaired += ch;
            inString = false;
            continue;
          }
          if (ch === "\n" || ch === "\r") {
            repaired += " ";
            continue;
          }
          repaired += ch;
          continue;
        }
        if (ch === '"') {
          repaired += ch;
          inString = true;
          continue;
        }
        repaired += ch;
      }
      repaired = repaired.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function parseTradePlanFromRaw(rawText) {
  const raw = String(rawText || "");
  if (!raw) return null;
  const getString = (re) => {
    const m = raw.match(re);
    return m?.[1] ? String(m[1]).trim() : "";
  };
  const getNum = (re) => {
    const m = raw.match(re);
    if (!m?.[1]) return null;
    const n = Number(String(m[1]).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const symbol = getString(/"symbol"\s*:\s*"([^"]+)"/i);
  const profile = getString(/"profile"\s*:\s*"([^"]+)"/i);
  let tradePlanBlock =
    raw.match(
      /"trade_plan"\s*:\s*\{([\s\S]*?)\}\s*(?:|,\s*|(?=\s*[}\]]))}/i,
    )?.[1] || "";
  if (!tradePlanBlock) {
    tradePlanBlock =
      raw.match(
        /"trade_plan"\s*:\s*\[\s*\{([\s\S]*?)\}\s*(?:|,\s*|(?=\s*\]))/i,
      )?.[1] || "";
  }
  if (!tradePlanBlock) return null;
  const inPlan = (re) => {
    const m = tradePlanBlock.match(re);
    return m?.[1] ? String(m[1]).trim() : "";
  };
  const inPlanNum = (re) => {
    const m = tradePlanBlock.match(re);
    if (!m?.[1]) return null;
    const n = Number(String(m[1]).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const entry = inPlanNum(/"entry"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const sl = inPlanNum(/"sl"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const tp1 = inPlanNum(/"tp1"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const tp2 = inPlanNum(/"tp2"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const tp3 = inPlanNum(/"tp3"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const rr = inPlanNum(/"rr"\s*:\s*(-?\d+(?:\.\d+)?)/i);
  const direction =
    inPlan(/"direction"\s*:\s*"([^"]+)"/i) ||
    inPlan(/"dir"\s*:\s*"([^"]+)"/i);
  const note = getString(/"note"\s*:\s*"([^"]+)"/i);

  if (!symbol && !direction && !Number.isFinite(entry)) return null;
  return {
    symbol: symbol || "",
    profile: profile || "",
    trade_plan: {
      direction: direction || "",
      entry,
      sl,
      tp1,
      tp2,
      tp3,
      tp:
        inPlanNum(/"tp"\s*:\s*(-?\d+(?:\.\d+)?)/i) ??
        tp1 ??
        tp2 ??
        tp3,
      rr,
      type: inPlan(/"type"\s*:\s*"([^"]+)"/i),
      strategy: inPlan(/"strategy"\s*:\s*"([^"]+)"/i),
      entry_model: inPlan(/"entry_model"\s*:\s*"([^"]+)"/i),
      confidence_pct:
        inPlanNum(/"confidence_pct"\s*:\s*(-?\d+(?:\.\d+)?)/i) ??
        inPlanNum(/"confidence"\s*:\s*(-?\d+(?:\.\d+)?)/i),
      note: note || "",
    },
  };
}

function enrichParsedAnalysis(rawText, parsed) {
  parsed = normalizeAnalysisContract(parsed);
  const fallback = parseTradePlanFromRaw(rawText) || {};

  // If parsed is null or not an object/array, use fallback
  if (!parsed || typeof parsed !== "object") {
    return fallback;
  }

  let res = {};

  // Case 1: AI returned an array of trade plans directly
  if (Array.isArray(parsed)) {
    res = {
      ...fallback,
      trade_plan: parsed,
    };
  } else {
    // Case 2: AI returned a full object
    res = { ...parsed };

    // Ensure trade_plan is an array if it's a single object
    if (res.trade_plan && !Array.isArray(res.trade_plan)) {
      res.trade_plan = [res.trade_plan];
    }
  }

  // Merge market_analysis from fallback if missing in res
  if (!res.market_analysis && fallback.market_analysis) {
    res.market_analysis = fallback.market_analysis;
  }

  // Merge symbol/profile if missing
  if (!res.symbol && fallback.symbol) res.symbol = fallback.symbol;
  if (!res.profile && fallback.profile) res.profile = fallback.profile;

  // Final check for trade_plan
  if (!res.trade_plan && fallback.trade_plan) {
    res.trade_plan = Array.isArray(fallback.trade_plan)
      ? fallback.trade_plan
      : [fallback.trade_plan];
  } else if (
    Array.isArray(res.trade_plan) &&
    res.trade_plan.length === 0 &&
    fallback.trade_plan
  ) {
    res.trade_plan = Array.isArray(fallback.trade_plan)
      ? fallback.trade_plan
      : [fallback.trade_plan];
  }

  return res;
}

function getEffectiveTfConfig(cfg) {
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
  };
}

function buildPrompt(cfg) {
  const tfConfig = getEffectiveTfConfig(cfg);
  const profileLabel =
    {
      position: "position",
      swing: "swing",
      day: "daily",
      scalper: "scalping",
    }[tfConfig.profile] || "daily";
  const symbol = String(cfg.symbol || "UK100").trim() || "UK100";
  const strategy = cfg.strategies.join(", ") || "ICT";
  const context = [];
  if (cfg.htfbias) context.push(`htf_bias_override: "${cfg.htfbias}"`);
  if (cfg.dir) context.push(`direction: "${cfg.dir}"`);
  if (cfg.news) context.push(`news_risk: "${cfg.news}"`);
  if (cfg.session && cfg.session !== "Any")
    context.push(`session: "${cfg.session}"`);
  if (cfg.notes) context.push(`notes: "${cfg.notes}"`);
  const tfJson = JSON.stringify(
    {
      htf_bias_tfs: tfConfig.htf_tfs,
      execution_tf: tfConfig.exec_tfs,
      confirmation_tf: tfConfig.conf_tfs,
    },
    null,
    2,
  );

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

function buildJsonConfig(cfg) {
  const tfConfig = getEffectiveTfConfig(cfg);
  return JSON.stringify(
    {
      version: "2.1",
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
        required_patterns: [
          "V-Shape",
          "Quasimodo",
          "Flag",
          "Triangle",
          "Pin Bar",
          "Inside Bar",
          "Fakey",
        ],
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

function extractSignalsFromAnalysis(parsed, fallback = {}) {
  if (!parsed || typeof parsed !== "object") return [];
  const rows = [];
  if (Array.isArray(parsed)) rows.push(...parsed);
  if (Array.isArray(parsed.signals)) rows.push(...parsed.signals);
  if (Array.isArray(parsed.trade_setups)) rows.push(...parsed.trade_setups);
  if (Array.isArray(parsed.trade_plan))
    rows.push(
      ...parsed.trade_plan.map((x) => ({
        ...(x || {}),
        symbol: parsed.symbol || fallback.symbol,
      })),
    );
  if (parsed.trade_setup && typeof parsed.trade_setup === "object") {
    rows.push({
      ...(parsed.trade_setup || {}),
      symbol: parsed.symbol || fallback.symbol,
    });
  }
  if (
    parsed.trade_plan &&
    typeof parsed.trade_plan === "object" &&
    !Array.isArray(parsed.trade_plan)
  ) {
    rows.push({
      ...(parsed.trade_plan || {}),
      symbol: parsed.symbol || fallback.symbol,
    });
  }
  if (!rows.length) rows.push(parsed);

  return rows
    .map((s) => {
      const sideRaw = String(
        s?.side || s?.direction || s?.action || "",
      ).toUpperCase();
      const action = sideRaw.includes("SELL") ? "SELL" : "BUY";
      const entry = parseNum(s?.entry ?? s?.price ?? s?.entry_price);
      const sl = parseNum(s?.sl ?? s?.stop_loss);
      const planTp = getPlanPrimaryTp(s);
      const tp = Number.isFinite(planTp) ? planTp : parseNum(s?.take_profit);
      const strategy = String(s?.strategy || fallback.strategy || "ai").trim();
      const entryModel =
        String(s?.entry_model || s?.model || "ai_claude").trim() || "ai_claude";
      const source =
        String(s?.source || fallback.source || "ai_claude").trim() ||
        "ai_claude";
      return {
        symbol: normalizeSignalSymbol(s?.symbol || fallback.symbol || ""),
        action,
        entry,
        sl,
        tp,
        tf: String(s?.timeframe || fallback.timeframe || "15m").trim(),
        model: entryModel,
        entry_model: entryModel,
        order_type: String(s?.type || s?.order_type || "limit")
          .trim()
          .toLowerCase(),
        note: typeof s?.note === "string" ? s.note : "",
        source,
        strategy,
        rr: parseNum(s?.rr),
        profile: String(s?.profile || parsed?.profile || "").trim(),
        confidence_pct: parseNum(s?.confidence_pct),
        invalidation: String(
          s?.invalidation || parsed?.invalidation || "",
        ).trim(),
      };
    })
    .filter(
      (x) =>
        x.symbol &&
        Number.isFinite(x.entry) &&
        Number.isFinite(x.sl) &&
        Number.isFinite(x.tp) &&
        x.entry > 0 &&
        x.sl > 0 &&
        x.tp > 0,
    );
}

function buildFriendlyResponse(parsed) {
  if (parsed === null || parsed === undefined) return "No parsed JSON yet.";
  const lines = [];
  const walk = (value, prefix = "", depth = 0) => {
    const indent = "  ".repeat(depth);
    if (value === null || value === undefined) {
      lines.push(`${indent}${prefix}: -`);
      return;
    }
    if (Array.isArray(value)) {
      if (!value.length) {
        lines.push(`${indent}${prefix}: []`);
        return;
      }
      lines.push(`${indent}${prefix}:`);
      value.forEach((item, idx) => {
        if (item && typeof item === "object") {
          lines.push(`${indent}  - [${idx + 1}]`);
          walk(item, "", depth + 2);
        } else {
          lines.push(`${indent}  - ${String(item)}`);
        }
      });
      return;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value);
      if (!entries.length) {
        lines.push(`${indent}${prefix}: {}`);
        return;
      }
      if (prefix) lines.push(`${indent}${prefix}:`);
      entries.forEach(([k, v]) => walk(v, k, prefix ? depth + 1 : depth));
      return;
    }
    lines.push(`${indent}${prefix}: ${String(value)}`);
  };
  if (typeof parsed === "object") walk(parsed);
  else lines.push(String(parsed));
  return lines.join("\n");
}

function validatePosition(pos = {}) {
  const entry = parseNum(pos.entry);
  const tp = parseNum(pos.tp);
  const sl = parseNum(pos.sl);
  const rr = parseNum(pos.rr);
  const directionRaw = String(pos.direction || "")
    .trim()
    .toUpperCase();
  const direction =
    directionRaw === "BUY" || directionRaw === "SELL"
      ? directionRaw
      : Number.isFinite(entry) && Number.isFinite(tp)
        ? tp >= entry
          ? "BUY"
          : "SELL"
        : "";

  if (!Number.isFinite(entry) || !Number.isFinite(tp) || !Number.isFinite(sl)) {
    return "Entry/TP/SL must be numeric values.";
  }
  if (Number.isFinite(rr) && (rr < 0.3 || rr > 5)) {
    return "RR must be between 0.3 and 5.";
  }
  if (direction === "BUY") {
    if (!(tp > entry)) return "For BUY, TP must be greater than Entry.";
    if (!(sl < entry)) return "For BUY, SL must be lower than Entry.";
  }
  if (direction === "SELL") {
    if (!(tp < entry)) return "For SELL, TP must be lower than Entry.";
    if (!(sl > entry)) return "For SELL, SL must be greater than Entry.";
  }
  return "";
}

export default function ChartSnapshotsPage() {
  const navigate = useNavigate();
  const { symbol: paramSymbol } = useParams();
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [templates, setTemplates] = useState(() => loadTemplates());
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [templateName, setTemplateName] = useState("");

  const [provider, setProvider] = useState("ICMARKETS");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [addingSignal, setAddingSignal] = useState(false);
  const [settingsTab, setSettingsTab] = useState("settings");
  const [responseTab, setResponseTab] = useState("text");
  const [status, setStatus] = useState({ type: "", text: "" });
  const [actionStatus, setActionStatus] = useState({
    action: "",
    type: "",
    text: "",
  });
  const [warmupGate, setWarmupGate] = useState({
    locked: false,
    timedOut: false,
    startedAt: 0,
  });

  const [analysisRaw, setAnalysisRaw] = useState("");
  const [analysisJson, setAnalysisJson] = useState("");
  const [analysisParsed, setAnalysisParsed] = useState(null);
  const [analysisSource, setAnalysisSource] = useState("ai_claude");
  const [browserTf, setBrowserTf] = useState("4h");
  const [browserTfs, setBrowserTfs] = useState(["4h"]);
  const [visibleCount, setVisibleCount] = useState(8);
  const [searchTerm, setSearchTerm] = useState("");
  const [apiSymbolOptions, setApiSymbolOptions] = useState([]);
  const [symbolActivity, setSymbolActivity] = useState({
    loading: false,
    items: [],
  });

  const [usedFiles, setUsedFiles] = useState([]);
  const [sessionPrefix, setSessionPrefix] = useState("");

  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [watchlist, setWatchlist] = useState([]);
  const [isSymbolPanelOpen, setIsSymbolPanelOpen] = useState(true);
  const [symbolFilterTab, setSymbolFilterTab] = useState("FAVOURITE");
  const [analysisFilesDisplay, setAnalysisFilesDisplay] = useState([]);
  const [position, setPosition] = useState({
    direction: "BUY",
    entry: "",
    tp: "",
    sl: "",
    rr: "",
    trade_type: "limit",
    note: "",
  });
  const [barsCache, setBarsCache] = useState({});
  const [barsLoading, setBarsLoading] = useState(false);
  const [aiContext, setAiContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [warmupState, setWarmupState] = useState({
    contextReady: false,
    snapshotsReady: false,
    snapshotsMatched: 0,
    snapshotsTarget: 0,
  });
  const [autoFlow, setAutoFlow] = useState({
    runId: 0,
    context: "idle",
    snapshots: "idle",
    analysis: "idle",
    message: "",
    updatedAt: null,
  });
  const [marketMetadata, setMarketMetadata] = useState({
    source: "",
    updated_time: null,
    auto_refresh: 0,
  });
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState(() =>
    buildPrompt(DEFAULT_CONFIG),
  );
  const [promptEdited, setPromptEdited] = useState(false);
  const [guideDraft, setGuideDraft] = useState(GUIDE_TEXT);
  const liteChartRef = useRef(null);
  const liteChartApiRef = useRef(null);
  const contextWarmupRef = useRef({ key: "", promise: null });
  const snapshotWarmupRef = useRef({ key: "", promise: null });
  const autoFlowRef = useRef({ runId: 0, key: "", timer: null });
  const warmupUnlockTimerRef = useRef(null);
  const lastAutoAnalyzeRef = useRef("");
  const tfConfig = useMemo(() => getEffectiveTfConfig(cfg), [cfg]);

  const tvSymbol = useMemo(() => {
    const raw = String(cfg.symbol || "")
      .trim()
      .toUpperCase();
    if (!raw) return "";

    let p = String(provider || "ICMARKETS").toUpperCase();
    let s = raw;
    if (raw.includes(":")) {
      const parts = raw.split(":");
      p = parts[0];
      s = parts[1];
    }

    // Common fixes for TradingView indices/commodities by provider
    const FIXES = {
      OANDA: {
        US30: "US30USD",
        NAS100: "NAS100USD",
        SPX500: "SP500USD",
        GER30: "DE30EUR",
        GER40: "DE40EUR",
        UK100: "UK100GBP",
        HK33: "HK33HKD",
        JP225: "JP225USD",
      },
      ICMARKETS: {
        NAS100: "USTEC",
        SPX500: "US500",
      },
      EIGHTCAP: {
        NAS100: "NAS100",
        SPX500: "SPX500",
      },
    };

    const fixed = FIXES[p]?.[s] || s;
    return `${p}:${fixed}`;
  }, [cfg.symbol, provider]);

  const symbolSelectOptions = useMemo(() => {
    const merged = [...watchlist];
    const current = normalizeWatchSymbol(cfg.symbol);
    if (current && !merged.includes(current)) merged.unshift(current);
    return [...new Set(merged.map(normalizeWatchSymbol).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    );
  }, [watchlist, cfg.symbol]);

  const promptText = useMemo(() => buildPrompt(cfg), [cfg]);

  useEffect(() => {
    // Reset analysis data when symbol changes
    setAnalysisRaw("");
    setAnalysisJson("");
    setAnalysisParsed(null);
    setPosition({
      direction: "BUY",
      entry: "",
      tp: "",
      sl: "",
      rr: "",
      trade_type: "limit",
      note: "",
    });
    setResponseTab("chart");
    setUsedFiles([]);
    setAnalysisFilesDisplay([]);
    setActionStatus({ action: "", type: "", text: "" });
    setSessionPrefix("");
    setAiContext(null);
  }, [cfg.symbol]);
  const [selectedEntryTf, setSelectedEntryTf] = useState("");
  const timeframe = useMemo(() => {
    const raw = selectedEntryTf || "";
    if (!raw || raw.toUpperCase() === "ENTRY") {
      return normalizeTfLabelToLower(tfConfig.exec_tfs?.[0] || "15m");
    }
    return raw;
  }, [selectedEntryTf, tfConfig.exec_tfs]);
  const snapshotTfs = useMemo(() => {
    const all = [
      ...(tfConfig.htf_tfs || []),
      ...(tfConfig.exec_tfs || []),
      ...(tfConfig.conf_tfs || []),
    ];
    return [...new Set(all.map(configTfToSnapshotTf).filter(Boolean))];
  }, [tfConfig.htf_tfs, tfConfig.exec_tfs, tfConfig.conf_tfs]);
  const jsonConfigText = useMemo(() => buildJsonConfig(cfg), [cfg]);
  const widgetTfs = useMemo(() => {
    const base = [
      ...new Set(
        [
          ...(tfConfig.htf_tfs || []),
          ...(tfConfig.exec_tfs || []),
          ...(tfConfig.conf_tfs || []),
        ]
          .map((x) =>
            String(x || "")
              .toLowerCase()
              .trim(),
          )
          .filter(Boolean),
      ),
    ];
    const fallback = ["d", "4h", "15m", "5m", "1m", "w"];
    for (const tf of fallback) {
      if (base.length >= 4) break;
      if (!base.includes(tf.toLowerCase())) base.push(tf.toLowerCase());
    }
    return base.slice(0, 4);
  }, [tfConfig.htf_tfs, tfConfig.exec_tfs, tfConfig.conf_tfs]);
  const normalizedSymbolForBars = useMemo(
    () => normalizeSignalSymbol(tvSymbol || cfg.symbol || ""),
    [tvSymbol, cfg.symbol],
  );
  const currentBarsKey = useMemo(
    () =>
      `${normalizedSymbolForBars}|${timeframe}|${Number(cfg.lookbackBars || 300) || 300}`,
    [normalizedSymbolForBars, timeframe, cfg.lookbackBars],
  );
  const currentBarsSnapshot = barsCache[currentBarsKey] || null;
  const contextByTf = useMemo(() => {
    const map = new Map();
    const rows = Array.isArray(aiContext?.timeframes)
      ? aiContext.timeframes
      : [];
    rows.forEach((row) => {
      const key = String(row?.tf || row?.tf_norm || "").toUpperCase();
      if (key) map.set(key, row);
    });
    return map;
  }, [aiContext]);

  const effectiveParsed = useMemo(() => {
    const current = enrichParsedAnalysis(
      analysisRaw,
      analysisParsed ||
        tryParseJsonLoose(analysisJson) ||
        tryParseJsonLoose(analysisRaw),
    );
    if (current && Object.keys(current).length > 0) return current;
    if (currentBarsSnapshot?.metadata) {
      return enrichParsedAnalysis("", currentBarsSnapshot.metadata);
    }
    return current;
  }, [analysisParsed, analysisJson, analysisRaw, currentBarsSnapshot]);

  const hasResponse = useMemo(
    () =>
      Boolean(
        (analysisRaw || "").trim() ||
        (analysisJson || "").trim() ||
        (effectiveParsed &&
          typeof effectiveParsed === "object" &&
          Object.keys(effectiveParsed).length > 0),
      ),
    [analysisRaw, analysisJson, effectiveParsed],
  );
  const flowChipText = useMemo(() => {
    const fmt = (label, value) =>
      `${label}:${value === "loading" ? "..." : value}`;
    return [
      fmt("C", autoFlow.context),
      `S:${autoFlow.snapshots === "loading" ? "..." : `${warmupState.snapshotsMatched}/${Math.max(1, warmupState.snapshotsTarget || snapshotTfs.length || 1)}`}`,
      fmt("A", autoFlow.analysis),
    ].join(" | ");
  }, [
    autoFlow.context,
    autoFlow.snapshots,
    autoFlow.analysis,
    warmupState.snapshotsMatched,
    warmupState.snapshotsTarget,
    snapshotTfs.length,
  ]);
  const responseText = useMemo(
    () => buildFriendlyResponse(effectiveParsed),
    [effectiveParsed],
  );
  const canAddSignal = useMemo(() => {
    const fromAi =
      extractSignalsFromAnalysis(effectiveParsed, {
        symbol: String(tvSymbol || "")
          .split(":")
          .pop(),
        timeframe,
        strategy: cfg.strategies.join("+") || "ai",
        source: analysisSource,
      }).length > 0;
    if (fromAi) return true;
    const err = validatePosition(position);
    return (
      Boolean(
        normalizeSignalSymbol(
          String(tvSymbol || cfg.symbol || "")
            .split(":")
            .pop(),
        ),
      ) && !err
    );
  }, [
    effectiveParsed,
    tvSymbol,
    timeframe,
    cfg.strategies,
    position.entry,
    position.sl,
    position.tp,
    position.rr,
    position.direction,
    cfg.symbol,
  ]);

  const setCfgField = (key, value) => {
    setCfg((prev) => ({ ...prev, [key]: value }));
    if (key === "symbol") {
      if (value) {
        navigate(`/ai/browser/${encodeURIComponent(value)}`, { replace: true });
      } else {
        navigate("/ai/browser", { replace: true });
      }
    }
  };
  const resetPositionLocal = () => {
    if (effectiveParsed && typeof effectiveParsed === "object") {
      setPosition(extractPositionFromAnalysis(effectiveParsed));
      return;
    }
    setPosition({
      direction: "BUY",
      entry: "",
      tp: "",
      sl: "",
      rr: "",
      trade_type: "limit",
      note: "",
    });
  };
  const setProfilePreset = (profileKey) => {
    const key = String(profileKey || "")
      .trim()
      .toLowerCase();
    const preset = PROFILE_PRESETS[key] || PROFILE_PRESETS.day;
    setCfg((prev) => ({
      ...prev,
      profile: PROFILE_PRESETS[key] ? key : "day",
      htf_tfs: [...preset.htf_tfs],
      exec_tfs: [...preset.exec_tfs],
      conf_tfs: [...preset.conf_tfs],
    }));
  };

  const loadSnapshots = async () => {
    setLoading(true);
    setStatus({ type: "", text: "" });
    try {
      const out = await api.chartSnapshots(60);
      const arr = Array.isArray(out?.items) ? out.items : [];
      setItems(arr);
      setSelectedFiles(new Set());
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Failed to load snapshots."),
      });
    } finally {
      setLoading(false);
    }
  };

  const waitTimeout = (ms = 10000) =>
    new Promise((resolve) => {
      window.setTimeout(resolve, Math.max(0, Number(ms) || 0));
    });
  const withTimeout = async (promise, ms = 10000) => {
    try {
      const value = await Promise.race([
        promise.then((v) => ({ ok: true, value: v })),
        waitTimeout(ms).then(() => ({ ok: false, timedOut: true })),
      ]);
      return value;
    } catch (error) {
      return { ok: false, timedOut: false, error };
    }
  };

  const isCurrentFlowRun = (runId) =>
    !runId || autoFlowRef.current.runId === runId;

  const setAutoFlowForRun = (runId, patch) => {
    if (!isCurrentFlowRun(runId)) return;
    setAutoFlow((prev) => ({
      ...prev,
      ...patch,
      runId: runId || prev.runId,
      updatedAt: Date.now(),
    }));
  };

  const resolveRecentSnapshots = (opts = {}) => {
    const nowMs = Date.now();
    const activeSessionPrefix = String(opts.sessionPrefix || "").trim();
    const targetTfTokens = [
      ...new Set(
        snapshotTfs.map((x) => toTradingViewInterval(x).toUpperCase()),
      ),
    ];
    const tfTokenToTf = new Map();
    snapshotTfs.forEach((tf) => {
      const token = toTradingViewInterval(tf).toUpperCase();
      if (token && !tfTokenToTf.has(token)) tfTokenToTf.set(token, tf);
    });
    const symbolRaw = String(cfg.symbol || "")
      .trim()
      .toUpperCase();
    const providerRaw = String(provider || "")
      .trim()
      .toUpperCase();
    const fullSymbol = symbolRaw.includes(":")
      ? symbolRaw
      : `${providerRaw}:${symbolRaw}`;
    const symbolTokens = new Set(
      [symbolRaw, fullSymbol, tvSymbol]
        .map((x) => sanitizeSnapshotFileToken(x || ""))
        .filter(Boolean),
    );
    const candidates = items
      .map(parseSnapshotMeta)
      .filter((x) => x && x.createdAtMs > 0)
      .filter((x) => symbolTokens.has(x.symbolToken))
      .filter((x) => targetTfTokens.includes(x.tfToken))
      .filter(
        (x) =>
          !activeSessionPrefix ||
          !x.sessionPrefix ||
          x.sessionPrefix === activeSessionPrefix,
      )
      .filter((x) => isSameDay(x.createdAtMs, nowMs))
      .filter((x) => Math.abs(nowMs - x.createdAtMs) <= 15 * 60 * 1000)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);

    const byTf = new Map();
    for (const c of candidates) {
      if (!byTf.has(c.tfToken)) byTf.set(c.tfToken, c.fileName);
    }
    const matchedFiles = targetTfTokens
      .map((tf) => byTf.get(tf))
      .filter(Boolean);
    const missingTokens = targetTfTokens.filter((tf) => !byTf.has(tf));
    return {
      matchedFiles,
      targetTfTokens,
      missingTokens,
      missingTfs: missingTokens
        .map((token) => tfTokenToTf.get(token))
        .filter(Boolean),
    };
  };

  const buildContextFromCache = (symbol) => {
    if (!symbol) return null;
    const master = chartFetchManager.get(symbol, 120_000);
    if (!master || master.stale) return null;
    const tfRows = Object.entries(master.context || {}).map(([tf, ctx]) => ({
      tf,
      ...ctx,
    }));
    if (!tfRows.length) return null;
    return {
      timeframes: tfRows,
      generated_at: new Date(master.cached_at).toISOString(),
      source: master.source || "chart_refresh_cache",
      context_files: [],
    };
  };

  const startContextWarmup = async (opts = {}) => {
    const symbol = normalizeSignalSymbol(tvSymbol || cfg.symbol || "");
    const warmupKey = `${symbol}|${String(provider || "").toUpperCase()}|${snapshotTfs.join(",")}|${Number(cfg.lookbackBars || 300) || 300}`;
    if (!symbol) return null;
    if (
      !opts.force &&
      contextWarmupRef.current.key === warmupKey &&
      contextWarmupRef.current.promise
    ) {
      return contextWarmupRef.current.promise;
    }
    const promise = (async () => {
      if (isCurrentFlowRun(opts.runId)) setContextLoading(true);
      setAutoFlowForRun(opts.runId, { context: "loading" });
      const out = await api.chartRefresh({
        symbols: [symbol],
        provider,
        timeframes: snapshotTfs,
        types: ["context"],
        bars: Number(cfg.lookbackBars || 300) || 300,
        force: opts.refresh === true,
        include_snapshots: opts.includeSnapshots === true,
      });
      const context = out?.context || out?.symbols?.[0]?.context || null;
      if (isCurrentFlowRun(opts.runId)) {
        setAiContext(context && typeof context === "object" ? context : null);
        setMarketMetadata({
          source: "chart_context",
          updated_time: Date.now(),
          auto_refresh: 0,
        });
      }
      const rows = Array.isArray(context?.timeframes) ? context.timeframes : [];
      const hasRows = rows.length > 0;
      if (isCurrentFlowRun(opts.runId)) {
        setWarmupState((prev) => ({ ...prev, contextReady: hasRows }));
        setAutoFlowForRun(opts.runId, {
          context: hasRows ? "ready" : "failed",
        });
      }
      return context;
    })()
      .catch((error) => {
        setAutoFlowForRun(opts.runId, {
          context: "failed",
          message: String(error?.message || error || "Context refresh failed."),
        });
        throw error;
      })()
      .finally(() => {
        if (isCurrentFlowRun(opts.runId)) setContextLoading(false);
        if (contextWarmupRef.current.key === warmupKey)
          contextWarmupRef.current.promise = null;
      });
    contextWarmupRef.current = { key: warmupKey, promise };
    return promise;
  };

  const startSnapshotWarmup = async (opts = {}) => {
    const symbol = normalizeSignalSymbol(tvSymbol || cfg.symbol || "");
    const warmupKey = `${symbol}|${String(provider || "").toUpperCase()}|${snapshotTfs.join(",")}|${Number(cfg.lookbackBars || 300) || 300}|${String(opts.sessionPrefix || "").trim()}`;
    if (!symbol)
      return {
        matchedFiles: [],
        targetTfTokens: [],
        missingTokens: [],
        missingTfs: [],
      };
    if (
      !opts.force &&
      snapshotWarmupRef.current.key === warmupKey &&
      snapshotWarmupRef.current.promise
    ) {
      return snapshotWarmupRef.current.promise;
    }
    const promise = (async () => {
      setAutoFlowForRun(opts.runId, { snapshots: "loading" });
      if (isCurrentFlowRun(opts.runId)) setCapturing(true);
      const initial = resolveRecentSnapshots({
        sessionPrefix: opts.sessionPrefix || "",
      });
      setWarmupState((prev) => ({
        ...prev,
        snapshotsReady:
          initial.missingTokens.length === 0 &&
          initial.targetTfTokens.length > 0,
        snapshotsMatched: initial.matchedFiles.length,
        snapshotsTarget: initial.targetTfTokens.length,
      }));
      if (!opts.captureMissing || initial.missingTfs.length === 0) {
        setAutoFlowForRun(opts.runId, {
          snapshots: initial.missingTokens.length === 0 ? "ready" : "partial",
        });
        return initial;
      }
      const out = await api.chartRefresh({
        symbols: [
          String(tvSymbol || "")
            .split(":")
            .pop(),
        ],
        provider,
        timeframes: initial.missingTfs,
        types: ["snapshots"],
        session_prefix: String(opts.sessionPrefix || "").trim() || undefined,
        bars: Number(cfg.lookbackBars || 300),
        format: "jpg",
        quality: 55,
        snapshot_max_age_ms: 15 * 60 * 1000,
      });
      const snap = out?.snapshots || out?.symbols?.[0]?.snapshots || {};
      const returnedItems = Array.isArray(snap?.items) ? snap.items : [];
      const created = Array.isArray(snap?.created) ? snap.created : [];
      const cached = Array.isArray(snap?.cached) ? snap.cached : [];
      if (returnedItems.length) {
        setItems((prev) => [...returnedItems, ...prev].slice(0, 60));
      } else {
        await loadSnapshots();
      }
      const matchedFiles = returnedItems
        .map((x) => String(x?.file_name || "").trim())
        .filter(Boolean);
      const targetTokens = Array.isArray(snap?.target_timeframes)
        ? snap.target_timeframes
        : initial.targetTfTokens;
      const missingTokens = Array.isArray(snap?.missing_timeframes)
        ? snap.missing_timeframes
        : [];
      const resolved = {
        matchedFiles,
        targetTfTokens: targetTokens,
        missingTokens,
        missingTfs: missingTokens,
        created,
        cached,
      };
      setWarmupState((prev) => ({
        ...prev,
        snapshotsReady:
          resolved.missingTokens.length === 0 &&
          resolved.targetTfTokens.length > 0,
        snapshotsMatched: resolved.matchedFiles.length,
        snapshotsTarget: resolved.targetTfTokens.length,
      }));
      setAutoFlowForRun(opts.runId, {
        snapshots: resolved.missingTokens.length === 0 ? "ready" : "partial",
      });
      return resolved;
    })()
      .catch(() => {
        setWarmupState((prev) => ({ ...prev, snapshotsReady: false }));
        setAutoFlowForRun(opts.runId, { snapshots: "failed" });
        return resolveRecentSnapshots({
          sessionPrefix: opts.sessionPrefix || "",
        });
      })
      .finally(() => {
        if (isCurrentFlowRun(opts.runId)) setCapturing(false);
        if (snapshotWarmupRef.current.key === warmupKey)
          snapshotWarmupRef.current.promise = null;
      });
    snapshotWarmupRef.current = { key: warmupKey, promise };
    return promise;
  };

  const setActionMessage = (action, type, text) => {
    setActionStatus({ action, type, text: String(text || "") });
  };
  const normalizeUiStatus = (type, text) => {
    const msg = String(text || "");
    if (
      /bars\/context still not ready/i.test(msg) ||
      /please retry in a few seconds/i.test(msg)
    ) {
      return {
        type: "warning",
        text: "Bars/context is warming in background. You can retry Analyze in a moment.",
      };
    }
    return { type, text: msg };
  };

  const fetchBarsSnapshot = async (symbol, tf, bars, forceRefresh = false) => {
    const sym = normalizeSignalSymbol(symbol || "");
    const cacheKey = `${sym}|${tf}|${bars}`;
    if (!sym) return null;
    if (!forceRefresh && barsCache[cacheKey]) {
      return barsCache[cacheKey];
    }
    setBarsLoading(true);
    try {
      const out = await api.chartTwelveCandles(sym, tf, bars, forceRefresh);
      if (out?.source || out?.updated_time) {
        setMarketMetadata({
          source: out.source || "",
          updated_time: out.updated_time || null,
          auto_refresh: out.auto_refresh || 0,
        });
      }
      const rawSnap =
        out?.snapshot && typeof out.snapshot === "object" ? out.snapshot : null;
      const snap = rawSnap ? normalizeSnapshotBars(rawSnap, tf) : null;
      if (snap) {
        setBarsCache((prev) => ({ ...prev, [cacheKey]: snap }));
      }
      return snap;
    } catch {
      return null;
    } finally {
      setBarsLoading(false);
    }
  };

  const loadAiContext = async (opts = {}) => {
    const symbol = normalizeSignalSymbol(tvSymbol || cfg.symbol || "");
    if (!symbol) return null;
    setContextLoading(true);
    try {
      const out = await api.chartContext({
        symbol,
        provider,
        tfs: snapshotTfs,
        bars: Number(cfg.lookbackBars || 300) || 300,
        refresh: opts.refresh ? 1 : 0,
        include_snapshots: opts.includeSnapshots ? 1 : 0,
      });
      setAiContext(out && typeof out === "object" ? out : null);
      setMarketMetadata({
        source: "chart_context",
        updated_time: Date.now(),
        auto_refresh: 0,
      });
      return out;
    } catch (e) {
      setStatus({
        type: "warning",
        text: String(e?.message || e || "Failed to load AI context."),
      });
      return null;
    } finally {
      setContextLoading(false);
    }
  };

  useEffect(() => {
    const symbol = normalizeSignalSymbol(tvSymbol || cfg.symbol || "");
    if (!symbol) {
      setWarmupState({
        contextReady: false,
        snapshotsReady: false,
        snapshotsMatched: 0,
        snapshotsTarget: 0,
      });
      setAutoFlow({
        runId: 0,
        context: "idle",
        snapshots: "idle",
        analysis: "idle",
        message: "",
        updatedAt: null,
      });
      return;
    }
    if (autoFlowRef.current.timer) {
      window.clearTimeout(autoFlowRef.current.timer);
      autoFlowRef.current.timer = null;
    }
    const flowKey = `${symbol}|${provider}|${snapshotTfs.join(",")}|${Number(cfg.lookbackBars || 300) || 300}`;
    const runId = Date.now();
    const activeSessionPrefix = makeSessionPrefix();
    autoFlowRef.current = { runId, key: flowKey, timer: null };
    if (warmupUnlockTimerRef.current) {
      window.clearTimeout(warmupUnlockTimerRef.current);
      warmupUnlockTimerRef.current = null;
    }
    setWarmupGate({ locked: true, timedOut: false, startedAt: Date.now() });
    warmupUnlockTimerRef.current = window.setTimeout(() => {
      setWarmupGate((prev) => ({ ...prev, locked: false, timedOut: true }));
      warmupUnlockTimerRef.current = null;
    }, 45000);
    setSessionPrefix(activeSessionPrefix);
    setAutoFlow({
      runId,
      context: "loading",
      snapshots: "loading",
      analysis: "idle",
      message: "",
      updatedAt: Date.now(),
    });
    setWarmupState((prev) => ({
      ...prev,
      contextReady: false,
      snapshotsReady: false,
    }));

    const runOnce = async (isInterval = false) => {
      const currentRunId = autoFlowRef.current.runId;

      // If SymbolChart already cached fresh data, build context from cache
      const cachedCtx = buildContextFromCache(symbol);
      const ctxPromise = cachedCtx
        ? Promise.resolve(cachedCtx)
        : startContextWarmup({
            includeSnapshots: false,
            runId: currentRunId,
            refresh: isInterval,
          });

      // If cache hit, update states immediately
      if (cachedCtx && isCurrentFlowRun(currentRunId)) {
        setAiContext(cachedCtx);
        setWarmupState((prev) => ({ ...prev, contextReady: true }));
        setAutoFlowForRun(currentRunId, { context: "ready" });
      }

      const [ctxSettled, snapSettled] = await Promise.allSettled([
        ctxPromise,
        startSnapshotWarmup({
          captureMissing: true,
          sessionPrefix: activeSessionPrefix,
          runId: currentRunId,
        }),
      ]);
      if (!isCurrentFlowRun(currentRunId)) return;
      const context =
        ctxSettled.status === "fulfilled" ? ctxSettled.value : null;
      const snapshots =
        snapSettled.status === "fulfilled"
          ? snapSettled.value
          : resolveRecentSnapshots({ sessionPrefix: activeSessionPrefix });
      if (context) {
        const analyzeKey = `${flowKey}|${context?.generated_at || ""}|${(snapshots?.matchedFiles || []).join(",")}`;
        if (lastAutoAnalyzeRef.current !== analyzeKey) {
          lastAutoAnalyzeRef.current = analyzeKey;
          setAutoFlowForRun(currentRunId, { analysis: "loading" });
          const analyzed = await analyzeFiles(snapshots?.matchedFiles || [], {
            context,
            runId: currentRunId,
            auto: true,
          });
          if (isCurrentFlowRun(currentRunId) && analyzed)
            setAutoFlowForRun(currentRunId, { analysis: "ready" });
        }
      } else {
        setAutoFlowForRun(currentRunId, {
          analysis: "idle",
          message: "Context refresh failed; analysis skipped.",
        });
      }
      if (isCurrentFlowRun(currentRunId)) {
        autoFlowRef.current.timer = window.setTimeout(
          () => {
            if (isCurrentFlowRun(currentRunId)) runOnce(true).catch(() => null);
          },
          5 * 60 * 1000,
        );
      }
    };

    runOnce(false).catch((error) => {
      setAutoFlowForRun(runId, {
        message: String(error?.message || error || "Auto flow failed."),
      });
    });

    return () => {
      if (autoFlowRef.current.timer)
        window.clearTimeout(autoFlowRef.current.timer);
      if (warmupUnlockTimerRef.current) {
        window.clearTimeout(warmupUnlockTimerRef.current);
        warmupUnlockTimerRef.current = null;
      }
      autoFlowRef.current = { runId: runId + 1, key: "", timer: null };
    };
  }, [tvSymbol, provider, snapshotTfs.join(","), cfg.lookbackBars]);

  useEffect(() => {
    const contextDone = autoFlow.context !== "loading";
    const snapshotsDone = autoFlow.snapshots !== "loading";
    if (warmupGate.locked && contextDone && snapshotsDone) {
      if (warmupUnlockTimerRef.current) {
        window.clearTimeout(warmupUnlockTimerRef.current);
        warmupUnlockTimerRef.current = null;
      }
      setWarmupGate((prev) => ({ ...prev, locked: false, timedOut: false }));
    }
  }, [warmupGate.locked, autoFlow.context, autoFlow.snapshots]);

  const analyzeFiles = async (files = [], opts = {}) => {
    setAnalyzing(true);
    setStatus({ type: "", text: "" });
    setAnalysisRaw("");
    setAnalysisJson("");
    setAnalysisParsed(null);
    setUsedFiles([]);
    setAnalysisFilesDisplay(Array.isArray(files) ? files : []);
    const activeSessionPrefix = sessionPrefix || makeSessionPrefix();
    if (!sessionPrefix) setSessionPrefix(activeSessionPrefix);
    try {
      if (opts.runId && !isCurrentFlowRun(opts.runId)) return null;
      const context =
        opts.context || (await loadAiContext({ includeSnapshots: true }));
      if (opts.runId && !isCurrentFlowRun(opts.runId)) return null;

      const basePrompt = String(promptDraft || promptText || "").trim();
      const runtimeConfig = JSON.stringify({
        symbol: String(tvSymbol || cfg.symbol || "")
          .split(":")
          .pop(),
        assetClass: cfg.asset,
        timeframes: [
          ...tfConfig.htf_tfs,
          ...tfConfig.exec_tfs,
          ...tfConfig.conf_tfs,
        ].map((x) => String(x).toUpperCase()),
        minRR: Number(cfg.rr),
        maxRiskPct: Number(cfg.risk),
        session: cfg.session,
        biasOverride: cfg.htfbias || null,
        direction: cfg.dir || null,
        news: cfg.news || null,
        notes: cfg.notes || null,
      });
      const guideOverride = String(guideDraft || "").trim();
      const composedPrompt = [
        basePrompt,
        `CONFIG:${runtimeConfig}`,
        guideOverride && guideOverride !== GUIDE_TEXT
          ? `USER_GUIDE:${guideOverride}`
          : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const payload = {
        model: "claude-sonnet-4-0",
        prompt: composedPrompt,
        session_prefix: activeSessionPrefix,
        max_tokens: 4500,
        symbol: String(tvSymbol || cfg.symbol || "")
          .split(":")
          .pop(),
        timeframe,
        provider,
        timeframes: snapshotTfs,
        bars_count: Number(cfg.lookbackBars || 300) || 300,
        use_context_files: true,
        context_mode: "claude",
        context_files: Array.isArray(context?.context_files)
          ? context.context_files
          : [],
      };

      if (Array.isArray(files) && files.length) payload.files = files;

      let out;
      try {
        out = await api.chartSnapshotsAnalyze(payload);
      } catch (firstErr) {
        // If Claude file references are stale, retry without them
        const msg = String(firstErr?.message || firstErr || "");
        if (
          msg.includes("not_found_error") ||
          msg.includes("not found") ||
          msg.includes("404")
        ) {
          payload.context_files = [];
          payload.use_context_files = false;
          payload.context_mode = "none";
          out = await api.chartSnapshotsAnalyze(payload);
        } else {
          throw firstErr;
        }
      }
      if (opts.runId && !isCurrentFlowRun(opts.runId)) return out;
      if (out?.source || out?.updated_time) {
        setMarketMetadata({
          source: out.source || "",
          updated_time: out.updated_time || null,
          auto_refresh: out.auto_refresh || 0,
        });
      }
      const raw = String(out?.raw_response || "");
      setAnalysisRaw(raw);
      setAnalysisSource(aiSourceFromModel(out?.model));
      const parsed = enrichParsedAnalysis(
        raw,
        out?.parsed_json || tryParseJsonLoose(raw),
      );
      if (parsed && typeof parsed === "object") {
        setAnalysisParsed(parsed);
        setAnalysisJson(JSON.stringify(parsed, null, 2));
        setPosition(extractPositionFromAnalysis(parsed));
      }
      setUsedFiles(Array.isArray(out?.used_files) ? out.used_files : []);
      if (!files.length)
        setAnalysisFilesDisplay(
          Array.isArray(out?.used_files) ? out.used_files : [],
        );
      setResponseTab("chart");
      const fileMode =
        out?.claude_files_mode === "files_api"
          ? ` Claude Files: ${Array.isArray(out?.claude_files) ? out.claude_files.length : 0}.`
          : out?.claude_files_mode === "context_files"
            ? ` Claude context files: ${Array.isArray(out?.claude_files) ? out.claude_files.length : 0}.`
            : out?.claude_files_mode === "fallback_base64"
              ? " Claude Files failed; used base64 fallback."
              : "";
      const msg = `Analyzed ${Array.isArray(out?.used_files) ? out.used_files.length : 0} screenshot(s).${fileMode}`;
      setStatus({ type: "success", text: msg });
      setActionMessage("analyze", "success", msg);
      return out;
    } catch (e) {
      const msg = String(e?.message || e || "Analyze failed.");
      const normalized = normalizeUiStatus("error", msg);
      setStatus(normalized);
      setActionMessage("analyze", normalized.type, normalized.text);
      if (opts.runId)
        setAutoFlowForRun(opts.runId, {
          analysis: "failed",
          message: normalized.text,
        });
      return null;
    } finally {
      if (!opts.runId || isCurrentFlowRun(opts.runId)) setAnalyzing(false);
    }
  };

  const captureSnapshots = async () => {
    if (!String(tvSymbol || "").trim()) {
      setStatus({ type: "warning", text: "Symbol is required." });
      return;
    }
    const tfs = [
      ...new Set(
        snapshotTfs.map((x) => String(x || "").trim()).filter(Boolean),
      ),
    ];
    if (!tfs.length) {
      setStatus({ type: "warning", text: "Select at least one timeframe." });
      return;
    }
    setCapturing(true);
    setStatus({ type: "", text: "" });
    const activeSessionPrefix = sessionPrefix || makeSessionPrefix();
    if (!sessionPrefix) setSessionPrefix(activeSessionPrefix);
    try {
      const out = await api.chartSnapshotCreateBatch({
        symbol: String(tvSymbol || "")
          .split(":")
          .pop(),
        provider,
        session_prefix: activeSessionPrefix,
        timeframes: tfs,
        lookbackBars: Number(cfg.lookbackBars || 300),
        format: "jpg",
        quality: 55,
      });
      const created = Array.isArray(out?.items) ? out.items : [];
      if (created.length) {
        setItems((prev) => [...created, ...prev].slice(0, 60));
      } else {
        await loadSnapshots();
      }
      const createdTfSet = new Set(
        created.map((x) => parseSnapshotMeta(x)?.tfToken).filter(Boolean),
      );
      const expectedTfSet = new Set(
        tfs.map((x) => toTradingViewInterval(x).toUpperCase()),
      );
      const missing = [...expectedTfSet].filter((tf) => !createdTfSet.has(tf));
      if (missing.length) {
        const msg = `Captured ${created.length} snapshot(s). Missing TF: ${missing.map(intervalTokenToLabel).join(", ")}`;
        setStatus({ type: "warning", text: msg });
        setActionMessage("capture", "warning", msg);
      } else {
        const msg = `Captured ${created.length || tfs.length} snapshot(s).`;
        setStatus({ type: "success", text: msg });
        setActionMessage("capture", "success", msg);
      }
    } catch (e) {
      const msg = String(e?.message || e || "Snapshots failed.");
      setStatus({ type: "error", text: msg });
      setActionMessage("capture", "error", msg);
    } finally {
      setCapturing(false);
    }
  };

  const analyzeSelected = async () => {
    const activeSessionPrefix = sessionPrefix || makeSessionPrefix();
    if (!sessionPrefix) setSessionPrefix(activeSessionPrefix);
    const files = [...selectedFiles];
    if (files.length) {
      await analyzeFiles(files);
      return;
    }
    const tfs = [
      ...new Set(
        snapshotTfs.map((x) => String(x || "").trim()).filter(Boolean),
      ),
    ];
    if (!String(tvSymbol || "").trim() || !tfs.length) {
      setStatus({
        type: "warning",
        text: "Symbol and at least one snapshot TF are required.",
      });
      return;
    }

    if (warmupGate.locked) {
      setStatus({
        type: "warning",
        text: "Warm-up in progress. Please wait...",
      });
      return;
    }
    setStatus({
      type: "warning",
      text: "Starting analyze. Missing data will continue warming in background...",
    });
    try {
      const contextRows = Array.isArray(aiContext?.timeframes)
        ? aiContext.timeframes
        : [];
      const hasContext = contextRows.length > 0;
      const recent = resolveRecentSnapshots({
        sessionPrefix: activeSessionPrefix,
      });
      const readySnapshots =
        recent.matchedFiles.length === recent.targetTfTokens.length &&
        recent.matchedFiles.length > 0;
      if (!hasContext)
        startContextWarmup({ includeSnapshots: false, force: false }).catch(
          () => null,
        );
      if (!readySnapshots) {
        startSnapshotWarmup({
          captureMissing: true,
          sessionPrefix: activeSessionPrefix,
          force: false,
        }).catch(() => null);
      }
      if (readySnapshots) {
        const msg = `Using snapshots (${recent.matchedFiles.length}) from warm-up cache.`;
        setStatus({ type: "success", text: msg });
        setActionMessage("analyze", "success", msg);
        await analyzeFiles(recent.matchedFiles, {
          context: hasContext ? aiContext : undefined,
        });
      } else {
        const msg =
          "Snapshots still partial. Analyze continues with bars/context while warm-up runs in background.";
        setStatus({ type: "warning", text: msg });
        setActionMessage("analyze", "warning", msg);
        await analyzeFiles([], { context: hasContext ? aiContext : undefined });
      }
    } catch (e) {
      const msg = String(e?.message || e || "Analyze preflight failed.");
      const normalized = normalizeUiStatus("error", msg);
      setStatus(normalized);
      setActionMessage("analyze", normalized.type, normalized.text);
    }
  };

  const deleteSnapshots = async (opts = { all: false, files: [] }) => {
    setDeleting(true);
    setStatus({ type: "", text: "" });
    try {
      const out = await api.chartSnapshotsDelete(opts);
      await loadSnapshots();
      setStatus({
        type: "success",
        text: `Deleted ${Number(out?.deleted_count || 0)} screenshot(s).`,
      });
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Delete failed."),
      });
    } finally {
      setDeleting(false);
    }
  };

  const deleteSelected = async () => {
    const files = [...selectedFiles];
    if (!files.length) {
      setStatus({ type: "warning", text: "No screenshot selected." });
      return;
    }
    await deleteSnapshots({ files });
  };

  const deleteOne = async (fileName) => {
    await deleteSnapshots({ files: [fileName] });
  };

  const deleteAll = async () => {
    await deleteSnapshots({ all: true });
  };

  const updatePositionField = (key, value) => {
    setPosition((prev) => {
      let normalizedValue = value;
      if (["entry", "tp", "sl", "rr"].includes(key)) {
        normalizedValue = String(value ?? "").replace(",", ".");
      }
      const next = { ...prev, [key]: normalizedValue };
      const e = parseNum(next.entry);
      const s = parseNum(next.sl);
      const t = parseNum(next.tp);
      const rrInput = parseNum(next.rr);
      if (key === "rr") {
        if (
          Number.isFinite(e) &&
          Number.isFinite(s) &&
          Number.isFinite(rrInput) &&
          rrInput > 0
        ) {
          const risk = Math.abs(e - s);
          if (risk > 0) {
            const currentTp = parseNum(prev.tp);
            const dirSign = Number.isFinite(currentTp)
              ? currentTp >= e
                ? 1
                : -1
              : String(prev.direction || "")
                    .toUpperCase()
                    .includes("SELL")
                ? -1
                : 1;
            const nextTp = e + dirSign * (risk * rrInput);
            if (Number.isFinite(nextTp)) next.tp = formatNum3(nextTp);
          }
        }
      } else if (
        Number.isFinite(e) &&
        Number.isFinite(s) &&
        Number.isFinite(t)
      ) {
        const risk = Math.abs(e - s);
        const reward = Math.abs(t - e);
        if (risk > 0 && reward > 0) next.rr = formatNum3(reward / risk);
      }
      if (["entry", "tp", "sl", "rr"].includes(key)) {
        const parsed = parseNum(next[key]);
        next[key] = Number.isFinite(parsed) ? formatNum3(parsed) : "";
      }
      return next;
    });
  };

  const [submittingPlanId, setSubmittingPlanId] = useState(null); // track which plan is adding
  const chartFiles = (
    analysisFilesDisplay && analysisFilesDisplay.length
      ? analysisFilesDisplay
      : usedFiles
  )
    .map((x) => String(x || "").trim())
    .filter(Boolean);

  const addBySelection = async (
    mode = "signal",
    overridePosition = null,
    planId = "main",
  ) => {
    setAddingSignal(true);
    setSubmittingPlanId(planId);
    setStatus({ type: "", text: "" });
    const activePosition = overridePosition || position;
    const activeSessionPrefix = sessionPrefix || makeSessionPrefix();
    if (!sessionPrefix) setSessionPrefix(activeSessionPrefix);
    try {
      let parsed = effectiveParsed;
      if (!parsed && analysisJson) parsed = JSON.parse(analysisJson);
      if (!parsed && analysisRaw)
        parsed = enrichParsedAnalysis(
          analysisRaw,
          tryParseJsonLoose(analysisRaw),
        );

      // If overridePosition is provided (from a specific plan card), we ONLY add that one.
      const signals = overridePosition
        ? []
        : extractSignalsFromAnalysis(parsed, {
            symbol: String(tvSymbol || "")
              .split(":")
              .pop(),
            timeframe,
            strategy: cfg.strategies.join("+") || "ai",
            source: analysisSource,
          });

      if (!signals.length) {
        const symbolManual = normalizeSignalSymbol(
          String(tvSymbol || cfg.symbol || "")
            .split(":")
            .pop(),
        );
        const entry = parseNum(activePosition.entry);
        const sl = parseNum(activePosition.sl);
        const tp = parseNum(activePosition.tp);
        const validationErr = validatePosition(activePosition);
        if (
          !symbolManual ||
          !Number.isFinite(entry) ||
          !Number.isFinite(sl) ||
          !Number.isFinite(tp)
        ) {
          throw new Error(
            "No valid signal found. Fill Entry/TP/SL or run Analyze first.",
          );
        }
        if (validationErr) throw new Error(validationErr);
        const dir = String(activePosition.direction || "")
          .trim()
          .toUpperCase();
        signals.push({
          symbol: symbolManual,
          action:
            dir === "BUY" || dir === "SELL"
              ? dir
              : tp >= entry
                ? "BUY"
                : "SELL",
          entry,
          sl,
          tp,
          tf: timeframe,
          model: analysisSource,
          entry_model: analysisSource,
          order_type: String(
            activePosition.trade_type || "limit",
          ).toLowerCase(),
          note: activePosition.note || "",
          source: analysisSource,
          strategy: cfg.strategies.join("+") || "ai",
          rr: parseNum(activePosition.rr),
        });
      }
      const validationErr = validatePosition(activePosition);
      if (validationErr) throw new Error(validationErr);
      let createdCount = 0;
      for (let i = 0; i < signals.length; i++) {
        const payload = signals[i];
        const dir = String(activePosition.direction || "")
          .trim()
          .toUpperCase();
        const cachedSnapshot =
          currentBarsSnapshot && typeof currentBarsSnapshot === "object"
            ? currentBarsSnapshot
            : null;
        const mergedPdArrays = Array.isArray(parsed?.market_analysis?.pd_arrays)
          ? parsed.market_analysis.pd_arrays
          : [];
        const mergedKeyLevels = Array.isArray(
          parsed?.market_analysis?.key_levels,
        )
          ? parsed.market_analysis.key_levels
          : [];
        const analysisSnapshotPayload = cachedSnapshot
          ? {
              ...cachedSnapshot,
              pd_arrays: mergedPdArrays,
              key_levels: mergedKeyLevels,
              htf_tfs: Array.isArray(tfConfig?.htf_tfs) ? tfConfig.htf_tfs : [],
              summary: {
                ...(cachedSnapshot.summary &&
                typeof cachedSnapshot.summary === "object"
                  ? cachedSnapshot.summary
                  : {}),
                profile: payload?.profile || parsed?.profile || "",
                bias: parsed?.market_analysis?.bias || "",
                trend: parsed?.market_analysis?.trend || "",
                note: activePosition.note || payload.note || "",
              },
            }
          : undefined;

        const finalPayload = {
          ...payload,
          source:
            String(payload?.source || analysisSource || "ai_claude").trim() ||
            "ai_claude",
          session_prefix: activeSessionPrefix
            ? `${activeSessionPrefix}_${i}`
            : undefined,
          sid: (() => {
            const s = normalizeSignalSymbol(
              payload.symbol || tvSymbol || cfg.symbol || "",
            );
            const p = String(activeSessionPrefix || "")
              .trim()
              .toUpperCase();
            return s && p ? `${s}_${p}_${i}` : undefined;
          })(),
          action: dir === "BUY" || dir === "SELL" ? dir : payload.action,
          entry: parseNum(activePosition.entry) || payload.entry,
          tp: parseNum(activePosition.tp) || payload.tp,
          sl: parseNum(activePosition.sl) || payload.sl,
          rr: parseNum(activePosition.rr) || payload.rr,
          order_type: String(
            activePosition.trade_type || payload.order_type || "limit",
          ).toLowerCase(),
          note: String(
            activePosition.note || payload.note || parsed?.note || "",
          ).trim(),
          only_signal: mode === "signal",
          profile: payload?.profile || parsed?.profile || "",
          trade_plan:
            parsed?.trade_plan && typeof parsed.trade_plan === "object"
              ? parsed.trade_plan
              : Array.isArray(parsed?.trade_plan)
                ? parsed.trade_plan
                : undefined,
          market_analysis:
            parsed?.market_analysis &&
            typeof parsed.market_analysis === "object"
              ? parsed.market_analysis
              : undefined,
          risk_management:
            parsed?.risk_management &&
            typeof parsed.risk_management === "object"
              ? parsed.risk_management
              : undefined,
          invalidation: payload?.invalidation || parsed?.invalidation || "",
          confidence_pct: Number.isFinite(payload?.confidence_pct)
            ? payload.confidence_pct
            : (parsed?.confidence_pct ?? null),
          final_verdict:
            parsed?.final_verdict && typeof parsed.final_verdict === "object"
              ? parsed.final_verdict
              : undefined,
          raw_json: parsed && typeof parsed === "object" ? parsed : undefined,
          snapshot_files: chartFiles,
          analysis_snapshot: analysisSnapshotPayload,
        };
        if (mode === "trade") {
          await api.createTrade(finalPayload);
        } else {
          await api.createSignal(finalPayload);
        }
        createdCount += 1;
      }
      const msg =
        mode === "trade"
          ? `Added ${createdCount} trade request(s).`
          : `Added ${createdCount} signal(s) only.`;
      setStatus({ type: "success", text: msg });
      setActionMessage("add", "success", msg);
    } catch (e) {
      const msg = String(e?.message || e || "Add Signal failed.");
      setStatus({ type: "error", text: msg });
      setActionMessage("add", "error", msg);
    } finally {
      setAddingSignal(false);
      setSubmittingPlanId(null);
    }
  };

  const saveTemplate = async () => {
    const name =
      String(templateName || "").trim() ||
      `${cfg.symbol} ${cfg.strategies.join("+")}`;
    const payload = {
      ...(templateId && templateId !== DEFAULT_TEMPLATE_ID
        ? { template_id: templateId }
        : {}),
      name,
      config: normalizeTemplateConfig(cfg),
      saved: new Date().toISOString(),
    };

    setStatus({ type: "warning", text: "Saving template..." });
    try {
      const out = await api.aiUpsertTemplate(payload);
      const savedTemplate = out?.template || payload;
      const item = {
        id: String(
          savedTemplate.template_id || templateId || `t_${Date.now()}`,
        ),
        name: String(savedTemplate.name || name),
        config: normalizeTemplateConfig(savedTemplate.config || {}),
        saved: savedTemplate.saved || payload.saved,
      };

      const next = [
        item,
        ...templates.filter((x) => x.name !== item.name),
      ].slice(0, 200);
      setTemplates(next);
      saveTemplatesToLocal(next);
      setTemplateId(item.id);
      setTemplateName("");
      setStatus({ type: "success", text: `Template saved: ${name}` });
    } catch (e) {
      console.error("[templates] Save failed:", e);
      setStatus({ type: "error", text: `Save failed: ${e.message}` });
    }
  };

  const deleteTemplate = async () => {
    if (!templateId || templateId === DEFAULT_TEMPLATE_ID) return;
    const found = templates.find((x) => x.id === templateId);
    if (!found) return;

    if (!window.confirm(`Delete template "${found.name}"?`)) return;

    setStatus({ type: "warning", text: "Deleting template..." });
    try {
      await api.aiDeleteTemplate(templateId);
      const next = templates.filter((x) => x.id !== templateId);
      setTemplates(next);
      saveTemplatesToLocal(next);
      setTemplateId("");
      setTemplateName("");
      setStatus({ type: "success", text: `Template deleted: ${found.name}` });
    } catch (e) {
      console.error("[templates] Delete failed:", e);
      setStatus({ type: "error", text: `Delete failed: ${e.message}` });
    }
  };

  const loadTemplatesFromDb = async () => {
    try {
      const out = await api.aiListTemplates();
      const rows = Array.isArray(out?.templates) ? out.templates : [];

      const dbTemplates = rows.map((r) => ({
        id: String(r.template_id || r.id || r.name || `t_${Date.now()}`),
        name: String(r.name || "Unnamed Template"),
        config: normalizeTemplateConfig(r.config || {}),
        saved:
          r.saved || r.updated_at || r.created_at || new Date().toISOString(),
      }));

      setTemplates((prev) => {
        // Merge with local storage (legacy), but DB takes priority
        const next = [...dbTemplates];
        prev.forEach((p) => {
          if (!next.find((n) => n.name === p.name)) {
            next.push(p);
          }
        });
        return next;
      });
    } catch (err) {
      console.warn("[templates] DB Load failed:", err.message);
    }
  };

  const handleSelectTemplate = (id) => {
    setTemplateId(id);
    if (id === DEFAULT_TEMPLATE_ID) {
      setCfg({ ...DEFAULT_CONFIG });
      setPromptEdited(false);
      setTemplateName("");
      setStatus({ type: "success", text: "Default template loaded." });
      return;
    }
    const found = templates.find((x) => x.id === id);
    if (!found?.config) return;
    setCfg(normalizeTemplateConfig(found.config));
    setPromptEdited(false);
    setStatus({ type: "success", text: `Template loaded: ${found.name}` });
  };

  const loadWatchlist = async () => {
    try {
      const out = await api.getSettings();
      const settings = Array.isArray(out?.settings) ? out.settings : [];
      const watchlistSetting = settings.find(
        (s) => s.type === "trade" && s.name === "WATCHLIST",
      );
      const symbols = Array.isArray(watchlistSetting?.data?.symbols)
        ? watchlistSetting.data.symbols
        : [];
      const persisted = [
        ...new Set(symbols.map(normalizeWatchSymbol).filter(Boolean)),
      ];
      console.log("[watchlist] Loaded from user_settings:", persisted);
      setWatchlist(persisted);
    } catch (err) {
      console.warn("[watchlist] Load failed, using empty list:", err.message);
      setWatchlist([]);
    }
  };

  const saveWatchlistToDb = async (nextList) => {
    try {
      await api.upsertSetting({
        type: "trade",
        name: "WATCHLIST",
        data: { symbols: nextList },
      });
      console.log("[watchlist] Saved to user_settings:", nextList);
    } catch (e) {
      console.error("[watchlist] Save failed:", e.message);
      throw e;
    }
  };

  const addCurrentSymbolToWatchlist = async () => {
    const s = normalizeWatchSymbol(cfg.symbol);
    if (!s) {
      setStatus({ type: "warning", text: "Symbol is required." });
      return;
    }
    const next = [...new Set([...watchlist, s])];
    try {
      await saveWatchlistToDb(next);
      setWatchlist(next);
      setStatus({ type: "success", text: `Added to watchlist: ${s}` });
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Failed to save watchlist."),
      });
    }
  };

  const removeFromWatchlist = async (s) => {
    const next = watchlist.filter((x) => x !== s);
    try {
      await saveWatchlistToDb(next);
      setWatchlist(next);
      setStatus({ type: "success", text: `Removed from watchlist: ${s}` });
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Failed to remove from watchlist."),
      });
    }
  };

  const toggleFile = (fileName) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  };

  useEffect(() => {
    loadSnapshots();
    // Read symbol from URL param
    if (paramSymbol) setCfgField("symbol", decodeURIComponent(paramSymbol));
  }, []);

  useEffect(() => {
    loadWatchlist();
    loadTemplatesFromDb();
  }, []);

  useEffect(() => {
    const check = () => {
      if (window.innerWidth < 900) setIsSymbolPanelOpen(false);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // Infinite scroll: load more on scroll near bottom
  useEffect(() => {
    const handler = () => {
      if (
        window.innerHeight + window.scrollY >=
        document.body.offsetHeight - 400
      ) {
        setVisibleCount((prev) => prev + 8);
      }
    };
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  useEffect(() => {
    const q = String(searchTerm || "").trim();
    if (!q || q.length < 2) {
      setApiSymbolOptions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await api.chartSymbols(q, "ICMARKETS", 20);
        if (Array.isArray(res?.symbols)) {
          setApiSymbolOptions(res.symbols.map((s) => s.symbol || s));
        }
      } catch (err) {
        console.warn("chartSymbols fetch error", err);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  useEffect(() => {
    if (!effectiveParsed || typeof effectiveParsed !== "object") return;
    setPosition(extractPositionFromAnalysis(effectiveParsed));
  }, [effectiveParsed]);

  useEffect(() => {
    if (!promptEdited) setPromptDraft(promptText);
  }, [promptText, promptEdited]);

  useEffect(() => {
    const symbol = normalizeSignalSymbol(tvSymbol || cfg.symbol || "");
    let alive = true;
    (async () => {
      try {
        setSymbolActivity((prev) => ({ ...prev, loading: true }));
        const [tradesOut, signalsOut] = await Promise.all([
          api.v2Trades({ symbol: symbol || undefined, page: 1, pageSize: 30 }),
          api.trades({ symbol: symbol || undefined, page: 1, pageSize: 30 }),
        ]);
        const tradeItems = Array.isArray(tradesOut?.items)
          ? tradesOut.items
          : [];
        const signalItems = Array.isArray(signalsOut?.trades)
          ? signalsOut.trades
          : [];
        const allowed = new Set(["PENDING", "FILLED", "OPEN", "NEW"]);
        const normalizedTrades = tradeItems
          .filter((x) =>
            allowed.has(String(x?.execution_status || "").toUpperCase()),
          )
          .map((x) => ({
            kind: "TRADE",
            status: String(x?.execution_status || "").toUpperCase(),
            side: String(x?.action || x?.side || "").toUpperCase(),
            type: "market",
            symbol: normalizeSignalSymbol(x?.symbol || symbol),
            entry: x?.entry,
            tp: x?.tp,
            sl: x?.sl,
            updatedAt: x?.updated_at || x?.created_at,
            id: x?.sid || x?.id,
          }));
        const normalizedSignals = signalItems
          .filter((x) => allowed.has(String(x?.status || "").toUpperCase()))
          .map((x) => ({
            kind: "SIGNAL",
            status: String(x?.status || "").toUpperCase(),
            side: String(x?.action || x?.side || "").toUpperCase(),
            type: String(x?.type || "limit").toLowerCase(),
            symbol: normalizeSignalSymbol(x?.symbol || symbol),
            entry: x?.entry || x?.target_price || x?.entry_price,
            tp: x?.tp || x?.tp_price,
            sl: x?.sl || x?.sl_price,
            updatedAt: x?.updated_at || x?.created_at,
            id: x?.sid || x?.id,
          }));
        const merged = [...normalizedTrades, ...normalizedSignals]
          .sort(
            (a, b) =>
              new Date(b.updatedAt || 0).getTime() -
              new Date(a.updatedAt || 0).getTime(),
          )
          .slice(0, 12);
        if (alive) setSymbolActivity({ loading: false, items: merged });
      } catch {
        if (alive) setSymbolActivity({ loading: false, items: [] });
      }
    })();
    return () => {
      alive = false;
    };
  }, [tvSymbol, cfg.symbol]);

  const settingsFormNode = (
    <section className="snapshot-settings-v2">
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "flex-end",
        }}
      >
        <div style={{ minWidth: 150 }}>
          <label className="minor-text">Profile TFs</label>
          <select
            value={cfg.profile || "day"}
            onChange={(e) => setProfilePreset(e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="position">{PROFILE_PRESETS.position.label}</option>
            <option value="swing">{PROFILE_PRESETS.swing.label}</option>
            <option value="day">{PROFILE_PRESETS.day.label}</option>
            <option value="scalper">{PROFILE_PRESETS.scalper.label}</option>
          </select>
        </div>
        <div style={{ minWidth: 100 }}>
          <label className="minor-text">Sessions</label>
          <select
            value={cfg.session}
            onChange={(e) => setCfgField("session", e.target.value)}
            style={{ width: "100%" }}
          >
            <option>Any</option>
            <option>London</option>
            <option>New York</option>
            <option>Asian</option>
            <option>London+NY</option>
          </select>
        </div>
        <div style={{ minWidth: 60 }}>
          <label className="minor-text">MinRR</label>
          <input
            type="number"
            min="0.5"
            step="0.5"
            value={cfg.rr}
            onChange={(e) => setCfgField("rr", e.target.value)}
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ minWidth: 100 }}>
          <label className="minor-text">HTF Bias</label>
          <select
            value={cfg.htfbias}
            onChange={(e) => setCfgField("htfbias", e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">Auto</option>
            <option>Bullish</option>
            <option>Bearish</option>
            <option>Ranging</option>
          </select>
        </div>
        <div style={{ minWidth: 120 }}>
          <label className="minor-text">Direction</label>
          <select
            value={cfg.dir}
            onChange={(e) => setCfgField("dir", e.target.value)}
            style={{ width: "100%" }}
          >
            <option>Both</option>
            <option>Bias</option>
            <option>Long only</option>
            <option>Short only</option>
          </select>
        </div>
        <div style={{ minWidth: 110 }}>
          <label className="minor-text">News</label>
          <select
            value={cfg.news}
            onChange={(e) => setCfgField("news", e.target.value)}
            style={{ width: "100%" }}
          >
            <option value="">None</option>
            <option>High-impact</option>
            <option>NFP/FOMC</option>
            <option>Earnings</option>
          </select>
        </div>
      </div>
      <div>
        <label className="minor-text">Strategy (multi-select)</label>
        <div className="snapshot-tag-wrap-v2">
          {STRATEGY_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={`secondary-button snapshot-tag-v2 ${cfg.strategies.includes(s) ? "active" : ""}`}
              onClick={() =>
                setCfgField("strategies", toggleArrayValue(cfg.strategies, s))
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="snapshot-context-v2">
        <div className="snapshot-col-span-12">
          <label className="minor-text">Notes</label>
          <textarea
            className="snapshot-notes-textarea-v3"
            rows={4}
            value={cfg.notes}
            onChange={(e) => setCfgField("notes", e.target.value)}
            placeholder="Notes / extra context"
          />
        </div>
      </div>
    </section>
  );
  const settingsTabContentNode = (
    <>
      {settingsTab === "settings" ? settingsFormNode : null}
      {settingsTab === "prompt" ? (
        <>
          <div className="minor-text">
            Prompt is the main instruction sent to AI on Analyze.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={promptDraft}
            onChange={(e) => {
              setPromptDraft(e.target.value);
              setPromptEdited(true);
            }}
          />
        </>
      ) : null}
      {settingsTab === "json" ? (
        <>
          <div className="minor-text">
            JSON Config is included in Analyze request as structured context
            (Prompt + JSON Config + Guide).
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={jsonConfigText}
            readOnly
            disabled
          />
        </>
      ) : null}
      {settingsTab === "schema" ? (
        <>
          <div className="minor-text">
            Expected AI Response Schema (JSON format required for parsing).
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={JSON.stringify(AI_RESPONSE_SCHEMA, null, 2)}
            readOnly
          />
        </>
      ) : null}
      {settingsTab === "guide" ? (
        <>
          <div className="minor-text">
            Guide is editable and included in Analyze request as additional
            instructions/checklist context.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={guideDraft}
            onChange={(e) => setGuideDraft(e.target.value)}
          />
        </>
      ) : null}
    </>
  );

  const resetAnalyzeSession = () => {
    setAnalysisRaw("");
    setAnalysisJson("");
    setAnalysisParsed(null);
    setAnalysisSource("ai_claude");
    setUsedFiles([]);
    setAnalysisFilesDisplay([]);
    setResponseTab("text");
    resetPositionLocal();
    setActionStatus({ action: "", type: "", text: "" });
    setSessionPrefix("");
    setStatus({ type: "success", text: "New analyze session started." });
  };

  const chartPdArrays = useMemo(() => {
    const arr = Array.isArray(effectiveParsed?.market_analysis?.pd_arrays)
      ? effectiveParsed.market_analysis.pd_arrays
      : [];
    return arr
      .map((x, idx) => {
        const lowRaw = parseNum(
          x?.low ?? x?.price_bottom ?? x?.bottom ?? x?.bot,
        );
        const highRaw = parseNum(x?.high ?? x?.price_top ?? x?.top);
        const zoneParsed = parsePdZoneBounds(x?.zone);
        const low = Number.isFinite(lowRaw) ? lowRaw : zoneParsed.low;
        const high = Number.isFinite(highRaw) ? highRaw : zoneParsed.high;
        const startTs = Number(x?.bar_start_unix ?? x?.bar_start);
        return {
          id: String(x?.id || `${String(x?.type || "PD")}_${idx}`),
          type: String(x?.type || "PD").trim(),
          timeframe: String(x?.timeframe || x?.tf || "").trim(),
          status: String(x?.status || "").trim(),
          barStart: Number.isFinite(startTs) ? startTs : null,
          low: Number.isFinite(low) ? low : null,
          high: Number.isFinite(high) ? high : null,
        };
      })
      .filter((x) => Number.isFinite(x.low) || Number.isFinite(x.high));
  }, [effectiveParsed]);

  const chartKeyLevels = useMemo(() => {
    const arr = Array.isArray(effectiveParsed?.market_analysis?.key_levels)
      ? effectiveParsed.market_analysis.key_levels
      : [];
    return arr
      .map((x, idx) => {
        const p = parseNum(x?.price ?? x?.level ?? x?.value);
        if (!Number.isFinite(p)) return null;
        return {
          id: `${String(x?.name || "KEY")}_${idx}`,
          name: String(x?.name || x?.type || "Key Level"),
          price: p,
          barStart: Number.isFinite(Number(x?.bar_start_unix ?? x?.bar_start))
            ? Number(x?.bar_start_unix ?? x?.bar_start)
            : null,
        };
      })
      .filter(Boolean);
  }, [effectiveParsed]);

  const analysisTradePlans = useMemo(() => {
    const plans = Array.isArray(effectiveParsed?.trade_plan)
      ? effectiveParsed.trade_plan
      : effectiveParsed?.trade_plan &&
          typeof effectiveParsed.trade_plan === "object"
        ? [effectiveParsed.trade_plan]
        : [];
    return plans
      .map((p, idx) => {
        const entry = parseNum(p?.entry);
        const sl = parseNum(p?.sl);
        const tp = getPlanPrimaryTp(p);
        const rr = parseNum(p?.rr);
        return {
          idx,
          raw: p,
          direction: String(p?.direction || "NULL").toUpperCase(),
          strategy: String(p?.strategy || "").trim(),
          entryModel: String(p?.entry_model || p?.model || "").trim(),
          confidence: parseNum(p?.confidence_pct),
          entry,
          sl,
          tp,
          rr,
          note: String(p?.note || "").trim(),
        };
      })
      .filter((x) => x.raw && typeof x.raw === "object");
  }, [effectiveParsed]);

  const applyTradePlanToEditor = (plan) => {
    if (!plan?.raw) return;
    setPosition(extractPositionFromPlan(plan.raw, effectiveParsed || {}));
  };

  useEffect(() => {
    if (!liteChartRef.current || responseTab !== "chart") return;
    const snapshot = normalizeSnapshotBars(currentBarsSnapshot, timeframe);
    const bars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
    if (!bars.length) return;

    if (liteChartApiRef.current) {
      liteChartApiRef.current.remove();
      liteChartApiRef.current = null;
    }

    const chart = createChart(liteChartRef.current, {
      width: Math.max(320, liteChartRef.current.clientWidth || 640),
      height: 320,
      layout: { background: { color: "transparent" }, textColor: "#b8c4de" },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.08)" },
        horzLines: { color: "rgba(255,255,255,0.08)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
      timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true },
      crosshair: { mode: 1 },
    });
    liteChartApiRef.current = chart;

    const candles = chart.addCandlestickSeries({
      upColor: "#1cc8b7",
      downColor: "#ef5350",
      borderVisible: false,
      wickUpColor: "#1cc8b7",
      wickDownColor: "#ef5350",
    });
    candles.setData(bars);

    chartPdArrays.forEach((pd, idx) => {
      const y = Number.isFinite(pd.high) ? pd.high : pd.low;
      if (!Number.isFinite(y)) return;
      const color = idx % 2 ? "rgba(255,193,7,0.8)" : "rgba(29,185,84,0.8)";
      const line = chart.addLineSeries({
        color,
        lineWidth: 1,
        lineStyle: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      line.setData([
        { time: bars[0].time, value: y },
        { time: bars[bars.length - 1].time, value: y },
      ]);
    });

    chartKeyLevels.forEach((lvl) => {
      const line = chart.addLineSeries({
        color: "rgba(104,163,255,0.9)",
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      line.setData([
        { time: bars[0].time, value: lvl.price },
        { time: bars[bars.length - 1].time, value: lvl.price },
      ]);
    });

    const entry = parseNum(position.entry);
    const sl = parseNum(position.sl);
    const tp = parseNum(position.tp);
    const addTradeLine = (val, color) => {
      if (!Number.isFinite(val)) return;
      const line = chart.addLineSeries({
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: true,
      });
      line.setData([
        { time: bars[0].time, value: val },
        { time: bars[bars.length - 1].time, value: val },
      ]);
    };
    addTradeLine(entry, "#33a0ff");
    addTradeLine(sl, "#ef5350");
    addTradeLine(tp, "#22c55e");

    chart.timeScale().fitContent();

    const onResize = () => {
      if (!liteChartRef.current || !liteChartApiRef.current) return;
      liteChartApiRef.current.applyOptions({
        width: Math.max(320, liteChartRef.current.clientWidth || 640),
      });
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (liteChartApiRef.current) {
        liteChartApiRef.current.remove();
        liteChartApiRef.current = null;
      }
    };
  }, [
    responseTab,
    currentBarsSnapshot,
    chartPdArrays,
    chartKeyLevels,
    position.entry,
    position.sl,
    position.tp,
  ]);

  // Computed symbol sets for filter tabs
  const favoriteSymbols = useMemo(() => {
    const fromMeta = Array.isArray(watchlist) ? watchlist : [];
    return [...new Set(fromMeta.map(normalizeWatchSymbol).filter(Boolean))];
  }, [watchlist]);

  const allSymbols = useMemo(() => {
    return [
      ...new Set(
        [...DEFAULT_WATCHLIST, ...favoriteSymbols]
          .map(normalizeWatchSymbol)
          .filter(Boolean),
      ),
    ];
  }, [favoriteSymbols]);

  const cryptoSymbols = useMemo(() => {
    const fromAll = allSymbols.filter((s) => classifySymbol(s) === "crypto");
    const merged = [
      ...new Set(
        [...DEFAULT_CRYPTO_SYMBOLS, ...fromAll]
          .map(normalizeWatchSymbol)
          .filter(Boolean),
      ),
    ];
    return merged.sort();
  }, [allSymbols]);

  const forexSymbols = useMemo(() => {
    const fromAll = allSymbols.filter((s) => classifySymbol(s) === "forex");
    const merged = [
      ...new Set(
        [...DEFAULT_FOREX_SYMBOLS, ...fromAll]
          .map(normalizeWatchSymbol)
          .filter(Boolean),
      ),
    ];
    return merged.sort();
  }, [allSymbols]);

  const commoditySymbols = useMemo(() => {
    const fromAll = allSymbols.filter((s) => classifySymbol(s) === "commodity");
    const merged = [
      ...new Set(
        [...DEFAULT_COMMODITY_SYMBOLS, ...fromAll]
          .map(normalizeWatchSymbol)
          .filter(Boolean),
      ),
    ];
    return merged.sort();
  }, [allSymbols]);

  const indicesSymbols = useMemo(() => {
    const fromAll = allSymbols.filter((s) => classifySymbol(s) === "indices");
    const merged = [
      ...new Set(
        [...DEFAULT_INDICES_SYMBOLS, ...fromAll]
          .map(normalizeWatchSymbol)
          .filter(Boolean),
      ),
    ];
    return merged.sort();
  }, [allSymbols]);

  const smtSymbols = useMemo(() => {
    return DEFAULT_SMT_SYMBOLS;
  }, []);

  const symbolsByTab = useMemo(() => {
    switch (symbolFilterTab) {
      case "FAVOURITE":
        return favoriteSymbols;
      case "CRYPTO":
        return cryptoSymbols;
      case "FOREX":
        return forexSymbols;
      case "COMMODITY":
        return commoditySymbols;
      case "INDICES":
        return indicesSymbols;
      case "SMT":
        // If an SMT group is "active" (via cfg.symbol), show only symbols from that specific group
        if (cfg.symbol) {
          const activeGroup = DEFAULT_SMT_GROUPS.find((g) =>
            g.symbols.includes(cfg.symbol),
          );
          if (activeGroup) return activeGroup.symbols;
        }
        return smtSymbols;
      case "ALL":
      default:
        return allSymbols;
    }
  }, [
    symbolFilterTab,
    favoriteSymbols,
    allSymbols,
    cryptoSymbols,
    forexSymbols,
    commoditySymbols,
    indicesSymbols,
    smtSymbols,
    cfg.symbol,
  ]);

  return (
    <section className="snapshot-builder-v2 snapshot-builder-v3 snapshot-builder-ai-v4">
      <section
        className="panel snapshot-col-v3 snapshot-col-symbols-v3"
        style={isSymbolPanelOpen ? {} : { display: "none" }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            height: "100%",
          }}
        >
          <div className="snapshot-symbol-row-inline-v4" style={{ gap: 6 }}>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setIsSymbolPanelOpen(false)}
              title="Collapse symbols panel"
              style={{
                width: 32,
                minWidth: 32,
                padding: "4px 0",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {"<<"}
            </button>
            <span className="minor-text" style={{ fontSize: 11 }}>
              {symbolsByTab.length} symbols
            </span>
          </div>
          {isSymbolPanelOpen && (
            <>
              <div className="snapshot-tabs-v2" style={{ flexWrap: "wrap" }}>
                {[
                  "FAVOURITE",
                  "ALL",
                  "CRYPTO",
                  "FOREX",
                  "COMMODITY",
                  "INDICES",
                  "SMT",
                ].map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    className={`secondary-button snapshot-tag-v2 ${symbolFilterTab === tab ? "active" : ""}`}
                    onClick={() => setSymbolFilterTab(tab)}
                  >
                    {tab === "FAVOURITE"
                      ? "Watchlist"
                      : tab === "ALL"
                        ? "All"
                        : tab === "CRYPTO"
                          ? "Crypto"
                          : tab === "FOREX"
                            ? "Forex"
                            : tab === "COMMODITY"
                              ? "Commodity"
                              : tab === "INDICES"
                                ? "Indices"
                                : "SMT"}
                  </button>
                ))}
              </div>
              <div className="snapshot-watchlist-v2">
                {(() => {
                  if (symbolFilterTab === "SMT") {
                    return (
                      <div
                        className="snapshot-tabs-v2"
                        style={{ flexWrap: "wrap" }}
                      >
                        {DEFAULT_SMT_GROUPS.map((group) => {
                          const isActive = group.symbols.every((s) =>
                            symbolsByTab.includes(s),
                          );
                          // Actually, we want to check if the current 'selection' matches this group.
                          // But cfg.symbol is single. For the UI 'selection' state in the grid:
                          const currentGroupActive = group.symbols.includes(
                            cfg.symbol,
                          );

                          return (
                            <button
                              key={group.name}
                              type="button"
                              className={`secondary-button snapshot-tag-v2 ${currentGroupActive ? "active" : ""}`}
                              onClick={() => {
                                // Select the first symbol to trigger the group-filtered grid
                                setCfgField("symbol", group.symbols[0]);
                              }}
                            >
                              {group.name}
                            </button>
                          );
                        })}
                      </div>
                    );
                  }

                  const query = String(searchTerm || "")
                    .trim()
                    .toUpperCase();
                  const filtered = symbolsByTab.filter((s) =>
                    s.toUpperCase().includes(query),
                  );
                  if (filtered.length === 0)
                    return (
                      <span className="minor-text">No matching symbols.</span>
                    );
                  return (
                    <div
                      className="snapshot-tabs-v2"
                      style={{ flexWrap: "wrap" }}
                    >
                      {filtered.map((s) => (
                        <span
                          key={s}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 2,
                          }}
                        >
                          <button
                            type="button"
                            className={`secondary-button snapshot-tag-v2 ${normalizeWatchSymbol(cfg.symbol) === s ? "active" : ""}`}
                            onClick={() =>
                              setCfgField(
                                "symbol",
                                normalizeWatchSymbol(cfg.symbol) === s ? "" : s,
                              )
                            }
                          >
                            {s}
                          </button>
                          {symbolFilterTab === "FAVOURITE" ? (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{
                                width: 18,
                                height: 18,
                                padding: 0,
                                fontSize: 10,
                                lineHeight: 1,
                                minWidth: 18,
                                borderRadius: 4,
                                color: "rgba(239,68,68,0.5)",
                                borderColor: "rgba(239,68,68,0.25)",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromWatchlist(s);
                              }}
                              title={"Remove " + s + " from watchlist"}
                            >
                              -
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="secondary-button"
                              style={{
                                width: 18,
                                height: 18,
                                padding: 0,
                                fontSize: 10,
                                lineHeight: 1,
                                minWidth: 18,
                                borderRadius: 4,
                                color: "var(--muted)",
                                borderColor: "rgba(255,255,255,0.08)",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                const next = [...new Set([...watchlist, s])];
                                saveWatchlistToDb(next).then(() =>
                                  setWatchlist(next),
                                );
                              }}
                              title={"Add " + s + " to watchlist"}
                            >
                              +
                            </button>
                          )}
                        </span>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </>
          )}
          <div
            className="snapshot-live-card-v3"
            style={{
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              marginTop: "auto",
            }}
          >
            <div
              className="snapshot-gallery-head-v2"
              style={{ marginBottom: 6 }}
            >
              <span className="panel-label" style={{ margin: 0 }}>
                Related Pending / Filled / New
              </span>
            </div>
            <div
              className="snapshot-activity-list-v4"
              style={{ flex: 1, overflowY: "auto" }}
            >
              {symbolActivity.loading ? (
                <div className="minor-text">Loading...</div>
              ) : null}
              {!symbolActivity.loading && symbolActivity.items.length === 0 ? (
                <div className="minor-text">No related trades/signals.</div>
              ) : null}
              {!symbolActivity.loading &&
                symbolActivity.items.map((x) => (
                  <article
                    key={`${x.kind}_${x.id}`}
                    className="snapshot-activity-card-v4"
                  >
                    <div className="snapshot-activity-top-v4">
                      <span
                        className={`side-badge ${x.side === "SELL" ? "side-sell" : "side-buy"}`}
                      >
                        {x.side === "SELL" ? "S" : "B"}
                      </span>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "baseline",
                          gap: 6,
                          minWidth: 0,
                        }}
                      >
                        <span
                          className="mini-name"
                          style={{
                            margin: 0,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {x.symbol || "-"}
                        </span>
                        <span
                          className="minor-text"
                          style={{
                            fontSize: 10,
                            textTransform: "lowercase",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {x.type}
                        </span>
                      </div>
                      <span
                        className={`badge ${x.status === "OPEN" ? "FILLED" : x.status}`}
                      >
                        {x.status === "OPEN" ? "FILLED" : x.status}
                      </span>
                    </div>
                    <div className="minor-text" style={{ paddingLeft: 24 }}>
                      {x.entry ?? "-"} → {x.tp ?? "-"} / {x.sl ?? "-"}
                    </div>
                  </article>
                ))}
            </div>
          </div>
        </div>
      </section>

      <section
        className="panel snapshot-col-v3 snapshot-col-settings-v3"
        style={isSymbolPanelOpen ? {} : { gridColumn: "1 / -1" }}
      >
        {cfg.symbol && (
          <div
            className="snapshot-control-card-v3 toolbar-panel"
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginBottom: 12,
              padding: "12px 16px",
              alignItems: "flex-start",
            }}
          >
            {/* Row 1 */}
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
                width: "100%",
                justifyContent: "flex-start",
              }}
            >
              {hasResponse && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={resetAnalyzeSession}
                >
                  {"<"} Back
                </button>
              )}

              {cfg.symbol && (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setCfgField("symbol", "")}
                  style={{ fontSize: 12, padding: "4px 8px" }}
                >
                  {"<"}
                </button>
              )}

              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <select
                  className="secondary-button"
                  style={{
                    height: "34px",
                    padding: "0 10px",
                    fontSize: "12px",
                  }}
                  value={templateId}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                >
                  <option value="">New Template</option>
                  <option value={DEFAULT_TEMPLATE_ID}>Default Template</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>

                <select
                  className="secondary-button"
                  style={{
                    height: "34px",
                    padding: "0 10px",
                    fontSize: "12px",
                  }}
                  value={cfg.profile || "day"}
                  onChange={(e) => setProfilePreset(e.target.value)}
                >
                  {Object.entries(PROFILE_PRESETS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div
                className="v-sep-v3"
                style={{
                  height: 20,
                  width: 1,
                  background: "var(--border)",
                  margin: "0 4px",
                }}
              />

              <button
                type="button"
                className="secondary-button"
                onClick={() => setSettingsModalOpen(true)}
              >
                Settings
              </button>

              {(marketMetadata.updated_time || autoFlow.runId) && (
                <div
                  style={{
                    marginLeft: "auto",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    background: "rgba(255,255,255,0.03)",
                    padding: "4px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    flexWrap: "wrap",
                    maxWidth: 360,
                  }}
                >
                  <div
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--accent)",
                      boxShadow: "0 0 6px var(--accent)",
                    }}
                  />
                  <span
                    className="minor-text"
                    style={{ fontSize: 11, fontWeight: 500 }}
                  >
                    {marketMetadata.updated_time
                      ? showDateTime(marketMetadata.updated_time)
                      : "refreshing..."}
                  </span>
                  <span
                    className={`minor-text ${autoFlow.context === "failed" || autoFlow.snapshots === "failed" || autoFlow.analysis === "failed" ? "msg-error" : autoFlow.context === "loading" || autoFlow.snapshots === "loading" || autoFlow.analysis === "loading" ? "msg-warning" : "msg-success"}`}
                    style={{ fontSize: 11 }}
                  >
                    {flowChipText}
                  </span>
                </div>
              )}
            </div>

            {/* Row 2 */}
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                width: "100%",
                justifyContent: "flex-start",
                flexWrap: "wrap",
              }}
            >
              <select
                value={analysisSource}
                onChange={(e) => setAnalysisSource(e.target.value)}
                className="secondary-button"
                style={{ padding: "0 10px", height: 34, fontSize: "12px" }}
              >
                <option value="ai_claude">Claude 3.5 Sonnet</option>
                <option value="ai_gpt4o">GPT-4o</option>
                <option value="ai_deepseek">DeepSeek V3</option>
                <option value="ai_gemini">Gemini 1.5 Pro</option>
              </select>

              <button
                className="secondary-button"
                type="button"
                onClick={captureSnapshots}
                disabled={capturing}
              >
                {capturing
                  ? "Snapshots..."
                  : warmupGate.locked
                    ? "Warming..."
                    : "Snapshots"}
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={analyzeSelected}
                disabled={analyzing || warmupGate.locked}
              >
                {analyzing
                  ? "Analyzing..."
                  : warmupGate.locked
                    ? "Warming..."
                    : "Analyze"}
              </button>

              {status.text && (
                <span
                  className={`minor-text ${status.type === "error" ? "msg-error" : status.type === "warning" ? "msg-warning" : "msg-success"}`}
                  style={{ marginLeft: 8, fontSize: "13px" }}
                >
                  {status.text}
                </span>
              )}
            </div>
          </div>
        )}

        {!hasResponse && !cfg.symbol && (
          <div className="fadeIn">
            <div
              className="toolbar-panel"
              style={{
                marginBottom: 12,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flex: 1,
                }}
              >
                {!isSymbolPanelOpen && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => setIsSymbolPanelOpen(true)}
                    title="Expand symbols panel"
                    style={{
                      width: 28,
                      height: 28,
                      padding: 0,
                      fontSize: 12,
                      fontWeight: 700,
                    }}
                  >
                    {">>"}
                  </button>
                )}
                <select
                  className="secondary-button"
                  value={symbolFilterTab}
                  onChange={(e) => {
                    setSymbolFilterTab(e.target.value);
                    setVisibleCount(8);
                  }}
                  style={{ padding: "6px 8px", fontSize: 12, height: 34 }}
                >
                  <option value="FAVOURITE">Watchlist</option>
                  <option value="ALL">All</option>
                  <option value="CRYPTO">Crypto</option>
                  <option value="FOREX">Forex</option>
                  <option value="COMMODITY">Commodity</option>
                  <option value="INDICES">Indices</option>
                  <option value="SMT">SMT</option>
                </select>
                <div
                  style={{
                    position: "relative",
                    flex: 1,
                    maxWidth: 320,
                    display: "flex",
                    gap: 4,
                  }}
                >
                  <input
                    list="tv-symbol-options"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && searchTerm.trim()) {
                        setCfgField(
                          "symbol",
                          normalizeWatchSymbol(searchTerm.trim()),
                        );
                      }
                    }}
                    placeholder="Search symbol..."
                    style={{ flex: 1, padding: "6px 10px", fontSize: 13 }}
                  />
                  <button
                    className="secondary-button"
                    type="button"
                    style={{
                      width: 28,
                      minWidth: 28,
                      padding: "4px 0",
                      fontSize: 14,
                    }}
                    onClick={() => {
                      if (searchTerm.trim()) {
                        const s = normalizeWatchSymbol(searchTerm.trim());
                        setCfgField("symbol", s);
                        const next = [...new Set([...watchlist, s])];
                        saveWatchlistToDb(next).then(() => setWatchlist(next));
                      }
                    }}
                    title="Add current symbol"
                  >
                    +
                  </button>
                  <datalist id="tv-symbol-options">
                    {[
                      ...new Set([...symbolSelectOptions, ...apiSymbolOptions]),
                    ].map((opt) => (
                      <option key={opt} value={opt} />
                    ))}
                  </datalist>
                </div>
                <div className="tf-pills">
                  {["1m", "5m", "15m", "1h", "4h", "D"].map((tf) => (
                    <button
                      key={tf}
                      className={`tf-pill ${browserTfs.includes(tf) ? "active" : ""}`}
                      onClick={() => {
                        setBrowserTfs((prev) => {
                          if (prev.includes(tf)) {
                            if (prev.length <= 1) return prev;
                            return prev.filter((t) => t !== tf);
                          }
                          return [...prev, tf];
                        });
                        setBrowserTf(tf);
                      }}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div
              className="browser-grid-v1"
              style={{
                gridTemplateColumns:
                  symbolFilterTab === "SMT"
                    ? "1fr"
                    : browserTfs.length === 1
                      ? "repeat(4, 1fr)"
                      : browserTfs.length === 2
                        ? "repeat(2, 1fr)"
                        : "1fr",
              }}
            >
              {symbolFilterTab === "SMT"
                ? DEFAULT_SMT_GROUPS.map((group) => (
                    <div
                      key={group.name}
                      style={{
                        marginBottom: 24,
                        padding: 12,
                        background: "rgba(255,255,255,0.02)",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: 800,
                          marginBottom: 12,
                          color: "var(--muted)",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                        }}
                      >
                        SMT Group: {group.name}
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            browserTfs.length === 1
                              ? "repeat(2, 1fr)"
                              : "repeat(2, 1fr)",
                          gap: 12,
                        }}
                      >
                        {group.symbols.map((sym) => (
                          <SymbolChart
                            key={sym}
                            symbol={sym}
                            timeframes={browserTfs}
                            defaultMode="live"
                            onAnalyze={(s) => setCfgField("symbol", s)}
                            onRemove={null}
                          />
                        ))}
                      </div>
                    </div>
                  ))
                : symbolsByTab
                    .slice(0, visibleCount)
                    .map((sym) => (
                      <SymbolChart
                        key={sym}
                        symbol={sym}
                        timeframes={browserTfs}
                        defaultMode="live"
                        onAnalyze={(s) => setCfgField("symbol", s)}
                        onRemove={(s) => removeFromWatchlist(s)}
                      />
                    ))}
            </div>{" "}
          </div>
        )}

        {!hasResponse && cfg.symbol && (
          <div style={{ marginBottom: 20 }}>
            <SymbolChart
              symbol={cfg.symbol}
              timeframes={widgetTfs}
              defaultMode="live"
              onAnalyze={() => handleAnalyze()}
              onRemove={null}
            />
          </div>
        )}

        {cfg.symbol && (
          <SignalDetailCard
            mode="ai"
            hideTabsBeforeResponse={true}
            chart={{
              enabled: true,
              symbol: cfg.symbol,
              interval: timeframe,
              entryPrice: position.entry,
              slPrice: position.sl,
              tpPrice: position.tp,
              detailTfTab: timeframe,
              profileTfs: [
                ...(PROFILE_PRESETS[cfg.profile]?.htf_tfs || []),
                ...(PROFILE_PRESETS[cfg.profile]?.exec_tfs || []),
                ...(PROFILE_PRESETS[cfg.profile]?.conf_tfs || []),
              ],
              onDetailTfTabChange: setSelectedEntryTf,
              entryNode: (
                <div className="snapshot-live-card-v3">
                  <div className="minor-text" style={{ marginBottom: 12 }}>
                    Chart ({timeframe}): Twelve + PD Arrays
                  </div>
                  <TradeSignalChart
                    symbol={cfg.symbol}
                    interval={timeframe}
                    analysisSnapshot={effectiveParsed}
                    entryPrice={position.entry}
                    slPrice={position.sl}
                    tpPrice={position.tp}
                  />
                  <div className="minor-text" style={{ marginTop: 8 }}>
                    {barsLoading
                      ? "Loading bars..."
                      : currentBarsSnapshot?.normalized_symbol ||
                        currentBarsSnapshot?.symbol ||
                        "No bars cache yet"}
                  </div>
                </div>
              ),
            }}
            response={{
              enabled: true,
              hasData: hasResponse,
              label: "Response",
              tab: responseTab,
              onTabChange: setResponseTab,
              text: responseText,
              raw: effectiveParsed || analysisRaw || analysisJson,
              bars: JSON.stringify(
                currentBarsSnapshot || { status: "no_cached_bars" },
                null,
                2,
              ),
              tradePlans: analysisTradePlans,
              snapshotFiles: chartFiles,
            }}
            tradePlan={{
              enabled: true,
              signalId: null,
              tradeId: null,
              value: position,
              onChange: updatePositionField,
              onAddSignal: (pos, planId = "main") =>
                addBySelection("signal", pos, planId),
              onAddTrade: (pos, planId = "main") =>
                addBySelection("trade", pos, planId),
              showSaveButton: false,
              showAddSignalButton: true,
              showAddTradeButton: true,
              showResetButton: true,
              onReset: resetPositionLocal,
              busy: {
                signal: addingSignal && submittingPlanId === "main",
                trade: addingSignal && submittingPlanId === "main",
              },
              submittingPlanId: submittingPlanId,
              disabled: false,
              error: !canAddSignal ? validatePosition(position) : "",
              successMessage:
                actionStatus.action === "add" &&
                actionStatus.text &&
                actionStatus.type !== "error" &&
                actionStatus.type !== "warning"
                  ? actionStatus.text
                  : "",
            }}
          />
        )}
        {actionStatus.action === "add" &&
        actionStatus.text &&
        (actionStatus.type === "error" || actionStatus.type === "warning") ? (
          <span
            className={`minor-text snapshot-footer-msg-v3 ${actionStatus.type === "error" ? "msg-error" : "msg-warning"}`}
          >
            {actionStatus.text}
          </span>
        ) : null}
      </section>

      {settingsModalOpen ? (
        <div
          className="snapshot-modal-backdrop-v4"
          onClick={() => setSettingsModalOpen(false)}
        >
          <div
            className="snapshot-modal-panel-v4"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="snapshot-modal-head-v4"
              style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}
            >
              <div className="snapshot-tabs-v2" style={{ margin: 0 }}>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "settings" ? "active" : ""}`}
                  onClick={() => setSettingsTab("settings")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Settings
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "prompt" ? "active" : ""}`}
                  onClick={() => setSettingsTab("prompt")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Prompt
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "json" ? "active" : ""}`}
                  onClick={() => setSettingsTab("json")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  JSON
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "schema" ? "active" : ""}`}
                  onClick={() => setSettingsTab("schema")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Schema
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "guide" ? "active" : ""}`}
                  onClick={() => setSettingsTab("guide")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Guide
                </button>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 4,
                  alignItems: "center",
                  flexWrap: "wrap",
                  marginLeft: "auto",
                }}
              >
                <select
                  className="secondary-button"
                  value={templateId}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                  style={{ height: 28, padding: "0 6px", fontSize: 11 }}
                >
                  <option value="">New</option>
                  <option value={DEFAULT_TEMPLATE_ID}>Default</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Name"
                  style={{
                    width: 100,
                    height: 28,
                    padding: "0 6px",
                    fontSize: 11,
                  }}
                />
                <button
                  className="primary-button"
                  type="button"
                  onClick={saveTemplate}
                  style={{ height: 28, fontSize: 11, padding: "0 8px" }}
                >
                  Save
                </button>
                {templateId && templateId !== DEFAULT_TEMPLATE_ID && (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={deleteTemplate}
                    style={{
                      color: "var(--bearish)",
                      height: 28,
                      fontSize: 11,
                      padding: "0 6px",
                    }}
                  >
                    Del
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setSettingsModalOpen(false)}
                  style={{
                    height: 28,
                    fontSize: 12,
                    padding: "0 6px",
                    color: "var(--muted)",
                    borderColor: "var(--border)",
                  }}
                >
                  X
                </button>
              </div>
            </div>
            {settingsTabContentNode}
          </div>
        </div>
      ) : null}

      {null}
    </section>
  );
}
