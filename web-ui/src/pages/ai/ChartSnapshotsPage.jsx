import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { createChart } from "lightweight-charts";
import { NotificationHub } from "../../services/NotificationHub";
import {
  showDateTime,
  isSameDay,
  asNumValue,
  formatNumValue,
} from "../../utils/format";

import { api } from "../../api";
import { showToast } from "../../components/ToastContainer";
import TradeSignalChart from "../../components/TradeSignalChart";
import { chartFetchManager } from "../../services/chartFetchManager";

const SignalDetailCard = lazy(
  () => import("../../components/SignalDetailCard"),
);
const SymbolChart = lazy(() => import("../../components/charts/SymbolChart"));
import {
  STRATEGY_OPTIONS,
  STRATEGY_ENTRY_MODELS,
  PROFILE_PRESETS,
  DEFAULT_CONFIG,
  GUIDE_SYSTEM,
  GUIDE_USER_DEFAULT,
  SCHEMA_SYSTEM,
  SCHEMA_USER_DEFAULT,
  getEffectiveTfConfig,
  buildPrompt,
  buildJsonConfig,
  buildSchemaString,
} from "./AiPromptBuilder";
import RESPONSE_MAPPING_RAW from "../../../../shared/response_mapping.json";
import {
  SymbolEntryCell,
  StatusPnlCell,
} from "../../components/TradeSignalListCells";

const STORAGE_KEY = "chart_prompt_builder_templates_v2";

const DEFAULT_TEMPLATE_ID = "__default__";

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

function normalizeTemplateConfig(raw) {
  const source =
    raw?.config && typeof raw.config === "object" ? raw.config : raw || {};
  const strategyValue = raw?.strategies ||
    source?.strategies ||
    source?.strategy || ["ICT"];
  const strategies = Array.isArray(strategyValue)
    ? strategyValue
    : [String(strategyValue || "ICT")];
  const profileRaw = String(raw?.profile || "")
    .trim()
    .toLowerCase();
  const normalizedRaw = {
    ...source,
    strategies,
  };
  const profileFromSource = String(normalizedRaw?.profile || "")
    .trim()
    .toLowerCase();
  const profile = PROFILE_PRESETS[profileRaw]
    ? profileRaw
    : PROFILE_PRESETS[profileFromSource]
      ? profileFromSource
      : DEFAULT_CONFIG.profile;
  const preset = PROFILE_PRESETS[profile] || PROFILE_PRESETS.day;
  return {
    ...DEFAULT_CONFIG,
    ...normalizedRaw,
    min_trades: String(normalizedRaw?.min_trades ?? DEFAULT_CONFIG.min_trades),
    max_trades: String(normalizedRaw?.max_trades ?? DEFAULT_CONFIG.max_trades),
    narrative_language:
      normalizedRaw?.narrative_language ||
      normalizedRaw?.language ||
      DEFAULT_CONFIG.narrative_language,
    symbols: Array.isArray(normalizedRaw?.symbols)
      ? normalizedRaw.symbols
          .map((x) => normalizeWatchSymbol(x))
          .filter(Boolean)
      : normalizedRaw?.symbol
        ? [normalizeWatchSymbol(normalizedRaw.symbol)]
        : [],
    profile,
    htf_tfs:
      Array.isArray(normalizedRaw?.htf_tfs) && normalizedRaw.htf_tfs.length
        ? normalizedRaw.htf_tfs
        : [...preset.htf_tfs],
    exec_tfs:
      Array.isArray(normalizedRaw?.exec_tfs) && normalizedRaw.exec_tfs.length
        ? normalizedRaw.exec_tfs
        : [...preset.exec_tfs],
    conf_tfs:
      Array.isArray(normalizedRaw?.conf_tfs) && normalizedRaw.conf_tfs.length
        ? normalizedRaw.conf_tfs
        : [...preset.conf_tfs],
    strategies: [
      ...new Set(strategies.map((x) => String(x || "").trim()).filter(Boolean)),
    ],
  };
}

function loadTemplates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return dedupeTemplates(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

function normalizeTemplateRecord(raw = {}, fallbackId = "") {
  const name = String(
    raw?.name ||
      raw?.template_id ||
      raw?.id ||
      fallbackId ||
      "Unnamed Template",
  ).trim();
  const id = String(
    raw?.id || raw?.template_id || raw?.name || fallbackId || name,
  ).trim();
  return {
    ...raw,
    id: id || name,
    name: name || id || "Unnamed Template",
    config: normalizeTemplateConfig(raw?.config || {}),
    analysis_instructions:
      raw?.analysis_instructions ||
      raw?.config?.analysis_instructions ||
      raw?._guide ||
      "",
    schema_additions:
      raw?.schema_additions || raw?.config?.schema_additions || "{}",
    saved:
      raw?.saved ||
      raw?.updated_at ||
      raw?.created_at ||
      new Date().toISOString(),
  };
}

function buildTemplateConfigPayload(cfg, guideText, schemaText) {
  const normalized = normalizeTemplateConfig(cfg);
  const { strategies, ...configOnly } = normalized;
  return {
    config: configOnly,
    strategies: Array.isArray(strategies) ? strategies : [],
    analysis_instructions: guideText || "",
    schema_additions: schemaText || "{}",
  };
}

function dedupeTemplates(rows = []) {
  const map = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const item = normalizeTemplateRecord(raw);
    const key = String(item.id || item.name || "").trim();
    if (!key) continue;
    map.set(key, item);
  }
  return Array.from(map.values());
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
  const primaryCandidates = [
    Array.isArray(plan?.partial_tps) && plan.partial_tps[0]
      ? (plan.partial_tps[0].price ?? plan.partial_tps[0])
      : null,
    Array.isArray(plan?.take_profits) && plan.take_profits[0]
      ? (plan.take_profits[0].price ?? plan.take_profits[0])
      : null,
    Array.isArray(plan?.tps) && plan.tps[0]
      ? (plan.tps[0].price ?? plan.tps[0])
      : null,
    plan?.tp1,
    plan?.tp,
  ];
  for (const candidate of primaryCandidates) {
    const value =
      candidate && typeof candidate === "object" ? candidate.price : candidate;
    const n = parseNum(value);
    if (Number.isFinite(n)) return n;
  }
  // Fallback: choose first valid TP-like value from any available list.
  for (const candidate of getPlanTpCandidates(plan)) {
    const n = parseNum(
      candidate && typeof candidate === "object" ? candidate.price : candidate,
    );
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function confidenceLevelToPct(level) {
  const v = String(level || "")
    .trim()
    .toLowerCase();
  if (v === "high") return 80;
  if (v === "normal") return 60;
  if (v === "low") return 40;
  return null;
}

function planTakeProfitsRaw(plan = {}) {
  const list = Array.isArray(plan?.take_profits) ? [...plan.take_profits] : [];
  if (!list.length) {
    const mx = plan?.multiple_exits || {};
    if (mx?.tp2) list.push(mx.tp2);
    if (mx?.full_tp) list.push(mx.full_tp);
  }
  return list;
}

function planTakeProfitValue(tpLike) {
  if (tpLike && typeof tpLike === "object") return tpLike.price ?? null;
  return tpLike ?? null;
}

function planPartialTps(plan = {}) {
  const fromTakeProfits = planTakeProfitsRaw(plan).map((t) => ({
    price: t?.price ?? null,
    size_pct: t?.close_position_pct ?? null,
    rr: t?.reward_to_risk ?? null,
  }));
  if (fromTakeProfits.length) return fromTakeProfits;
  const mx = plan?.multiple_exits || {};
  return ["break_even", "tp2", "full_tp"]
    .filter((k) => mx && typeof mx[k] === "object")
    .map((k) => ({
      price: mx[k]?.price ?? null,
      size_pct: mx[k]?.position_pct ?? null,
      rr: mx[k]?.risk_reward ?? null,
    }));
}

function planDecisionText(plan = {}) {
  const decision =
    plan?.trade_decision || plan?.position_management?.trade_decision || "";
  return decision === "Proceed" ? "" : String(decision || "");
}

function planSkipReasons(plan = {}) {
  if (Array.isArray(plan?.skip_reasons)) {
    return plan.skip_reasons.map((r) => ({
      reason: r?.reason || "",
      severity: r?.severity || "",
    }));
  }
  const text = String(plan?.position_management?.skips_reasons || "").trim();
  return text ? [{ reason: text, severity: "" }] : [];
}

function normalizeAnalysisContract(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return parsed;
  const out = { ...parsed };
  if (
    !out.ai_full_analysis &&
    Array.isArray(out.trade_plan) &&
    !out.market_analysis
  ) {
    out.trade_plan = out.trade_plan.map((x) => ({
      direction: x?.direction || x?.dir || "",
      profile: x?.profile || "",
      type: x?.order_type || x?.type || "",
      session_entry: x?.session || "",
      strategy: x?.strategy || "",
      entry_model: x?.entry_model || "",
      entry: x?.entry_price ?? x?.entry ?? null,
      sl: x?.stop_loss ?? x?.sl ?? null,
      be_trigger: x?.breakeven_trigger ?? x?.be ?? null,
      tp:
        planTakeProfitValue(planTakeProfitsRaw(x)[2]) ??
        planTakeProfitValue(
          planTakeProfitsRaw(x)[planTakeProfitsRaw(x).length - 1],
        ) ??
        x?.take_profit ??
        x?.multiple_exits?.full_tp?.price ??
        x?.tp3 ??
        x?.tp1 ??
        x?.tp ??
        null,
      tp2:
        planTakeProfitValue(planTakeProfitsRaw(x)[1]) ??
        x?.multiple_exits?.tp2?.price ??
        x?.tp2 ??
        null,
      tp3:
        planTakeProfitValue(planTakeProfitsRaw(x)[2]) ??
        x?.multiple_exits?.full_tp?.price ??
        x?.tp3 ??
        null,
      estimated_bars: x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
      rr: x?.risk_reward ?? x?.rr ?? null,
      risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
      partial_tps: planPartialTps(x),
      confidence_pct:
        x?.confidence_pct ?? confidenceLevelToPct(x?.confidence_level),
      skip_recommendation: planDecisionText(x),
      reasons_to_skip: planSkipReasons(x),
      entry_condition:
        x?.entry_trigger || x?.position_management?.entry_trigger || "",
      exit_condition:
        x?.mid_trade_invalidation ||
        x?.position_management?.mid_trade_invalidation ||
        "",
      invalidation:
        x?.pre_entry_invalidation ||
        x?.position_management?.pre_entry_invalidation ||
        "",
      note: x?.note || "",
    }));
    return out;
  }
  if (out.ai_full_analysis && typeof out.ai_full_analysis === "object") {
    const a = out.ai_full_analysis;
    const htfTfs = Array.isArray(a.htf_context) ? a.htf_context : [];
    const ltfTfs = Array.isArray(a.ltf_analysis) ? a.ltf_analysis : [];
    const allTfs = [...htfTfs, ...ltfTfs];
    const pdArrays = ltfTfs.flatMap((t) =>
      Array.isArray(t.pd_arrays)
        ? t.pd_arrays.map((p) => ({ ...p, timeframe: t.timeframe }))
        : [],
    );
    const keyLevels = ltfTfs.flatMap((t) =>
      Array.isArray(t.key_levels) ? t.key_levels : [],
    );
    const htfZones = htfTfs.flatMap((t) =>
      Array.isArray(t.reference_zones)
        ? t.reference_zones.map((z) => ({
            ...z,
            name: `HTF_${z.type}_${z.id || ""}`,
            zone_type: z.type,
          }))
        : [],
    );
    const allKeyLevels = [...keyLevels, ...htfZones];
    const dol =
      htfTfs.find((t) => t.draw_on_liquidity?.target_price)
        ?.draw_on_liquidity || null;
    out.market_analysis = {
      timeframes: allTfs.map((t) => ({
        tf: t.timeframe || "",
        trend: t.trend || "",
        structure: t.structure || "",
        market_phase: t.phase || "",
        bias: t.bias || "",
        poi_alignment: Boolean(t.poi_aligned),
        price_action_summary: {
          recent_move: t.what_price_just_did || "",
          key_breaks: (Array.isArray(t.key_events) ? t.key_events : []).map(
            (e) => ({
              event: e.event || "",
              price_level: e.price,
              direction:
                e.direction === "Bull"
                  ? "Bullish"
                  : e.direction === "Bear"
                    ? "Bearish"
                    : e.direction || "",
            }),
          ),
        },
        price_prediction: {
          narrative: t.what_price_likely_does_next || "",
          expected_path: (Array.isArray(t.expected_path)
            ? t.expected_path
            : []
          ).map((p) => ({
            step: p.step,
            action: p.action || "",
            target_price: p.target_price,
            condition: p.required_condition || "",
          })),
        },
      })),
      pd_arrays: pdArrays.map((p) => ({
        id: p.id,
        type: p.type || "",
        direction:
          p.direction === "Bull"
            ? "Bullish"
            : p.direction === "Bear"
              ? "Bearish"
              : p.direction || "",
        strength: p.strength || "",
        price_top: p.zone_top,
        price_bottom: p.zone_bottom,
        status: p.status || "",
        touched: p.times_touched || 0,
        timeframe: p.timeframe || "",
        note: p.note || "",
      })),
      key_levels: allKeyLevels.map((k) => ({
        name: k.name || "",
        price: k.price,
        type: k.zone_type || k.type || "",
        swept: Boolean(k.already_swept),
      })),
      institutional_filters: {
        draw_on_liquidity: {
          target: dol?.narrative || "",
          price: dol?.target_price,
          type: dol?.target_type || "",
        },
      },
      confluence_checklist: {
        buy: {
          items: (Array.isArray(a.confluence_checklist?.buy?.passed_items)
            ? a.confluence_checklist.buy.passed_items
            : []
          ).map((c) => ({
            category: c.category || "",
            item: c.description || "",
            weight: c.weight || "",
            checked: true,
            pd_array_ref: c.linked_array_id || null,
          })),
          score: a.confluence_checklist?.buy?.weighted_score ?? 0,
          total: 100,
          high_weight_passed:
            a.confluence_checklist?.buy?.high_weight_passed ?? 0,
          high_weight_total:
            a.confluence_checklist?.buy?.high_weight_total ?? 0,
        },
        sell: {
          items: (Array.isArray(a.confluence_checklist?.sell?.passed_items)
            ? a.confluence_checklist.sell.passed_items
            : []
          ).map((c) => ({
            category: c.category || "",
            item: c.description || "",
            weight: c.weight || "",
            checked: true,
            pd_array_ref: c.linked_array_id || null,
          })),
          score: a.confluence_checklist?.sell?.weighted_score ?? 0,
          total: 100,
          high_weight_passed:
            a.confluence_checklist?.sell?.high_weight_passed ?? 0,
          high_weight_total:
            a.confluence_checklist?.sell?.high_weight_total ?? 0,
        },
      },
    };
    if (!out.trade_plan && Array.isArray(out.tradePlan)) {
      out.trade_plan = out.tradePlan;
    }
    if (Array.isArray(out.trade_plan)) {
      out.trade_plan = out.trade_plan.map((x) => ({
        direction: x?.direction || x?.dir || "",
        profile: x?.profile || "",
        type: x?.order_type || x?.type || "",
        session_entry: x?.session || "",
        strategy: x?.strategy || "",
        entry_model: x?.entry_model || "",
        entry: x?.entry_price ?? x?.entry ?? null,
        sl: x?.stop_loss ?? x?.sl ?? null,
        be_trigger: x?.breakeven_trigger ?? x?.be ?? null,
        tp:
          planTakeProfitValue(planTakeProfitsRaw(x)[2]) ??
          planTakeProfitValue(
            planTakeProfitsRaw(x)[planTakeProfitsRaw(x).length - 1],
          ) ??
          x?.take_profit ??
          x?.multiple_exits?.full_tp?.price ??
          x?.tp3 ??
          x?.tp ??
          null,
        tp2:
          planTakeProfitValue(planTakeProfitsRaw(x)[1]) ??
          x?.multiple_exits?.tp2?.price ??
          x?.tp2 ??
          null,
        tp3:
          planTakeProfitValue(planTakeProfitsRaw(x)[2]) ??
          x?.multiple_exits?.full_tp?.price ??
          x?.tp3 ??
          null,
        estimated_bars:
          x?.estimated_candles_to_tp1 ?? x?.estimated_bars ?? null,
        risk_pct: x?.risk_percent ?? x?.risk_pct ?? null,
        rr: x?.risk_reward ?? x?.rr ?? null,
        partial_tps: planPartialTps(x),
        confluence_checklist: Array.isArray(x?.confluence_checklist)
          ? x.confluence_checklist
          : [],
        reasons_to_skip: planSkipReasons(x),
        skip_recommendation: planDecisionText(x),
        entry_condition:
          x?.entry_trigger || x?.position_management?.entry_trigger || "",
        exit_condition:
          x?.mid_trade_invalidation ||
          x?.position_management?.mid_trade_invalidation ||
          "",
        risk_management:
          x?.grade === "A" ? "normal" : x?.grade === "B" ? "low" : "high",
        invalidation:
          x?.pre_entry_invalidation ||
          x?.position_management?.pre_entry_invalidation ||
          "",
        confidence_pct:
          x?.confidence_pct ??
          x?.confluence_score ??
          confidenceLevelToPct(x?.confidence_level),
        note: x?.note || "",
      }));
    }
    delete out.ai_full_analysis;
    return out;
  }
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
  if (!out.trade_plan && out.tradePlan) {
    const tradePlans = Array.isArray(out.tradePlan)
      ? out.tradePlan
      : out.tradePlan && typeof out.tradePlan === "object"
        ? [out.tradePlan]
        : [];
    out.trade_plan = tradePlans.map((x) => ({
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
  if (model.includes("gpt") || model.includes("openai")) return "ai_gpt4o";
  if (model.includes("gemini")) return "ai_gemini";
  if (model.includes("deepseek")) return "ai_deepseek";
  if (model.includes("openrouter") || model.includes("open-router"))
    return "ai_openrouter";
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
  const entry = parseNum(
    plan.entry ?? plan.entry_price ?? parsed?.entry ?? parsed?.price,
  );
  const sl = parseNum(plan.sl ?? plan.stop_loss ?? parsed?.sl);
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
      String(plan.type || plan.order_type || parsed?.type || "limit")
        .trim()
        .toLowerCase() || "limit",
    note: String(
      plan.note || parsed?.invalidation || parsed?.note || "",
    ).trim(),
    tp2: Number.isFinite(parseNum(plan?.tp2))
      ? formatNum3(parseNum(plan?.tp2))
      : "",
    tp3: Number.isFinite(parseNum(plan?.tp3))
      ? formatNum3(parseNum(plan?.tp3))
      : "",
    be_trigger: Number.isFinite(parseNum(plan?.be_trigger ?? plan?.be))
      ? formatNum3(parseNum(plan?.be_trigger ?? plan?.be))
      : "",
    confidence_pct: Number.isFinite(parseNum(plan?.confidence_pct))
      ? parseNum(plan?.confidence_pct)
      : "",
    risk_pct: Number.isFinite(parseNum(plan?.risk_pct))
      ? parseNum(plan?.risk_pct)
      : "",
    estimated_bars: Number.isFinite(parseNum(plan?.estimated_bars))
      ? parseNum(plan?.estimated_bars)
      : "",
    invalidation: String(
      plan?.invalidation || parsed?.invalidation || "",
    ).trim(),
    entry_model: String(plan?.entry_model || parsed?.entry_model || "").trim(),
    strategy: String(plan?.strategy || parsed?.strategy || "").trim(),
    profile: String(plan?.profile || parsed?.profile || "").trim(),
    entry_condition: String(plan?.entry_condition || "").trim(),
    exit_condition: String(plan?.exit_condition || "").trim(),
    skip_recommendation: String(
      plan?.skip_recommendation ||
        plan?.position_management?.trade_decision ||
        "",
    ).trim(),
    risk_management: String(plan?.risk_management || "").trim(),
    confluence_checklist: Array.isArray(plan?.confluence_checklist)
      ? plan.confluence_checklist
      : [],
    partial_tps: Array.isArray(plan?.partial_tps) ? plan.partial_tps : [],
  };
}

function hasRequiredPlanLevels(parsed) {
  const plans = Array.isArray(parsed?.trade_plan)
    ? parsed.trade_plan
    : parsed?.trade_plan && typeof parsed.trade_plan === "object"
      ? [parsed.trade_plan]
      : [];
  if (!plans.length) return false;
  return plans.some((p) => {
    const entry = parseNum(p?.entry);
    const sl = parseNum(p?.sl);
    const tp = getPlanPrimaryTp(p);
    return (
      Number.isFinite(entry) &&
      Number.isFinite(sl) &&
      Number.isFinite(tp) &&
      entry > 0 &&
      sl > 0 &&
      tp > 0
    );
  });
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
  const entry = parseNum(
    item.entry ?? item.entry_price ?? parsed?.entry ?? parsed?.price,
  );
  const sl = parseNum(item.sl ?? item.stop_loss ?? parsed?.sl);
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
      String(item.type || item.order_type || parsed?.type || "limit")
        .trim()
        .toLowerCase() || "limit",
    note: String(
      item.note || parsed?.invalidation || parsed?.note || "",
    ).trim(),
    tp2: Number.isFinite(parseNum(item?.tp2))
      ? formatNum3(parseNum(item?.tp2))
      : "",
    tp3: Number.isFinite(parseNum(item?.tp3))
      ? formatNum3(parseNum(item?.tp3))
      : "",
    be_trigger: Number.isFinite(parseNum(item?.be_trigger ?? item?.be))
      ? formatNum3(parseNum(item?.be_trigger ?? item?.be))
      : "",
    confidence_pct: Number.isFinite(parseNum(item?.confidence_pct))
      ? parseNum(item?.confidence_pct)
      : "",
    risk_pct: Number.isFinite(parseNum(item?.risk_pct))
      ? parseNum(item?.risk_pct)
      : "",
    estimated_bars: Number.isFinite(parseNum(item?.estimated_bars))
      ? parseNum(item?.estimated_bars)
      : "",
    invalidation: String(
      item?.invalidation || parsed?.invalidation || "",
    ).trim(),
    entry_model: String(item?.entry_model || parsed?.entry_model || "").trim(),
    strategy: String(item?.strategy || parsed?.strategy || "").trim(),
    profile: String(item?.profile || parsed?.profile || "").trim(),
    entry_condition: String(item?.entry_condition || "").trim(),
    exit_condition: String(item?.exit_condition || "").trim(),
    skip_recommendation: String(
      item?.skip_recommendation ||
        item?.position_management?.trade_decision ||
        "",
    ).trim(),
    risk_management: String(item?.risk_management || "").trim(),
    confluence_checklist: Array.isArray(item?.confluence_checklist)
      ? item.confluence_checklist
      : [],
    partial_tps: Array.isArray(item?.partial_tps) ? item.partial_tps : [],
  };
}

function buildPerSymbolRawJson(parsed = {}, symbol = "", plan = null) {
  const sym = normalizeSignalSymbol(symbol || "");
  if (!parsed || typeof parsed !== "object") return {};
  const cloned = { ...parsed };
  const plans = Array.isArray(parsed.trade_plan)
    ? parsed.trade_plan
    : parsed?.trade_plan && typeof parsed.trade_plan === "object"
      ? [parsed.trade_plan]
      : [];
  const selected =
    plan && typeof plan === "object"
      ? [plan]
      : plans.filter(
          (p) => normalizeSignalSymbol(String(p?.symbol || "")) === sym,
        );
  cloned.trade_plan = selected;
  return cloned;
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
    inPlan(/"direction"\s*:\s*"([^"]+)"/i) || inPlan(/"dir"\s*:\s*"([^"]+)"/i);
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
      tp: inPlanNum(/"tp"\s*:\s*(-?\d+(?:\.\d+)?)/i) ?? tp1 ?? tp2 ?? tp3,
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
  //   if (!res.symbol && fallback.symbol) res.symbol = fallback.symbol;
  //   if (!res.profile && fallback.profile) res.profile = fallback.profile;

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
        symbol: x?.symbol || parsed.symbol || fallback.symbol,
      })),
    );
  if (parsed.trade_setup && typeof parsed.trade_setup === "object") {
    rows.push({
      ...(parsed.trade_setup || {}),
      symbol: parsed.trade_setup?.symbol || parsed.symbol || fallback.symbol,
    });
  }
  if (
    parsed.trade_plan &&
    typeof parsed.trade_plan === "object" &&
    !Array.isArray(parsed.trade_plan)
  ) {
    rows.push({
      ...(parsed.trade_plan || {}),
      symbol: parsed.trade_plan?.symbol || parsed.symbol || fallback.symbol,
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
        String(s?.source || fallback.source || fallback.model || "ai").trim() ||
        "ai";
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
        rr: parseNum(s?.rr ?? s?.risk_reward),
        risk_pct: parseNum(s?.risk_pct ?? s?.risk_percent),
        grade: String(s?.grade || "").trim(),
        profile: String(s?.profile || parsed?.profile || "").trim(),
        confidence_pct: parseNum(s?.confidence_pct),
        invalidation: String(
          s?.invalidation || parsed?.invalidation || "",
        ).trim(),
        trade_decision: String(s?.trade_decision || "").trim(),
      };
    })
    .filter(
      (x) =>
        x &&
        x.symbol &&
        x.trade_decision !== "Skip" &&
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
  if (rr != null && !Number.isFinite(rr)) {
    return "RR must be a valid number.";
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
  const location = useLocation();
  const { symbol: paramSymbol } = useParams();
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);
  const [templates, setTemplates] = useState(() => loadTemplates());
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID);
  const [templateName, setTemplateName] = useState("");

  const [provider, setProvider] = useState("ICMARKETS");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
  const [analysisRaw, setAnalysisRaw] = useState("");
  const [analysisJson, setAnalysisJson] = useState("");
  const [analysisParsed, setAnalysisParsed] = useState(null);
  const [analysisSource, setAnalysisSource] = useState(
    () => localStorage.getItem("ai_model") || "ai_claude",
  );
  const [selectedModel, setSelectedModel] = useState(
    () => localStorage.getItem("ai_model_name") || "claude-sonnet-4-0",
  );
  const [aiModelConfig, setAiModelConfig] = useState(() => ({
    providers: {
      ai_claude: {
        label: "Claude",
        models: [{ value: "claude-sonnet-4-0", label: "Claude 3.5 Sonnet" }],
      },
      ai_gpt4o: {
        label: "OpenAI",
        models: [{ value: "gpt-4o", label: "GPT-4o" }],
      },
      ai_deepseek: {
        label: "DeepSeek",
        models: [{ value: "deepseek-chat", label: "DeepSeek V3" }],
      },
      ai_gemini: {
        label: "Gemini",
        models: [{ value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }],
      },
      ai_openrouter: {
        label: "OpenRouter",
        models: [{ value: "openai/gpt-4o", label: "GPT-4o" }],
      },
    },
  }));
  const [browserTf, setBrowserTf] = useState("4h");
  const [browserTfs, setBrowserTfs] = useState(["4h"]);
  const [visibleCount, setVisibleCount] = useState(8);
  const [masterGridCols, setMasterGridCols] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [apiSymbolOptions, setApiSymbolOptions] = useState([]);
  const [symbolActivity, setSymbolActivity] = useState({
    loading: false,
    items: [],
  });

  const [usedFiles, setUsedFiles] = useState([]);
  const [sessionPrefix, setSessionPrefix] = useState("");
  const buildAiAnalyzeRoute = (symbols = []) => {
    const list = (Array.isArray(symbols) ? symbols : [])
      .map((x) => normalizeWatchSymbol(x))
      .filter(Boolean);
    if (!list.length) return "/ai/analyze";
    const slug = list.join("-");
    return `/ai/analyze/${encodeURIComponent(slug)}?symbols=${encodeURIComponent(
      list.join(","),
    )}`;
  };

  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [watchlist, setWatchlist] = useState([]);
  const [isSymbolPanelOpen, setIsSymbolPanelOpen] = useState(true);
  const [symbolFilterTab, setSymbolFilterTab] = useState("FAVOURITE");
  const [analysisFilesDisplay, setAnalysisFilesDisplay] = useState([]);
  const [autoSaveResult, setAutoSaveResult] = useState(null);
  const [manualAddedMode, setManualAddedMode] = useState("");
  const [addedEntities, setAddedEntities] = useState({});
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
  const [selectedPlanIdx, setSelectedPlanIdx] = useState(0);
  const [planEdits, setPlanEdits] = useState({});
  const [aiContext, setAiContext] = useState(null);
  const [barsLoading, setBarsLoading] = useState(false);
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
    buildPrompt(DEFAULT_CONFIG, "", "{}"),
  );
  const [promptEdited, setPromptEdited] = useState(false);
  const [guideUserDraft, setGuideUserDraft] = useState(GUIDE_USER_DEFAULT);
  const [schemaUserDraft, setSchemaUserDraft] = useState(SCHEMA_USER_DEFAULT);
  const [guideSubTab, setGuideSubTab] = useState("user");
  const [schemaSubTab, setSchemaSubTab] = useState("user");
  const [responseMappingDraft, setResponseMappingDraft] = useState(() =>
    JSON.stringify(RESPONSE_MAPPING_RAW, null, 2),
  );
  const [autoSaveMode, setAutoSaveMode] = useState("");
  const [tradesText, setTradesText] = useState("");
  const [browserAnalyzeOpen, setBrowserAnalyzeOpen] = useState(false);
  const [attachedTradeImages, setAttachedTradeImages] = useState([]);
  const [imageDragOver, setImageDragOver] = useState(false);
  const pendingHydrateRef = useRef(null);
  const tradeImageInputRef = useRef(null);
  const liteChartRef = useRef(null);
  const liteChartApiRef = useRef(null);
  const autoFlowRef = useRef({ runId: 0, key: "", timer: null });
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

  const promptText = useMemo(
    () => buildPrompt(cfg, guideUserDraft, schemaUserDraft),
    [cfg],
  );

  const hydrateFromResultEntry = useCallback(
    (entry) => {
      if (!entry || entry.type !== "analyze") return false;
      const out = entry.data || {};
      const raw = String(out?.raw_response || "");
      const parsed = enrichParsedAnalysis(
        raw,
        out?.parsed_json || tryParseJsonLoose(raw),
      );
      const used = Array.isArray(out?.used_files) ? out.used_files : [];
      const display = used.length ? used : analysisFilesDisplay;
      const firstPlanSymbol = normalizeWatchSymbol(
        parsed?.trade_plan?.[0]?.symbol || "",
      );
      const fallbackSymbol = normalizeWatchSymbol(
        parsed?.symbol || cfg.symbol || "",
      );
      const nextSymbol = firstPlanSymbol || fallbackSymbol || "";
      if (nextSymbol) {
        setCfg((prev) => ({
          ...prev,
          symbol: nextSymbol,
          symbols: Array.from(
            new Set(
              [
                ...(Array.isArray(prev?.symbols) ? prev.symbols : []),
                ...(Array.isArray(parsed?.trade_plan)
                  ? parsed.trade_plan
                      .map((p) => normalizeWatchSymbol(p?.symbol))
                      .filter(Boolean)
                  : []),
                nextSymbol,
              ].filter(Boolean),
            ),
          ),
        }));
      }
      pendingHydrateRef.current = {
        raw,
        parsed: parsed && typeof parsed === "object" ? parsed : null,
        usedFiles: used,
        displayFiles: display,
      };
      if (out?.source || out?.updated_time) {
        setMarketMetadata({
          source: out.source || "",
          updated_time: out.updated_time || null,
          auto_refresh: out.auto_refresh || 0,
        });
      }
      setStatus({
        type: entry.status === "error" ? "error" : "success",
        text:
          entry.status === "error"
            ? String(entry.error || "Analyze result failed.")
            : `Loaded AI result: ${entry.requestId}`,
      });
      return true;
    },
    [analysisFilesDisplay, cfg.symbol],
  );

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
    setAutoSaveResult(null);
    if (pendingHydrateRef.current) {
      const p = pendingHydrateRef.current;
      pendingHydrateRef.current = null;
      if (p.raw != null) setAnalysisRaw(String(p.raw || ""));
      if (p.parsed && typeof p.parsed === "object") {
        setAnalysisParsed(p.parsed);
        setAnalysisJson(JSON.stringify(p.parsed, null, 2));
        setPosition(extractPositionFromAnalysis(p.parsed));
      }
      if (Array.isArray(p.usedFiles)) setUsedFiles(p.usedFiles);
      if (Array.isArray(p.displayFiles))
        setAnalysisFilesDisplay(p.displayFiles);
      setResponseTab("chart");
    }
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
  const jsonConfigText = useMemo(() => {
    const payload = buildTemplateConfigPayload(
      cfg,
      guideUserDraft,
      schemaUserDraft,
    );
    return JSON.stringify(payload, null, 2);
  }, [cfg, guideUserDraft]);
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

  const effectiveChartSnapshot = useMemo(() => {
    const barsSnapshot =
      currentBarsSnapshot && typeof currentBarsSnapshot === "object"
        ? currentBarsSnapshot
        : null;
    const parsed =
      effectiveParsed && typeof effectiveParsed === "object"
        ? effectiveParsed
        : null;
    if (!barsSnapshot && !parsed) return null;
    const mergedSummary = {
      ...(barsSnapshot?.summary && typeof barsSnapshot.summary === "object"
        ? barsSnapshot.summary
        : {}),
      ...(parsed?.summary && typeof parsed.summary === "object"
        ? parsed.summary
        : {}),
    };
    return {
      ...(barsSnapshot || {}),
      ...(parsed || {}),
      bars: Array.isArray(barsSnapshot?.bars) ? barsSnapshot.bars : [],
      summary: mergedSummary,
    };
  }, [currentBarsSnapshot, effectiveParsed]);

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
        model: analysisSource,
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
  const autoSavedSignal =
    autoSaveResult?.enabled === true &&
    autoSaveResult?.saved === true &&
    autoSaveResult?.mode === "signals";
  const autoSavedTrades =
    autoSaveResult?.enabled === true &&
    autoSaveResult?.saved === true &&
    autoSaveResult?.mode === "trades";
  const manuallyAddedSignal = manualAddedMode === "signal";
  const manuallyAddedTrade = manualAddedMode === "trade";

  const resolveCreatedId = (obj = {}, mode = "") => {
    const candidates = [
      obj?.sid,
      obj?.id,
      obj?.signal_id,
      obj?.signalId,
      obj?.trade_id,
      obj?.tradeId,
      obj?.created?.sid,
      obj?.created?.id,
      obj?.created?.signal_id,
      obj?.created?.trade_id,
      obj?.trade?.sid,
      obj?.trade?.id,
      obj?.signal?.sid,
      obj?.signal?.id,
    ]
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    if (!candidates.length) return null;
    return { kind: mode === "trade" ? "trade" : "signal", id: candidates[0] };
  };

  const setCfgField = (key, value) => {
    setCfg((prev) => {
      if (key === "symbol") {
        const normalized = normalizeWatchSymbol(value);
        const prevSymbols = Array.isArray(prev?.symbols) ? prev.symbols : [];
        const nextSymbols = normalized
          ? [normalized, ...prevSymbols.filter((x) => x !== normalized)]
          : prevSymbols;
        return { ...prev, symbol: normalized, symbols: nextSymbols };
      }
      return { ...prev, [key]: value };
    });
    if (key === "symbol") {
      if (value) {
        navigate(buildAiAnalyzeRoute([value]), { replace: true });
      } else {
        navigate("/ai/analyze", { replace: true });
      }
    }
  };
  const setSelectedSymbols = (symbols = []) => {
    const next = [
      ...new Set(
        (Array.isArray(symbols) ? symbols : [])
          .map((x) => normalizeWatchSymbol(x))
          .filter(Boolean),
      ),
    ];
    setCfg((prev) => ({
      ...prev,
      symbols: next,
      symbol: next[0] || "",
    }));
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
    const requestedSymbols = Array.isArray(opts.symbols)
      ? opts.symbols
          .map((x) =>
            String(x || "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean)
      : [];
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
    const sourceSymbols = requestedSymbols.length
      ? requestedSymbols
      : [symbolRaw, String(tvSymbol || "").toUpperCase()].filter(Boolean);
    const requestedTokenMap = new Map();
    sourceSymbols.forEach((sym) => {
      const normalizedSym = String(sym || "")
        .trim()
        .toUpperCase();
      if (!normalizedSym) return;
      const withProvider = normalizedSym.includes(":")
        ? normalizedSym
        : `${providerRaw}:${normalizedSym}`;
      const tokenSet = new Set(
        [normalizedSym, withProvider]
          .map((x) => sanitizeSnapshotFileToken(x || ""))
          .filter(Boolean),
      );
      requestedTokenMap.set(normalizedSym, tokenSet);
    });
    const symbolTokens = new Set(
      Array.from(requestedTokenMap.values()).flatMap((set) => Array.from(set)),
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

    const matchedFiles = [];
    for (const reqSym of sourceSymbols) {
      const req = String(reqSym || "")
        .trim()
        .toUpperCase();
      const tokenSet = requestedTokenMap.get(req);
      if (!tokenSet || !tokenSet.size) continue;
      for (const tf of targetTfTokens) {
        const hit = candidates.find(
          (c) => c.tfToken === tf && tokenSet.has(c.symbolToken),
        );
        if (hit?.fileName) matchedFiles.push(hit.fileName);
      }
    }
    const matchedByTf = new Map();
    matchedFiles.forEach((f) => {
      const meta = parseSnapshotMeta({
        file_name: f,
        created_at: new Date().toISOString(),
      });
      if (meta?.tfToken) matchedByTf.set(meta.tfToken, true);
    });
    const missingTokens = targetTfTokens.filter((tf) => !matchedByTf.has(tf));
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

  const setActionMessage = (action, type, text) => {
    setActionStatus({ action, type, text: String(text || "") });
  };
  const addTradeImageFiles = (files) => {
    const fileList = Array.isArray(files) ? files : files ? [files] : [];
    if (!fileList.length) return;
    const imageFiles = fileList.filter((f) =>
      String(f?.type || "").startsWith("image/"),
    );
    if (!imageFiles.length) {
      setStatus({ type: "warning", text: "Only image files are supported." });
      return;
    }
    let loaded = 0;
    const results = [];
    for (const f of imageFiles) {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        if (dataUrl.startsWith("data:image/")) {
          results.push({ name: f.name || "image", dataUrl });
        }
        loaded++;
        if (loaded === imageFiles.length) {
          setAttachedTradeImages((prev) => [...prev, ...results]);
        }
      };
      reader.readAsDataURL(f);
    }
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

  const analyzeFiles = async (files = [], opts = {}) => {
    const hasCorePlanLevels = (parsed) => {
      const plans = Array.isArray(parsed?.trade_plan) ? parsed.trade_plan : [];
      if (!plans.length) return false;
      const first = plans[0] || {};
      const entry = Number(first.entry);
      const sl = Number(first.sl);
      const tp = Number(first.tp);
      return (
        Number.isFinite(entry) &&
        Number.isFinite(sl) &&
        Number.isFinite(tp) &&
        entry !== 0 &&
        sl !== 0 &&
        tp !== 0
      );
    };
    setAnalyzing(true);
    setStatus({ type: "info", text: "Analyzing screenshots..." });
    setAnalysisFilesDisplay(
      Array.isArray(files) && files.length ? files : analysisFilesDisplay,
    );
    setAutoSaveResult(null);
    const activeSessionPrefix = sessionPrefix || makeSessionPrefix();
    if (!sessionPrefix) setSessionPrefix(activeSessionPrefix);
    try {
      if (opts.runId && !isCurrentFlowRun(opts.runId)) return null;
      const context = null;
      if (opts.runId && !isCurrentFlowRun(opts.runId)) return null;

      const basePrompt = String(promptDraft || promptText || "").trim();
      const activeSymbols = Array.isArray(opts?.symbolsOverride)
        ? opts.symbolsOverride
            .map((x) => String(x || "").trim())
            .filter(Boolean)
        : Array.isArray(cfg?.symbols)
          ? cfg.symbols.map((x) => String(x || "").trim()).filter(Boolean)
          : [];
      const activeSymbol = String(
        activeSymbols[0] ||
          opts?.symbolOverride ||
          tvSymbol ||
          cfg.symbol ||
          "",
      ).trim();
      const runtimeConfig = JSON.stringify({
        symbols: activeSymbols,
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
      const guideOverride = String(guideUserDraft || "").trim();
      const composedPrompt = [
        basePrompt,
        `CONFIG:${runtimeConfig}`,
        guideOverride ? `USER_GUIDE:${guideOverride}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      const contextFiles = Array.isArray(context?.context_files)
        ? context.context_files
        : [];
      const useContextFiles = contextFiles.length > 0;
      const payload = {
        model: selectedModel,
        ai_provider: analysisSource,
        prompt: composedPrompt,
        session_prefix: activeSessionPrefix,
        max_tokens: 4500,
        symbols: activeSymbols,
        timeframe,
        provider,
        timeframes: snapshotTfs,
        bars_count: Number(cfg.lookbackBars || 300) || 300,
        use_context_files: useContextFiles,
        context_mode: useContextFiles ? "claude" : "none",
        context_files: contextFiles,
        // Reduce stale context/snapshot impact on TP/SL output quality.
        force_refresh: true,
        snapshot_refresh: true,
      };
      if (autoSaveMode === "signals" || autoSaveMode === "trades") {
        payload.auto_save = autoSaveMode;
      } else {
        payload.auto_save = null;
      }
      if (String(tradesText || "").trim()) {
        payload.Trades = String(tradesText || "").trim();
      }
      if (attachedTradeImages.length > 0) {
        payload.attached_images = attachedTradeImages.map((img) => ({
          name: img.name,
          data_url: img.dataUrl,
        }));
      }

      if (Array.isArray(files) && files.length) payload.files = files;
      if (!Array.isArray(payload.symbols) || !payload.symbols.length) {
        throw new Error(
          "Symbols context is empty. Select at least one symbol before Analyze.",
        );
      }
      if (!payload.files || !payload.files.length) {
        if (payload.symbols.length) {
          try {
            const { promise: snapPromise } = NotificationHub.track(
              "snapshot",
              { symbol: activeSymbols.join(",") },
              () =>
                api.chartSnapshotCreateBatch({
                  symbols: activeSymbols,
                  provider: provider || "ICMARKETS",
                  session_prefix: activeSessionPrefix,
                  tfs:
                    Array.isArray(snapshotTfs) && snapshotTfs.length
                      ? snapshotTfs
                      : ["D", "240", "15", "5"],
                  lookbackBars: Number(cfg.lookbackBars || 300) || 300,
                }),
            );
            const batch = await snapPromise;
            const freshFiles = Array.isArray(batch?.items)
              ? batch.items
                  .map((x) => String(x?.file_name || "").trim())
                  .filter(Boolean)
              : [];
            if (freshFiles.length) payload.files = freshFiles;
          } catch {
            // Backend will still validate symbol-matched snapshots and return clear error if unavailable.
          }
        }
      }

      let out;
      const { promise: analyzePromise } = NotificationHub.track(
        "analyze",
        { symbol: activeSymbols.join(",") || activeSymbol },
        async () => {
          try {
            return await api.chartSnapshotsAnalyze(payload);
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
              return await api.chartSnapshotsAnalyze(payload);
            }
            throw firstErr;
          }
        },
      );
      out = await analyzePromise;
      if (opts.runId && !isCurrentFlowRun(opts.runId)) return out;
      if (out?.source || out?.updated_time) {
        setMarketMetadata({
          source: out.source || "",
          updated_time: out.updated_time || null,
          auto_refresh: out.auto_refresh || 0,
        });
      }
      const raw = String(out?.raw_response || "");
      setAutoSaveResult(out?.auto_save_result || null);
      const autoMode = String(out?.auto_save_result?.mode || "").toLowerCase();
      if (out?.auto_save_result?.saved) {
        const autoEntity = resolveCreatedId(
          out?.auto_save_result,
          autoMode === "trades" ? "trade" : "signal",
        );
        if (autoEntity)
          setAddedEntities((prev) => ({ ...prev, main: autoEntity }));
      }
      setAnalysisRaw(raw);
      let parsed = enrichParsedAnalysis(
        raw,
        out?.parsed_json || tryParseJsonLoose(raw),
      );
      // Claude can occasionally return plan shells with null entry/sl/tp.
      // Retry once with stronger instruction to force concrete numeric levels.
      const shouldRepairOnce =
        String(analysisSource || "").toLowerCase() === "ai_claude" &&
        !hasCorePlanLevels(parsed);
      if (shouldRepairOnce) {
        const strictRetryPrompt = `${composedPrompt}\n\nIMPORTANT: Return at least one trade_plan item with numeric entry, sl, tp. Do not return null for these three fields.`;
        const retryPayload = {
          ...payload,
          prompt: strictRetryPrompt,
          force_refresh: true,
          snapshot_refresh: true,
        };
        try {
          const retryOut = await api.chartSnapshotsAnalyze(retryPayload);
          const retryRaw = String(retryOut?.raw_response || "");
          const retryParsed = enrichParsedAnalysis(
            retryRaw,
            retryOut?.parsed_json || tryParseJsonLoose(retryRaw),
          );
          if (hasCorePlanLevels(retryParsed)) {
            out = retryOut;
            parsed = retryParsed;
            setAnalysisRaw(retryRaw);
          }
        } catch {
          // Keep first response if retry fails.
        }
      }
      if (parsed && typeof parsed === "object") {
        //         // Normalize symbol: strip exchange prefix if Claude returned KRX:122900 instead of US30
        //         const inputSymbol = String(activeSymbol || cfg.symbol || "")
        //           .split(":")
        //           .pop();
        //         if (
        //           parsed.symbol &&
        //           inputSymbol &&
        //           !parsed.symbol.includes(inputSymbol)
        //         ) {
        //           // Claude returned a different symbol — trust our input
        //           parsed.symbol = inputSymbol;
        //         }
        setAnalysisParsed(parsed);
        setAnalysisJson(JSON.stringify(parsed, null, 2));
        if (!hasRequiredPlanLevels(parsed)) {
          throw new Error(
            "Invalid analysis response: entry, tp, sl are required in trade_plan.",
          );
        }
        setPosition(extractPositionFromAnalysis(parsed));
        if (!cfg.symbol) {
          const nextSymbol = normalizeWatchSymbol(parsed?.symbol || "");
          if (nextSymbol) {
            pendingHydrateRef.current = {
              raw,
              parsed,
              usedFiles: Array.isArray(out?.used_files) ? out.used_files : [],
              displayFiles: !files.length
                ? Array.isArray(out?.used_files)
                  ? out.used_files
                  : []
                : Array.isArray(files)
                  ? files
                  : [],
            };
            setCfgField("symbol", nextSymbol);
          }
        }
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
      const analyzedCount = Array.isArray(out?.used_files)
        ? out.used_files.length
        : Array.isArray(files)
          ? files.length
          : 0;
      const msg = `Analyzed ${analyzedCount} screenshot(s).${fileMode}`;
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

  const analyzeSelected = async (opts = {}) => {
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
    const allowNoSymbol = Boolean(opts?.allowNoSymbol);
    const selectedSymbols = Array.isArray(cfg?.symbols)
      ? cfg.symbols.map((x) => normalizeWatchSymbol(x)).filter(Boolean)
      : [];
    const resolvedSymbol = String(tvSymbol || cfg.symbol || "").trim();
    // Never use provider name as symbol (e.g. ICMARKETS)
    const PROVIDER_NAMES = new Set([
      "ICMARKETS",
      "OANDA",
      "FOREXCOM",
      "EIGHTCAP",
      "PEPPERSTONE",
    ]);
    const effectiveSymbol =
      resolvedSymbol && !PROVIDER_NAMES.has(resolvedSymbol.toUpperCase())
        ? resolvedSymbol
        : String(cfg.symbol || "")
            .split(":")
            .pop()
            ?.trim() || "";
    const targetSymbols = selectedSymbols.length
      ? selectedSymbols
      : effectiveSymbol
        ? [effectiveSymbol]
        : [];
    if ((!targetSymbols.length && !allowNoSymbol) || !tfs.length) {
      setStatus({
        type: "warning",
        text: allowNoSymbol
          ? "At least one snapshot TF is required."
          : "Symbol and at least one snapshot TF are required.",
      });
      return;
    }

    setStatus({ type: "", text: "" });
    try {
      const hasContext = true; // backend handles context bundle in analyze
      const recent = resolveRecentSnapshots({
        sessionPrefix: activeSessionPrefix,
        symbols: targetSymbols,
      });
      const expectedFilesMin =
        Math.max(1, targetSymbols.length) *
        Math.max(1, recent.targetTfTokens.length);
      const filesForAnalyze =
        recent.matchedFiles.length >= expectedFilesMin
          ? recent.matchedFiles
          : [];
      await analyzeFiles(filesForAnalyze, {
        context: hasContext ? aiContext : undefined,
        symbolOverride: targetSymbols[0] || effectiveSymbol,
        symbolsOverride: targetSymbols,
      });
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
            model: analysisSource,
          });

      if (!signals.length) {
        const symbolManual = normalizeSignalSymbol(
          String(overridePosition?.symbol || tvSymbol || cfg.symbol || "")
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
      if (validationErr && !overridePosition) throw new Error(validationErr);
      let createdCount = 0;
      let lastCreated = null;
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
          symbol: normalizeSignalSymbol(
            payload.symbol ||
              activePosition?.symbol ||
              tvSymbol ||
              cfg.symbol ||
              "",
          ),
          source:
            String(payload?.source || analysisSource || "ai_claude").trim() ||
            "ai_claude",
          session_prefix: activeSessionPrefix || undefined,
          sid: (() => {
            const s = normalizeSignalSymbol(
              payload.symbol || tvSymbol || cfg.symbol || "",
            );
            const p = String(activeSessionPrefix || "")
              .trim()
              .toUpperCase();
            return s && p ? `${s}_${p}` : undefined;
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
          raw_json:
            parsed && typeof parsed === "object"
              ? buildPerSymbolRawJson(
                  parsed,
                  payload.symbol || activePosition?.symbol || "",
                )
              : undefined,
          snapshot_files: chartFiles,
          analysis_snapshot: analysisSnapshotPayload,
        };
        if (overridePosition) {
          delete finalPayload.trade_plan;
          delete finalPayload.market_analysis;
          delete finalPayload.risk_management;
          delete finalPayload.final_verdict;
        }
        if (mode === "trade") {
          const { promise: tradePromise } = NotificationHub.track(
            "create_trade",
            {
              symbol: String(
                finalPayload?.symbol || activePosition?.symbol || "",
              ),
            },
            () => api.createTrade(finalPayload),
          );
          const out = await tradePromise;
          if (out && typeof out === "object") lastCreated = out;
        } else {
          const { promise: signalPromise } = NotificationHub.track(
            "create_signal",
            {
              symbol: String(
                finalPayload?.symbol || activePosition?.symbol || "",
              ),
            },
            () => api.createSignal(finalPayload),
          );
          const out = await signalPromise;
          if (out && typeof out === "object") lastCreated = out;
        }
        createdCount += 1;
      }
      const createdEntity = resolveCreatedId(lastCreated || {}, mode);
      if (createdEntity && submittingPlanId)
        setAddedEntities((prev) => ({
          ...prev,
          [submittingPlanId]: createdEntity,
        }));
      const msg =
        mode === "trade"
          ? `Added ${createdCount} trade request(s).`
          : `Added ${createdCount} signal(s) only.`;
      setManualAddedMode(mode);
      setStatus({ type: "success", text: msg });
      setActionMessage("add", "success", msg);
      showToast({ message: msg, type: "success", position: "bottom-right" });
      console.log("[ai-add]", {
        mode,
        createdCount,
        session_prefix: activeSessionPrefix,
      });
    } catch (e) {
      const msg = String(e?.message || e || "Add Signal failed.");
      setStatus({ type: "error", text: msg });
      setActionMessage("add", "error", msg);
      showToast({ message: msg, type: "error", position: "bottom-right" });
      console.error("[ai-add-error]", { mode, message: msg });
    } finally {
      setAddingSignal(false);
      setSubmittingPlanId(null);
    }
  };

  const saveTemplate = async () => {
    // If overriding an existing template, keep its name for ON CONFLICT
    const existingTemplate =
      templateId && templateId !== DEFAULT_TEMPLATE_ID
        ? templates.find((x) => x.id === templateId)
        : null;
    const name = existingTemplate
      ? existingTemplate.name
      : String(templateName || "").trim() ||
        `${cfg.symbol} ${cfg.strategies.join("+")}`;
    const payload = {
      ...(templateId && templateId !== DEFAULT_TEMPLATE_ID
        ? { template_id: templateId }
        : {}),
      name,
      config: buildTemplateConfigPayload(cfg, guideUserDraft, schemaUserDraft),
      saved: new Date().toISOString(),
    };

    setStatus({ type: "warning", text: "Saving template..." });
    try {
      const out = await api.aiUpsertTemplate(payload);
      const savedTemplate = out?.template || payload;
      const item = normalizeTemplateRecord(
        {
          ...savedTemplate,
          template_id: savedTemplate.template_id || name,
          name: String(savedTemplate.name || name),
          config: normalizeTemplateConfig(savedTemplate.config || {}),
          saved: savedTemplate.saved || payload.saved,
          analysis_instructions:
            savedTemplate.analysis_instructions || guideUserDraft,
          schema_additions: savedTemplate.schema_additions || schemaUserDraft,
        },
        name,
      );

      const next = dedupeTemplates([
        item,
        ...templates.filter((x) => x.id !== item.id && x.name !== item.name),
      ]).slice(0, 200);
      setTemplates(next);
      saveTemplatesToLocal(next);
      setTemplateId(item.id);
      setTemplateName(item.name);
      setStatus({ type: "success", text: `Saved: ${item.name}` });
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
      const next = dedupeTemplates(
        templates.filter((x) => x.id !== templateId),
      );
      setTemplates(next);
      saveTemplatesToLocal(next);
      setTemplateId(DEFAULT_TEMPLATE_ID);
      setTemplateName("");
      setStatus({ type: "success", text: `Deleted: ${found.name}` });
    } catch (e) {
      console.error("[templates] Delete failed:", e);
      setStatus({ type: "error", text: `Delete failed: ${e.message}` });
    }
  };

  const loadTemplatesFromDb = async () => {
    try {
      const out = await api.aiListTemplates();
      const rows = Array.isArray(out?.templates) ? out.templates : [];
      const dbTemplates = dedupeTemplates(rows);

      setTemplates((prev) => {
        return dedupeTemplates([...dbTemplates, ...prev]);
      });
    } catch (err) {
      console.warn("[templates] DB Load failed:", err.message);
    }
  };

  const handleSelectTemplate = (id) => {
    setTemplateId(id);
    if (!id) {
      setCfg((prev) => ({
        ...DEFAULT_CONFIG,
        symbol: String(prev?.symbol || "").trim(),
      }));
      setGuideUserDraft(GUIDE_USER_DEFAULT);
      setSchemaUserDraft(SCHEMA_USER_DEFAULT);
      setPromptEdited(false);
      setTemplateName("");
      setStatus({ type: "success", text: "New template." });
      return;
    }
    if (id === DEFAULT_TEMPLATE_ID) {
      setCfg((prev) => ({
        ...DEFAULT_CONFIG,
        symbol: String(prev?.symbol || "").trim(),
      }));
      setGuideUserDraft(GUIDE_USER_DEFAULT);
      setSchemaUserDraft(SCHEMA_USER_DEFAULT);
      setPromptEdited(false);
      setTemplateName("");
      setStatus({ type: "success", text: "Default template loaded." });
      return;
    }
    const found = templates.find((x) => x.id === id);
    if (!found?.config) return;
    const savedGuide = found.analysis_instructions || null;
    setCfg((prev) => {
      const next = normalizeTemplateConfig(found.config || {});
      if (!String(next?.symbol || "").trim()) {
        next.symbol = String(prev?.symbol || "").trim();
      }
      return next;
    });
    const savedSchema =
      found.schema_additions ||
      found.config?.schema_additions ||
      SCHEMA_USER_DEFAULT;
    setGuideUserDraft(savedGuide || GUIDE_USER_DEFAULT);
    setSchemaUserDraft(savedSchema);
    setTemplateName(found.name || "");
    setPromptEdited(false);
    setStatus({ type: "success", text: `Template loaded: ${found.name}` });
  };

  useEffect(() => {
    if (!templateId || templateId === DEFAULT_TEMPLATE_ID) return;
    if (!templates.some((x) => x.id === templateId)) {
      setTemplateId(DEFAULT_TEMPLATE_ID);
      setTemplateName("");
    }
  }, [templates, templateId]);

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
    const search = new URLSearchParams(location.search || "");
    const resultId = String(search.get("result") || "").trim();
    if (resultId) {
      const hubEntry = NotificationHub.getResult(resultId);
      if (hubEntry && hydrateFromResultEntry(hubEntry)) {
        return;
      }
    }
    const raw = String(search.get("symbols") || "").trim();
    const routeSymbols = raw
      ? raw
          .split(",")
          .map((x) => normalizeWatchSymbol(x))
          .filter(Boolean)
      : [];
    if (routeSymbols.length) {
      setSelectedSymbols(routeSymbols);
      return;
    }
    if (paramSymbol) {
      const decoded = decodeURIComponent(paramSymbol);
      const slugSymbols = decoded
        .split("-")
        .map((x) => normalizeWatchSymbol(x))
        .filter(Boolean);
      if (slugSymbols.length > 0) {
        setSelectedSymbols(slugSymbols);
        return;
      }
      setCfgField("symbol", decoded);
    }
  }, []);

  useEffect(() => {
    const search = new URLSearchParams(location.search || "");
    const resultId = String(search.get("result") || "").trim();
    if (!resultId) return;
    const hubEntry = NotificationHub.getResult(resultId);
    if (hubEntry) hydrateFromResultEntry(hubEntry);
  }, [location.search, hydrateFromResultEntry]);

  useEffect(() => {
    if (location.pathname.startsWith("/ai/result")) return;
    const symbols = Array.isArray(cfg?.symbols)
      ? cfg.symbols.map((x) => normalizeWatchSymbol(x)).filter(Boolean)
      : [];
    if (!symbols.length) return;
    const next = buildAiAnalyzeRoute(symbols);
    if (`${location.pathname}${location.search}` !== next) {
      navigate(next, { replace: true });
    }
  }, [cfg.symbols]);

  useEffect(() => {
    loadWatchlist();
    loadTemplatesFromDb();
    // Load AI model config from user settings
    api
      .getSettings()
      .then((res) => {
        const list = Array.isArray(res?.settings) ? res.settings : [];
        const cfg = list.find(
          (s) => s?.type === "system_config" && s?.name === "AI_MODELS",
        );
        if (cfg?.data?.providers) setAiModelConfig(cfg.data);
      })
      .catch(() => {});
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
            sid: x?.sid || null,
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
            sid: x?.sid || null,
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
      <div style={{ display: "grid", gap: 10 }}>
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
        </div>
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "flex-end",
          }}
        >
          <div style={{ minWidth: 100 }}>
            <label className="minor-text">Min Trades</label>
            <input
              type="number"
              min="0"
              step="1"
              value={cfg.min_trades || "0"}
              onChange={(e) => setCfgField("min_trades", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ minWidth: 100 }}>
            <label className="minor-text">Max Trades</label>
            <input
              type="number"
              min="0"
              step="1"
              value={cfg.max_trades || "2"}
              onChange={(e) => setCfgField("max_trades", e.target.value)}
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ minWidth: 120 }}>
            <label className="minor-text">Narrative Language</label>
            <select
              value={cfg.narrative_language || "English"}
              onChange={(e) =>
                setCfgField("narrative_language", e.target.value)
              }
              style={{ width: "100%" }}
            >
              <option>Vietnamese</option>
              <option>English</option>
              <option>Deutch</option>
            </select>
          </div>
          <div style={{ minWidth: 100 }}>
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
      {settingsTab === "strategies" ? (
        <>
          <div className="minor-text">
            Active strategies with checklists and entry models. Included in
            Prompt under ## ACTIVE STRATEGIES.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={(() => {
              const ctx = [];
              const active = cfg.strategies || [];
              for (const s of active) {
                const model = STRATEGY_ENTRY_MODELS[s];
                if (!model) continue;
                ctx.push(`### ${s}`);
                ctx.push(model.description || "");
                ctx.push("");
                ctx.push("Checklist:");
                for (const c of model.checklist || []) {
                  ctx.push(
                    `  - [${c.weight || "-"}] ${c.description} (${c.category || ""})`,
                  );
                }
                ctx.push("");
              }
              return ctx.join("\n");
            })()}
            readOnly
          />
        </>
      ) : null}
      {settingsTab === "guide" ? (
        <>
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            <button
              type="button"
              className={`secondary-button ${guideSubTab === "user" ? "active" : ""}`}
              onClick={() => setGuideSubTab("user")}
              style={{ fontSize: 11, padding: "3px 10px" }}
            >
              User Custom
            </button>
            <button
              type="button"
              className={`secondary-button ${guideSubTab === "system" ? "active" : ""}`}
              onClick={() => setGuideSubTab("system")}
              style={{ fontSize: 11, padding: "3px 10px" }}
            >
              System
            </button>
          </div>
          {guideSubTab === "user" ? (
            <>
              <div className="minor-text" style={{ marginBottom: 8 }}>
                Your Custom Instructions — appended after system instructions.
                Saved to template.
              </div>
              <textarea
                className="snapshot-mono-v2"
                rows={30}
                value={guideUserDraft}
                onChange={(e) => setGuideUserDraft(e.target.value)}
                placeholder="Add your custom trading rules, preferences, or overrides here..."
              />
            </>
          ) : (
            <>
              <div className="minor-text" style={{ marginBottom: 8 }}>
                System Instructions (readonly) — always included in prompt.
              </div>
              <textarea
                className="snapshot-mono-v2"
                rows={30}
                value={GUIDE_SYSTEM}
                readOnly
                style={{ opacity: 0.7, background: "rgba(255,255,255,0.02)" }}
              />
            </>
          )}
        </>
      ) : null}
      {settingsTab === "schema" ? (
        <>
          <div className="minor-text" style={{ marginBottom: 8 }}>
            System Schema (readonly) — base output structure.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={14}
            value={JSON.stringify(SCHEMA_SYSTEM, null, 2)}
            readOnly
            style={{ opacity: 0.7, background: "rgba(255,255,255,0.02)" }}
          />
          <div
            className="minor-text"
            style={{ marginTop: 16, marginBottom: 8 }}
          >
            Your Schema Additions (editable JSON) — merged as {"{"}"extra": ...
            {"}"} in final schema. Saved to template.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={10}
            value={schemaUserDraft}
            onChange={(e) => setSchemaUserDraft(e.target.value)}
            placeholder='{"custom_field": "value"}'
          />
        </>
      ) : null}
      {settingsTab === "prompt" ? (
        <>
          <div className="minor-text">
            Final composed Prompt (readonly) = SESSION CONFIG + STRATEGIES +
            ANALYSIS INSTRUCTIONS + OUTPUT SCHEMA.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={promptDraft}
            readOnly
          />
        </>
      ) : null}
      {settingsTab === "json" ? (
        <>
          <div className="minor-text">
            Template payload saved to DB. Includes config, strategies,
            analysis_instructions, and schema_additions.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={jsonConfigText}
            readOnly
          />
        </>
      ) : null}
      {settingsTab === "mapping" ? (
        <>
          <div className="minor-text" style={{ marginBottom: 8 }}>
            Response Mapping — define how AI response fields map to UI display.
            Format: each field has a fixed label and a mapping chain using ||
            for fallbacks. Readonly fields cannot be customized; editable fields
            can.
          </div>
          <textarea
            className="snapshot-mono-v2"
            rows={30}
            value={responseMappingDraft}
            onChange={(e) => setResponseMappingDraft(e.target.value)}
          />
        </>
      ) : null}
    </>
  );

  const resetAnalyzeSession = () => {
    setAnalysisRaw("");
    setAnalysisJson("");
    setAnalysisParsed(null);
    // Keep analysisSource — user's model preference
    setUsedFiles([]);
    setAnalysisFilesDisplay([]);
    setResponseTab("text");
    resetPositionLocal();
    setActionStatus({ action: "", type: "", text: "" });
    setSessionPrefix("");
    setAutoSaveResult(null);
    setManualAddedMode("");
    setAddedEntities({});
    setStatus({ type: "success", text: "New analyze session started." });
  };
  const resetToDefaultBrowser = () => {
    resetAnalyzeSession();
    setCfgField("symbol", "");
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
        const entry = parseNum(p?.entry ?? p?.entry_price);
        const sl = parseNum(p?.sl ?? p?.stop_loss);
        const tp = getPlanPrimaryTp(p);
        const rr = parseNum(p?.rr ?? p?.risk_reward);
        const skipReasonText = String(
          p?.position_management?.skips_reasons || "",
        ).trim();
        return {
          idx,
          raw: p,
          symbol: normalizeSignalSymbol(p?.symbol || ""),
          direction: String(p?.direction || "NULL").toUpperCase(),
          strategy: String(p?.strategy || "").trim(),
          entryModel: String(p?.entry_model || p?.model || "").trim(),
          confidence:
            parseNum(p?.confidence_pct) ??
            confidenceLevelToPct(p?.confidence_level),
          entry,
          sl,
          tp,
          rr,
          note: String(p?.note || "").trim(),
          trade_type: String(p?.type || p?.order_type || "limit")
            .trim()
            .toLowerCase(),
          be_trigger:
            p?.be_trigger ??
            p?.be ??
            p?.multiple_exits?.break_even?.price ??
            null,
          invalidation: String(
            p?.invalidation ||
              p?.pre_entry_invalidation ||
              p?.position_management?.pre_entry_invalidation ||
              "",
          ).trim(),
          confidence_pct:
            parseNum(p?.confidence_pct) ??
            confidenceLevelToPct(p?.confidence_level),
          estimated_bars:
            p?.estimated_bars ?? p?.estimate_bars_that_entry_happens ?? null,
          reasons_to_skip: Array.isArray(p?.reasons_to_skip)
            ? p.reasons_to_skip
            : skipReasonText
              ? [{ reason: skipReasonText, severity: "" }]
              : [],
          skip_recommendation:
            p?.skip_recommendation ||
            p?.skip ||
            p?.position_management?.trade_decision ||
            "",
          entry_condition: String(
            p?.entry_condition ||
              p?.entry_trigger ||
              p?.position_management?.entry_trigger ||
              "",
          ).trim(),
          exit_condition: String(
            p?.exit_condition ||
              p?.mid_trade_invalidation ||
              p?.position_management?.mid_trade_invalidation ||
              "",
          ).trim(),
        };
      })
      .filter((x) => x.raw && typeof x.raw === "object");
  }, [effectiveParsed]);
  const setPlanEditField = (idx, key, value) => {
    setPlanEdits((prev) => ({
      ...prev,
      [idx]: {
        ...(prev[idx] || {}),
        [key]: String(value ?? ""),
      },
    }));
  };
  const getPlanPositionOverride = (plan, idx) => {
    const base = extractPositionFromPlan(plan?.raw, effectiveParsed || {});
    const edit = planEdits[idx] || {};
    return {
      ...base,
      symbol: normalizeSignalSymbol(plan?.raw?.symbol || ""),
      entry: edit.entry ?? base.entry ?? "",
      tp: edit.tp ?? base.tp ?? "",
      sl: edit.sl ?? base.sl ?? "",
      rr: edit.rr ?? base.rr ?? "",
      trade_type: edit.trade_type ?? base.trade_type ?? "limit",
      note: edit.note ?? base.note ?? "",
    };
  };
  const activePlan = useMemo(
    () => analysisTradePlans[selectedPlanIdx] || analysisTradePlans[0] || null,
    [analysisTradePlans, selectedPlanIdx],
  );
  const selectedSymbol = String(cfg.symbol || paramSymbol || "").trim();
  const selectedSymbols = Array.isArray(cfg?.symbols)
    ? cfg.symbols.map((x) => normalizeWatchSymbol(x)).filter(Boolean)
    : [];

  const applyTradePlanToEditor = (plan) => {
    if (!plan?.raw) return;
    setPosition(extractPositionFromPlan(plan.raw, effectiveParsed || {}));
  };

  useEffect(() => {
    if (!analysisTradePlans.length) return;
    const clamped = Math.min(
      Math.max(0, selectedPlanIdx),
      analysisTradePlans.length - 1,
    );
    if (clamped !== selectedPlanIdx) setSelectedPlanIdx(clamped);
  }, [analysisTradePlans, selectedPlanIdx]);

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
                          const currentGroupActive = group.symbols.some((s) =>
                            selectedSymbols.includes(s),
                          );

                          return (
                            <button
                              key={group.name}
                              type="button"
                              className={`secondary-button snapshot-tag-v2 ${currentGroupActive ? "active" : ""}`}
                              onClick={() => {
                                const next = [...new Set(group.symbols)];
                                setCfg((prev) => ({
                                  ...prev,
                                  symbols: next,
                                  symbol: next[0] || "",
                                }));
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
                            className={`secondary-button snapshot-tag-v2 ${selectedSymbols.includes(s) ? "active" : ""}`}
                            onClick={() => {
                              setCfg((prev) => {
                                const prevSelected = Array.isArray(
                                  prev?.symbols,
                                )
                                  ? prev.symbols
                                  : [];
                                const exists = prevSelected.includes(s);
                                const nextSelected = exists
                                  ? prevSelected.filter((x) => x !== s)
                                  : [...prevSelected, s];
                                return {
                                  ...prev,
                                  symbols: nextSelected,
                                  symbol: nextSelected[0] || "",
                                };
                              });
                            }}
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
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      const ref = x.sid || x.id;
                      if (x.kind === "trade") navigate(`/trades/${ref}`);
                      else navigate(`/signals/${ref}`);
                    }}
                  >
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr auto",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <SymbolEntryCell
                        side={x.side}
                        symbol={x.symbol}
                        orderType={x.type}
                        entry={x.entry}
                        tp={x.tp}
                        sl={x.sl}
                        rr={x.rr}
                        status={x.status}
                      />
                      <StatusPnlCell
                        hideStatus={true}
                        pnl={x.pnl}
                        brokerPips={x.pips}
                        showFilledDetails={false}
                      />
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
        {!hasResponse && (
          <div className="fadeIn">
            <div
              className=""
              style={{
                marginBottom: 8,
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
                gap: 8,
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <>
                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    {selectedSymbol && (
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setCfgField("symbol", "")}
                        style={{ fontSize: 12, padding: "4px 8px" }}
                      >
                        {"<"}
                      </button>
                    )}
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
                      <option value="CRYPTO">Crypto</option>
                      <option value="FOREX">Forex</option>
                      <option value="COMMODITY">Commodity</option>
                      <option value="INDICES">Indices</option>
                      <option value="SMT">SMT</option>
                    </select>
                    <div
                      style={{
                        position: "relative",
                        width: "30%",
                        minWidth: 120,
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
                        style={{
                          flex: 1,
                          padding: "6px 10px",
                          fontSize: 13,
                          minWidth: 0,
                        }}
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
                            saveWatchlistToDb(next).then(() =>
                              setWatchlist(next),
                            );
                          }
                        }}
                        title="Add current symbol"
                      >
                        +
                      </button>
                      <datalist id="tv-symbol-options">
                        {[
                          ...new Set([
                            ...symbolSelectOptions,
                            ...apiSymbolOptions,
                          ]),
                        ].map((opt) => (
                          <option key={opt} value={opt} />
                        ))}
                      </datalist>
                    </div>
                    <select
                      className="secondary-button"
                      style={{
                        height: "34px",
                        padding: "0 10px",
                        fontSize: "12px",
                      }}
                      value={cfg.profile || "day"}
                      onChange={(e) => {
                        const newProfile = e.target.value;
                        setProfilePreset(newProfile);
                        const preset = PROFILE_PRESETS[newProfile];
                        if (preset) {
                          const newTfs = [
                            ...new Set([
                              ...(preset.htf_tfs || []),
                              ...(preset.exec_tfs || []),
                              ...(preset.conf_tfs || []),
                            ]),
                          ];
                          if (newTfs.length > 0) {
                            setBrowserTfs(newTfs);
                            setBrowserTf(newTfs[0]);
                          }
                        }
                      }}
                    >
                      {Object.entries(PROFILE_PRESETS).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      marginTop: 4,
                    }}
                  >
                    <div className="tf-pills">
                      {["D", "4h", "1h", "15m", "5m", "1m"].map((tf) => (
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
                      <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
                        <button
                          className="secondary-button"
                          style={{
                            width: 28,
                            height: 28,
                            padding: 0,
                            fontSize: 16,
                            fontWeight: 800,
                            borderRadius: 6,
                          }}
                          onClick={() =>
                            setMasterGridCols((prev) =>
                              Math.max(1, (prev ?? 2) - 1),
                            )
                          }
                          title="All: Larger charts"
                        >
                          +
                        </button>
                        <button
                          className="secondary-button"
                          style={{
                            width: 28,
                            height: 28,
                            padding: 0,
                            fontSize: 16,
                            fontWeight: 800,
                            borderRadius: 6,
                          }}
                          onClick={() =>
                            setMasterGridCols((prev) =>
                              Math.min(6, (prev ?? 2) + 1),
                            )
                          }
                          title="All: Smaller charts"
                        >
                          -
                        </button>
                      </div>
                    </div>

                    <div
                      style={{ display: "flex", gap: 10, alignItems: "center" }}
                    >
                      <select
                        className="secondary-button"
                        style={{
                          height: "30px",
                          padding: "0 10px",
                          fontSize: "12px",
                        }}
                        value={templateId}
                        onChange={(e) => handleSelectTemplate(e.target.value)}
                      >
                        <option value="">New Template</option>
                        <option value={DEFAULT_TEMPLATE_ID}>
                          Default Template
                        </option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => setSettingsModalOpen(true)}
                        style={{
                          height: "30px",
                          fontSize: "12px",
                          padding: "0 10px",
                        }}
                      >
                        Settings
                      </button>
                    </div>
                  </div>
                </>
              </div>

              <div
                className=""
                style={{
                  padding: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  border: "1px solid rgba(255,255,255,0.04)",
                  borderRadius: 8,
                  boxShadow: "none",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 8,
                  }}
                >
                  <textarea
                    value={tradesText}
                    onChange={(e) => setTradesText(e.target.value)}
                    placeholder="Paste Trades free text here..."
                    style={{ resize: "vertical", padding: 8 }}
                  />
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      setImageDragOver(true);
                    }}
                    onDragLeave={() => setImageDragOver(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setImageDragOver(false);
                      const f = e.dataTransfer?.files || null;
                      addTradeImageFiles(f);
                    }}
                    onClick={() => tradeImageInputRef.current?.click()}
                    style={{
                      border: imageDragOver
                        ? "1px solid var(--accent)"
                        : "1px dashed var(--border)",
                      borderRadius: 6,
                      padding: "8px 10px",
                      cursor: "pointer",
                      background: imageDragOver
                        ? "rgba(0, 170, 255, 0.08)"
                        : "transparent",
                    }}
                  >
                    <input
                      ref={tradeImageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => addTradeImageFiles(e.target.files)}
                    />
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      <span className="minor-text">
                        Drag & drop images here, or click to browse
                      </span>
                      {attachedTradeImages.length > 0 ? (
                        <div
                          style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                        >
                          {attachedTradeImages.map((img, i) => (
                            <span
                              key={i}
                              className="minor-text"
                              style={{
                                background: "var(--surface)",
                                padding: "2px 8px",
                                borderRadius: 4,
                                display: "flex",
                                alignItems: "center",
                                gap: 4,
                                fontSize: 11,
                              }}
                            >
                              {img.name}
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAttachedTradeImages((prev) =>
                                    prev.filter((_, j) => j !== i),
                                  );
                                }}
                                style={{
                                  fontSize: 10,
                                  padding: "0 4px",
                                  lineHeight: "16px",
                                }}
                              >
                                x
                              </button>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="minor-text">No images attached</span>
                      )}
                      {attachedTradeImages.length > 0 && (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAttachedTradeImages([]);
                          }}
                          style={{ fontSize: 10, width: "fit-content" }}
                        >
                          Clear all
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <select
                    value={analysisSource}
                    onChange={(e) => {
                      const v = e.target.value;
                      setAnalysisSource(v);
                      localStorage.setItem("ai_model", v);
                      const models = aiModelConfig.providers[v]?.models || [];
                      if (models.length) {
                        setSelectedModel(models[0].value);
                        localStorage.setItem("ai_model_name", models[0].value);
                      }
                    }}
                    className="secondary-button"
                    style={{
                      padding: "0 8px",
                      height: 34,
                      fontSize: "12px",
                      width: "100%",
                    }}
                  >
                    {Object.entries(aiModelConfig.providers).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                  <select
                    value={selectedModel}
                    onChange={(e) => {
                      setSelectedModel(e.target.value);
                      localStorage.setItem("ai_model_name", e.target.value);
                    }}
                    className="secondary-button"
                    style={{
                      padding: "0 8px",
                      height: 34,
                      fontSize: "11px",
                      width: "100%",
                    }}
                  >
                    {(
                      aiModelConfig.providers[analysisSource]?.models ||
                      aiModelConfig.providers["ai_claude"]?.models ||
                      []
                    ).map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="secondary-button"
                    value={autoSaveMode}
                    onChange={(e) => setAutoSaveMode(e.target.value)}
                    style={{
                      height: 34,
                      fontSize: 12,
                      padding: "0 10px",
                      width: "100%",
                    }}
                  >
                    <option value="">Auto Save: None</option>
                    <option value="signals">Auto Save: Signals</option>
                    <option value="trades">Auto Save: Trades</option>
                  </select>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={analyzing}
                    onClick={() => analyzeSelected({ allowNoSymbol: true })}
                    style={{
                      height: 34,
                      padding: "0 16px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {analyzing ? "Analyzing..." : "Analyze"}
                  </button>
                </div>
              </div>
            </div>
            {!selectedSymbols.length ? (
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
                  gap: 12,
                }}
              >
                {symbolFilterTab === "SMT"
                  ? (() => {
                      const q = String(searchTerm || "")
                        .trim()
                        .toUpperCase();
                      return DEFAULT_SMT_GROUPS.map((group) => {
                        const filteredSyms = q
                          ? group.symbols.filter((s) =>
                              s.toUpperCase().includes(q),
                            )
                          : group.symbols;
                        if (filteredSyms.length === 0) return null;
                        return (
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
                                gridTemplateColumns: "repeat(2, 1fr)",
                                gap: 12,
                              }}
                            >
                              {filteredSyms.map((sym) => (
                                <Suspense
                                  key={sym}
                                  fallback={
                                    <div className="loading-card">
                                      Loading Chart...
                                    </div>
                                  }
                                >
                                  <SymbolChart
                                    symbol={sym}
                                    timeframes={browserTfs}
                                    defaultMode="live"
                                    initialGridCols={masterGridCols}
                                    onAnalyze={(s) =>
                                      setCfg((prev) => ({
                                        ...prev,
                                        symbol: s,
                                        symbols: [s],
                                      }))
                                    }
                                    onRemove={null}
                                  />
                                </Suspense>
                              ))}
                            </div>
                          </div>
                        );
                      });
                    })()
                  : (() => {
                      const q = String(searchTerm || "")
                        .trim()
                        .toUpperCase();
                      const filtered = q
                        ? symbolsByTab.filter((s) =>
                            s.toUpperCase().includes(q),
                          )
                        : symbolsByTab;
                      return filtered.slice(0, visibleCount).map((sym) => (
                        <Suspense
                          key={sym}
                          fallback={
                            <div className="loading-card">Loading Chart...</div>
                          }
                        >
                          <SymbolChart
                            symbol={sym}
                            timeframes={browserTfs}
                            defaultMode="live"
                            initialGridCols={masterGridCols}
                            onAnalyze={(s) =>
                              setCfg((prev) => ({
                                ...prev,
                                symbol: s,
                                symbols: [s],
                              }))
                            }
                            onRemove={(s) => removeFromWatchlist(s)}
                          />
                        </Suspense>
                      ));
                    })()}
              </div>
            ) : null}{" "}
          </div>
        )}

        {hasResponse ? (
          <div style={{ marginBottom: 10 }}>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setAnalysisRaw("");
                setAnalysisJson("");
                setAnalysisParsed(null);
                setSelectedPlanIdx(0);
                setResponseTab("chart");
                setStatus({ type: "", text: "" });
              }}
            >
              Back to Analyze
            </button>
          </div>
        ) : null}

        {!hasResponse && selectedSymbol && (
          <div
            className="browser-grid-v1"
            style={{
              gridTemplateColumns: "1fr",
              gap: 12,
              marginBottom: 20,
            }}
          >
            {(selectedSymbols.length ? selectedSymbols : [selectedSymbol]).map(
              (sym) => (
                <Suspense
                  key={sym}
                  fallback={
                    <div className="loading-card">Loading Chart...</div>
                  }
                >
                  <SymbolChart
                    symbol={sym}
                    timeframes={widgetTfs}
                    defaultMode="live"
                    onAnalyze={() => analyzeSelected()}
                    onRemove={null}
                  />
                </Suspense>
              ),
            )}
          </div>
        )}

        {selectedSymbol && (
          <Suspense
            fallback={<div className="loading-card">Loading Details...</div>}
          >
            <SignalDetailCard
              mode="ai"
              hideTabsBeforeResponse={true}
              chart={{
                enabled: true,
                symbol: normalizeSignalSymbol(
                  activePlan?.symbol || activePlan?.raw?.symbol || "",
                ),
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
                      symbol={normalizeSignalSymbol(
                        activePlan?.symbol || activePlan?.raw?.symbol || "",
                      )}
                      interval={timeframe}
                      analysisSnapshot={effectiveChartSnapshot}
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
                pending: analyzing,
                pendingText: hasResponse
                  ? "Refreshing analysis result..."
                  : "Analyzing screenshots...",
                label: "Response",
                tab: responseTab,
                onTabChange: setResponseTab,
                text: responseText,
                raw: effectiveParsed || analysisRaw || analysisJson,
                schemaVersion: String(effectiveParsed?.schema_version || ""),
                bars: JSON.stringify(
                  currentBarsSnapshot || { status: "no_cached_bars" },
                  null,
                  2,
                ),
                tradePlans: analysisTradePlans.map((plan, idx) => ({
                  ...(plan?.raw || {}),
                  __raw_plan: plan?.raw || {},
                  __plan_index: idx,
                  symbol: normalizeSignalSymbol(
                    plan?.raw?.symbol || plan.symbol || "",
                  ),
                  direction: plan?.raw?.direction || plan.direction,
                  entry: getPlanPositionOverride(plan, idx).entry || plan?.raw?.entry_price || plan?.raw?.entry,
                  tp: getPlanPositionOverride(plan, idx).tp || plan?.raw?.take_profit || plan?.raw?.tp,
                  sl: getPlanPositionOverride(plan, idx).sl || plan?.raw?.stop_loss || plan?.raw?.sl,
                  rr: getPlanPositionOverride(plan, idx).rr || plan?.raw?.risk_reward || plan?.raw?.rr,
                  trade_type: getPlanPositionOverride(plan, idx).trade_type || plan?.raw?.order_type || plan?.raw?.type || "limit",
                  note: getPlanPositionOverride(plan, idx).note || plan?.raw?.note || "",
                  strategy: plan?.raw?.strategy || plan.strategy || "",
                  entry_model:
                    plan?.raw?.entry_model ||
                    plan?.raw?.entryModel ||
                    plan.entryModel ||
                    "",
                  skip_recommendation:
                    plan?.raw?.skip_recommendation ||
                    plan?.raw?.position_management?.trade_decision ||
                    plan?.raw?.trade_decision ||
                    plan.skip_recommendation ||
                    "",
                  confidence_level: plan?.raw?.confidence_level || "",
                  risk_level: plan?.raw?.risk_level || plan?.raw?.risk_tier || "",
                  confluence_checklist:
                    plan?.raw?.ai_full_analysis?.confluence_checklists ||
                    plan?.raw?.confluence_checklist ||
                    [],
                  reasons_to_skip:
                    plan?.raw?.reasons_to_skip ||
                    (plan?.raw?.position_management?.skips_reasons
                      ? [{ reason: plan.raw.position_management.skips_reasons, severity: "" }]
                      : plan.reasons_to_skip || []),
                })),
                snapshotFiles: chartFiles,
              }}
              tradePlan={{
                enabled: true,
                signalId: null,
                tradeId: null,
                value: position,
                onChange: updatePositionField,
                showSaveButton: false,
                showAddSignalButton:
                  !autoSavedSignal &&
                  !autoSavedTrades &&
                  !manuallyAddedTrade &&
                  !manuallyAddedSignal,
                showAddTradeButton: !autoSavedTrades && !manuallyAddedTrade,
                showResetButton: true,
                onReset: resetToDefaultBrowser,
                resetLabel: "Back",
                addSignalLabel: "+ Signal",
                addTradeLabel: "+ Trade",
                onAddSignal: (pos, planId = "main") => {
                  const ent = addedEntities[planId];
                  if (ent?.kind === "signal" && ent?.id) {
                    navigate(`/signals/${ent.id}`);
                    return;
                  }
                  addBySelection("signal", pos, planId);
                },
                onAddTrade: (pos, planId = "main") => {
                  const ent = addedEntities[planId];
                  if (ent?.kind === "trade" && ent?.id) {
                    navigate(`/trades/${ent.id}`);
                    return;
                  }
                  addBySelection("trade", pos, planId);
                },
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
          </Suspense>
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
        {(() => {
          const lastAdded = Object.values(addedEntities).pop();
          return lastAdded?.kind === "trade" && lastAdded?.id;
        })() ? (
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button
              type="button"
              className="secondary-button"
              onClick={resetToDefaultBrowser}
            >
              Back
            </button>
            <button
              type="button"
              className="primary-button"
              onClick={() =>
                navigate(`/trades/${Object.values(addedEntities).pop()?.id}`)
              }
            >
              Goto Trade
            </button>
          </div>
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
                  CONFIG
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "guide" ? "active" : ""}`}
                  onClick={() => setSettingsTab("guide")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  GUIDE
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "schema" ? "active" : ""}`}
                  onClick={() => setSettingsTab("schema")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  SCHEMA
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
                  className={`secondary-button ${settingsTab === "strategies" ? "active" : ""}`}
                  onClick={() => setSettingsTab("strategies")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  STRATEGIES
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "json" ? "active" : ""}`}
                  onClick={() => setSettingsTab("json")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Template
                </button>
                <button
                  type="button"
                  className={`secondary-button ${settingsTab === "mapping" ? "active" : ""}`}
                  onClick={() => setSettingsTab("mapping")}
                  style={{ fontSize: 11, padding: "4px 10px" }}
                >
                  Mapping
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
