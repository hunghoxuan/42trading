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
  buildStrategyContext,
  buildJsonConfig,
  buildSchemaString,
} from "./AiPromptBuilder";
import RESPONSE_MAPPING_RAW from "../../../../config/response_mapping.json";

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
  // Handle 2-part filenames: SYMBOL_TF (e.g., EURUSD_15.jpg)
  if (parts.length === 2) {
    const sym = parts[0] || "";
    const tfRaw = (parts[1] || "").toUpperCase();
    // Normalize: "15" → "15m", "D" → "1d", "240" → "4h"
    const tfMap = { D: "1d", W: "1w", M: "1M" };
    let tf = tfMap[tfRaw] || tfRaw;
    if (/^\d+$/.test(tf) && !tf.endsWith("m")) tf = tf + "m";
    if (!sym || !tf) return null;
    const createdAtMs = Date.parse(it?.created_at || "") || Date.now();
    return {
      fileName,
      symbolToken: sanitizeSnapshotFileToken(sym),
      tfToken: tfRaw,
      sessionPrefix: "",
      createdAtMs,
    };
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
  const ep = plan?.execution_plan || {};
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
    ep?.tp1?.price,
    ep?.tp2?.price,
    ep?.tp3?.price,
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
    plan?.multiple_exits?.tp1?.price,
    plan?.multiple_exits?.tp2?.price,
    plan?.multiple_exits?.tp3?.price,
    plan?.multiple_exits?.full_tp?.price,
  ];
}

function planEntryNumber(plan = {}, parsed = {}) {
  const candidates = [
    plan?.execution_plan?.entry?.price,
    plan?.execution_plan?.entry,
    plan?.entry,
    plan?.entry_price,
    parsed?.execution_plan?.entry?.price,
    parsed?.execution_plan?.entry,
    parsed?.entry,
    parsed?.price,
  ];
  for (const c of candidates) {
    const n = parseNum(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return NaN;
}

function planStopLossNumber(plan = {}, parsed = {}) {
  const candidates = [
    plan?.execution_plan?.stop_loss?.price,
    plan?.execution_plan?.stop_loss,
    plan?.sl,
    plan?.stop_loss,
    parsed?.execution_plan?.stop_loss?.price,
    parsed?.execution_plan?.stop_loss,
    parsed?.sl,
    parsed?.stop_loss,
  ];
  for (const c of candidates) {
    const n = parseNum(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return NaN;
}

function planTpLevelNumber(plan = {}, level = 1) {
  const ep = plan?.execution_plan || {};
  if (level === 1) {
    return parseNum(
      ep?.tp1?.price ??
        plan?.tp1 ??
        plan?.tp ??
        plan?.take_profit ??
        plan?.multiple_exits?.tp1?.price ??
        plan?.multiple_exits?.full_tp?.price,
    );
  }
  if (level === 2) {
    return parseNum(
      ep?.tp2?.price ?? plan?.tp2 ?? plan?.multiple_exits?.tp2?.price,
    );
  }
  return parseNum(
    ep?.tp3?.price ??
      plan?.tp3 ??
      plan?.multiple_exits?.tp3?.price ??
      plan?.multiple_exits?.full_tp?.price,
  );
}

function planInvalidationText(plan = {}, parsed = {}) {
  return String(
    plan?.invalidation ||
      plan?.execution_plan?.entry?.invalidation_note ||
      plan?.execution_plan?.stop_loss?.invalidation_note ||
      parsed?.invalidation ||
      "",
  ).trim();
}

function planEntryConditionText(plan = {}) {
  return String(
    plan?.entry_condition ||
      plan?.execution_plan?.entry?.reference ||
      plan?.entry_trigger ||
      plan?.position_management?.entry_trigger ||
      "",
  ).trim();
}

function planExitConditionText(plan = {}) {
  return String(
    plan?.exit_condition ||
      plan?.analysis?.sl_validity?.sl_behind_structure?.invalidation_logic ||
      plan?.mid_trade_invalidation ||
      plan?.position_management?.mid_trade_invalidation ||
      "",
  ).trim();
}

function planOrderTypeText(plan = {}, parsed = {}) {
  return (
    String(
      plan?.order_type ||
        plan?.type ||
        parsed?.order_type ||
        parsed?.type ||
        "limit",
    )
      .trim()
      .toLowerCase() || "limit"
  );
}

function planRiskPctNumber(plan = {}) {
  return parseNum(
    plan?.risk_pct ??
      plan?.risk_percent ??
      plan?.risk_management?.risk_percent ??
      null,
  );
}

function planConfidencePctNumber(plan = {}) {
  return (
    parseNum(plan?.confidence_pct) ??
    parseNum(plan?.risk_management?.confidence_pct) ??
    confidenceLevelToPct(plan?.confidence_level)
  );
}

function planEstimatedBarsNumber(plan = {}) {
  return parseNum(
    plan?.estimated_bars ??
      plan?.estimate_bars_that_entry_happens ??
      plan?.risk_management?.estimated_entry_mins,
  );
}

function getPlanPrimaryTp(plan = {}) {
  const entry = planEntryNumber(plan, {});
  const direction = String(plan?.direction || "")
    .trim()
    .toUpperCase();
  const isBuy = direction === "BUY";
  const isSell = direction === "SELL";
  const isValidTp = (n) => {
    if (!Number.isFinite(n)) return false;
    if (Number.isFinite(entry)) {
      if (isBuy && n <= entry) return false;
      if (isSell && n >= entry) return false;
    }
    return true;
  };
  const primaryCandidates = [
    planTpLevelNumber(plan, 1),
    Array.isArray(plan?.take_profits) && plan.take_profits[0]
      ? (plan.take_profits[0].price ?? plan.take_profits[0])
      : null,
    Array.isArray(plan?.tps) && plan.tps[0]
      ? (plan.tps[0].price ?? plan.tps[0])
      : null,
    plan?.multiple_exits?.tp1?.price,
    plan?.multiple_exits?.tp2?.price,
    plan?.multiple_exits?.tp3?.price,
    plan?.multiple_exits?.full_tp?.price,
    plan?.tp1,
    plan?.tp,
  ];
  for (const candidate of primaryCandidates) {
    const value =
      candidate && typeof candidate === "object" ? candidate.price : candidate;
    const n = parseNum(value);
    if (isValidTp(n)) return n;
  }
  // Fallback: choose first valid TP-like value from any available list.
  for (const candidate of getPlanTpCandidates(plan)) {
    const n = parseNum(
      candidate && typeof candidate === "object" ? candidate.price : candidate,
    );
    if (isValidTp(n)) return n;
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
    plan?.risk_management?.skip_decision ||
    plan?.trade_decision ||
    plan?.position_management?.trade_decision ||
    "";
  return decision === "Proceed" ? "" : String(decision || "");
}

function planSkipReasons(plan = {}) {
  const normalizeReasons = (value) => {
    if (Array.isArray(value)) {
      return value.map((r) => ({
        reason: r?.reason || String(r || ""),
        severity: r?.severity || "",
      }));
    }
    const text = String(value || "").trim();
    return text ? [{ reason: text, severity: "" }] : [];
  };
  const rmReasons = normalizeReasons(plan?.risk_management?.skip_reasons);
  if (rmReasons.length) return rmReasons;
  if (Array.isArray(plan?.skip_reasons)) {
    return plan.skip_reasons.map((r) => ({
      reason: r?.reason || "",
      severity: r?.severity || "",
    }));
  }
  const text = String(
    plan?.position_management?.skips_reasons ||
      plan?.position_management?.skip_reasons ||
      "",
  ).trim();
  return text ? [{ reason: text, severity: "" }] : [];
}

const DEFAULT_TRADE_PLAN_PATHS = ["trade_plan", "analysis_data[].trade_plan"];

function extractByRulePath(root, rulePath) {
  const pathText = String(rulePath || "").trim();
  if (!pathText) return [];
  const steps = pathText
    .split(".")
    .map((s) => s.trim())
    .filter(Boolean);
  let current = [root];
  for (const step of steps) {
    const isArrayStep = step.endsWith("[]");
    const key = isArrayStep ? step.slice(0, -2) : step;
    const next = [];
    for (const node of current) {
      if (!node || typeof node !== "object") continue;
      const value = node[key];
      if (isArrayStep) {
        if (Array.isArray(value)) next.push(...value);
      } else if (value !== undefined && value !== null) {
        next.push(value);
      }
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}

function collectTradePlansByRules(root) {
  const paths = Array.isArray(RESPONSE_MAPPING_RAW?.trade_plan_paths)
    ? RESPONSE_MAPPING_RAW.trade_plan_paths
    : DEFAULT_TRADE_PLAN_PATHS;
  const out = [];
  for (const p of paths) {
    const hits = extractByRulePath(root, p);
    for (const item of hits) {
      if (Array.isArray(item)) {
        for (const x of item) if (x && typeof x === "object") out.push(x);
      } else if (item && typeof item === "object") {
        out.push(item);
      }
    }
  }
  return out;
}

function isCurrentAiTradePlan(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.execution_plan &&
    typeof value.execution_plan === "object" &&
    (value.direction ||
      value.symbol ||
      value.risk_management ||
      value.analysis),
  );
}

function dedupeTradePlans(plans = []) {
  const list = Array.isArray(plans) ? plans : [];
  const seen = new Set();
  const out = [];
  for (const p of list) {
    if (!p || typeof p !== "object") continue;
    const key = [
      String(p.symbol || "")
        .trim()
        .toUpperCase(),
      String(p.direction || p.dir || "")
        .trim()
        .toUpperCase(),
      Number(p.entry ?? p.entry_price ?? NaN),
      Number(p.sl ?? p.stop_loss ?? NaN),
      Number(
        p.tp ?? p.take_profit ?? p.tp3 ?? p.multiple_exits?.tp3?.price ?? NaN,
      ),
      String(p.entry_model || "")
        .trim()
        .toUpperCase(),
      String(p.strategy || "")
        .trim()
        .toUpperCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function planPrimaryTpNumber(plan = {}) {
  return Number(
    plan?.tp ??
      plan?.take_profit ??
      plan?.tp3 ??
      plan?.tp2 ??
      plan?.tp1 ??
      plan?.multiple_exits?.full_tp?.price ??
      plan?.multiple_exits?.tp3?.price ??
      plan?.multiple_exits?.tp2?.price ??
      plan?.multiple_exits?.tp1?.price ??
      NaN,
  );
}

function hasNumericEntrySlTp(plan = {}) {
  const entry = Number(plan?.entry ?? plan?.entry_price ?? NaN);
  const sl = Number(plan?.sl ?? plan?.stop_loss ?? NaN);
  const tp = planPrimaryTpNumber(plan);
  return Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp);
}

function enforceActionableTradePlans(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return payload;
  const out = { ...payload };
  if (!Array.isArray(out.trade_plan)) return out;
  out.trade_plan = dedupeTradePlans(out.trade_plan).map((plan) => {
    if (!plan || typeof plan !== "object") return plan;
    const hasPrices = hasNumericEntrySlTp(plan);
    const decisionRaw = String(
      plan?.skip_recommendation ||
        plan?.trade_decision ||
        plan?.risk_management?.skip_decision ||
        "",
    )
      .trim()
      .toLowerCase();
    const proceeding =
      !decisionRaw ||
      decisionRaw === "proceed" ||
      decisionRaw === "trade" ||
      decisionRaw === "enter";
    if (hasPrices || !proceeding) return plan;
    const reasonText =
      "Missing entry/stop-loss/take-profit in AI response. Auto-marked as Skip.";
    const reasons = Array.isArray(plan?.reasons_to_skip)
      ? [...plan.reasons_to_skip]
      : [];
    if (
      !reasons.some((r) => String(r?.reason || "").includes("Missing entry"))
    ) {
      reasons.push({ reason: reasonText, severity: "warning" });
    }
    return {
      ...plan,
      skip_recommendation: "Skip",
      trade_decision: "Skip",
      reasons_to_skip: reasons,
      risk_management:
        plan?.risk_management && typeof plan.risk_management === "object"
          ? {
              ...plan.risk_management,
              skip_decision: "Skip",
              skip_reasons: plan.risk_management.skip_reasons || reasonText,
            }
          : {
              skip_decision: "Skip",
              skip_reasons: reasonText,
            },
      note: String(plan?.note || "").trim() || reasonText,
    };
  });
  return out;
}

function normalizeAnalysisContract(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return parsed;
  // Unwrap API response wrapper: { ok, model, parsed_json: {...}, ... }
  let unwrapped = parsed;
  if (
    parsed.parsed_json &&
    typeof parsed.parsed_json === "object" &&
    !Array.isArray(parsed.parsed_json) &&
    (parsed.parsed_json.execution_plan ||
      parsed.parsed_json.direction ||
      parsed.parsed_json.symbol ||
      Array.isArray(parsed.parsed_json.trade_plan))
  ) {
    unwrapped = parsed.parsed_json;
  }
  const out = { ...unwrapped };
  if (
    isCurrentAiTradePlan(out) ||
    (Array.isArray(out.trade_plan) && out.trade_plan.some(isCurrentAiTradePlan))
  ) {
    return out;
  }
  const indexedRootPlans = Object.keys(out)
    .filter((k) => /^\d+$/.test(String(k)))
    .map((k) => out[k])
    .filter((x) => x && typeof x === "object" && !Array.isArray(x))
    .filter(
      (x) =>
        x.execution_plan ||
        x.risk_management ||
        x.entry != null ||
        x.entry_price != null ||
        x.stop_loss != null ||
        x.sl != null,
    )
    .map((x) => ({ ...(x || {}) }));
  const mappedPlans = collectTradePlansByRules(out).map((p) => ({
    ...(p || {}),
  }));
  const mergedMappedPlans = [...mappedPlans, ...indexedRootPlans];
  if (
    mergedMappedPlans.length &&
    (!Array.isArray(out.trade_plan) || out.trade_plan.length === 0)
  ) {
    out.trade_plan = mergedMappedPlans;
  }
  if (Array.isArray(out.analyses) && out.analyses.length > 0) {
    const entries = out.analyses.filter((x) => x && typeof x === "object");
    const analysisPlans = entries.flatMap((e) =>
      Array.isArray(e.trade_plan)
        ? e.trade_plan.map((p) => ({
            ...(p || {}),
            symbol: String(p?.symbol || e?.symbol || "").trim(),
          }))
        : [],
    );
    if (analysisPlans.length) {
      const rootPlans = Array.isArray(out.trade_plan)
        ? out.trade_plan
            .filter((p) => p && typeof p === "object")
            .map((p) => ({ ...(p || {}) }))
        : [];
      out.trade_plan = [...rootPlans, ...analysisPlans];
    }
    if (!out.ai_full_analysis) {
      const first = entries[0] || {};
      out.symbol = String(first?.symbol || out?.symbol || "").trim();
      out.ai_full_analysis = {
        htf_context: Array.isArray(first?.htf_context) ? first.htf_context : [],
        ltf_analysis: Array.isArray(first?.ltf_analysis)
          ? first.ltf_analysis
          : [],
        confluence_checklist:
          first?.confluence_checklist &&
          typeof first.confluence_checklist === "object"
            ? first.confluence_checklist
            : {},
      };
    }
  }
  if (Array.isArray(out.symbols) && out.symbols.length > 0) {
    const entries = out.symbols.filter((x) => x && typeof x === "object");
    const symbolPlans = entries.flatMap((e) =>
      Array.isArray(e.trade_plan)
        ? e.trade_plan.map((p) => ({
            ...(p || {}),
            symbol: String(p?.symbol || e?.symbol || "").trim(),
          }))
        : [],
    );
    if (symbolPlans.length) {
      const rootPlans = Array.isArray(out.trade_plan)
        ? out.trade_plan
            .filter((p) => p && typeof p === "object")
            .map((p) => ({ ...(p || {}) }))
        : [];
      out.trade_plan = [...rootPlans, ...symbolPlans];
    }
    if (!out.ai_full_analysis) {
      const first = entries[0] || {};
      out.symbol = String(first?.symbol || out?.symbol || "").trim();
      out.ai_full_analysis = {
        htf_context: Array.isArray(first?.htf_context) ? first.htf_context : [],
        ltf_analysis: Array.isArray(first?.ltf_analysis)
          ? first.ltf_analysis
          : [],
        confluence_checklist:
          first?.confluence_checklist &&
          typeof first.confluence_checklist === "object"
            ? first.confluence_checklist
            : {},
      };
    }
  }
  if (Array.isArray(out.analysis_data) && out.analysis_data.length > 0) {
    const entries = out.analysis_data.filter((x) => x && typeof x === "object");
    const nestedPlans = entries.flatMap((e) =>
      Array.isArray(e.trade_plan)
        ? e.trade_plan.map((p) => ({
            ...(p || {}),
            symbol: String(p?.symbol || e?.symbol || "").trim(),
          }))
        : [],
    );
    const rootPlans = Array.isArray(out.trade_plan)
      ? out.trade_plan
          .filter((p) => p && typeof p === "object")
          .map((p) => ({ ...(p || {}) }))
      : [];
    const first = entries[0] || {};
    const mtf =
      first?.multi_timeframes_analysis &&
      typeof first.multi_timeframes_analysis === "object"
        ? first.multi_timeframes_analysis
        : {};
    out.symbol = String(first?.symbol || out?.symbol || "").trim();
    out.ai_full_analysis = mtf;
    out.trade_plan = [...rootPlans, ...nestedPlans];
  }
  if (
    !out.ai_full_analysis &&
    Array.isArray(out.trade_plan) &&
    !out.market_analysis
  ) {
    out.trade_plan = out.trade_plan.map((x) => ({
      symbol: String(x?.symbol || out?.symbol || "").trim(),
      direction: x?.direction || x?.dir || "",
      profile: x?.profile || "",
      type: x?.order_type || x?.type || "",
      session_entry: x?.session || "",
      strategy: x?.strategy || "",
      entry_model: x?.entry_model || "",
      entry: planEntryNumber(x, out),
      sl: planStopLossNumber(x, out),
      be_trigger:
        x?.execution_plan?.breakeven_trigger?.price ??
        x?.breakeven_trigger ??
        x?.be ??
        null,
      tp: getPlanPrimaryTp(x),
      tp2: planTpLevelNumber(x, 2),
      tp3: planTpLevelNumber(x, 3),
      estimated_bars: planEstimatedBarsNumber(x),
      rr: x?.execution_plan?.risk_reward ?? x?.risk_reward ?? x?.rr ?? null,
      risk_pct: planRiskPctNumber(x),
      partial_tps: planPartialTps(x),
      confidence_pct: planConfidencePctNumber(x),
      skip_recommendation: planDecisionText(x),
      reasons_to_skip: planSkipReasons(x),
      entry_condition: planEntryConditionText(x),
      exit_condition: planExitConditionText(x),
      invalidation: planInvalidationText(x, out),
      note: x?.execution_plan?.tp3?.note || x?.note || "",
    }));
    return enforceActionableTradePlans(out);
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
        symbol: String(x?.symbol || out?.symbol || "").trim(),
        direction: x?.direction || x?.dir || "",
        profile: x?.profile || "",
        type: x?.order_type || x?.type || "",
        session_entry: x?.session || "",
        strategy: x?.strategy || "",
        entry_model: x?.entry_model || "",
        entry: planEntryNumber(x, out),
        sl: planStopLossNumber(x, out),
        be_trigger:
          x?.execution_plan?.breakeven_trigger?.price ??
          x?.breakeven_trigger ??
          x?.be ??
          null,
        tp: getPlanPrimaryTp(x),
        tp2: planTpLevelNumber(x, 2),
        tp3: planTpLevelNumber(x, 3),
        estimated_bars: planEstimatedBarsNumber(x),
        risk_pct: planRiskPctNumber(x),
        rr: x?.execution_plan?.risk_reward ?? x?.risk_reward ?? x?.rr ?? null,
        partial_tps: planPartialTps(x),
        confluence_checklist: Array.isArray(x?.confluence_checklist)
          ? x.confluence_checklist
          : [],
        reasons_to_skip: planSkipReasons(x),
        skip_recommendation: planDecisionText(x),
        entry_condition: planEntryConditionText(x),
        exit_condition: planExitConditionText(x),
        risk_management:
          x?.grade === "A" ? "normal" : x?.grade === "B" ? "low" : "high",
        invalidation: planInvalidationText(x, out),
        confidence_pct:
          planConfidencePctNumber(x) ??
          x?.confluence_score ??
          confidenceLevelToPct(x?.confidence_level),
        note: x?.execution_plan?.tp3?.note || x?.note || "",
      }));
    }
    delete out.ai_full_analysis;
    return enforceActionableTradePlans(out);
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
      symbol: String(x?.symbol || out?.symbol || "").trim(),
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
  if (Array.isArray(out.trade_plan)) {
    out.trade_plan = dedupeTradePlans(out.trade_plan);
  }
  return enforceActionableTradePlans(out);
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

const LOOKBACK_PRESET_SECONDS = {
  "1w": 7 * 24 * 60 * 60,
  "2w": 14 * 24 * 60 * 60,
  "1mo": 30 * 24 * 60 * 60,
};

function resolveLookbackBarsValue(lookbackRaw, tfRaw = "15m") {
  const raw = String(lookbackRaw || "1200")
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(raw)) {
    const n = Number(raw);
    return Math.max(50, Math.min(5000, Number.isFinite(n) ? n : 1200));
  }
  const sec = LOOKBACK_PRESET_SECONDS[raw];
  if (!Number.isFinite(sec) || sec <= 0) return 1200;
  const tfSec = Math.max(60, tfToSeconds(tfRaw));
  return Math.max(50, Math.min(5000, Math.ceil(sec / tfSec)));
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
  const directionRaw = String(
    plan.direction ||
      plan?.execution_plan?.direction ||
      parsed?.direction ||
      parsed?.execution_plan?.direction ||
      "",
  )
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
  const entry = planEntryNumber(plan, parsed);
  const sl = planStopLossNumber(plan, parsed);
  console.log(
    "[extractPositionFromAnalysis] plan keys:",
    JSON.stringify(Object.keys(plan || {})),
  );
  console.log(
    "[extractPositionFromAnalysis] plan.execution_plan:",
    JSON.stringify(plan?.execution_plan || null)?.slice(0, 300) || "null",
  );
  console.log(
    "[extractPositionFromAnalysis] plan.entry:",
    plan?.entry,
    "plan.entry_price:",
    plan?.entry_price,
    "plan.direction:",
    plan?.direction,
  );
  console.log(
    "[extractPositionFromAnalysis] resolved entry:",
    entry,
    "sl:",
    sl,
    "direction:",
    direction,
  );
  const planTp = getPlanPrimaryTp(plan);
  const tp = Number.isFinite(planTp)
    ? planTp
    : parseNum(parsed?.tp ?? parsed?.take_profit);
  const rrRaw = parseNum(plan.rr ?? plan.risk_reward ?? parsed?.rr);
  let rr = null;
  if (Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp)) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk > 0 && reward > 0) rr = Number((reward / risk).toFixed(2));
  }
  if (!Number.isFinite(rr)) rr = Number.isFinite(rrRaw) ? rrRaw : null;
  return {
    direction: direction || "BUY",
    entry: Number.isFinite(entry) ? formatNum3(entry) : "",
    tp: Number.isFinite(tp) ? formatNum3(tp) : "",
    sl: Number.isFinite(sl) ? formatNum3(sl) : "",
    rr: Number.isFinite(rr) ? formatNum3(rr) : "",
    trade_type: planOrderTypeText(plan, parsed),
    note: String(
      plan?.execution_plan?.tp3?.note || plan?.note || parsed?.note || "",
    ).trim(),
    tp2: Number.isFinite(planTpLevelNumber(plan, 2))
      ? formatNum3(planTpLevelNumber(plan, 2))
      : "",
    tp3: Number.isFinite(planTpLevelNumber(plan, 3))
      ? formatNum3(planTpLevelNumber(plan, 3))
      : "",
    be_trigger: Number.isFinite(
      parseNum(
        plan?.execution_plan?.breakeven_trigger?.price ??
          plan?.be_trigger ??
          plan?.be,
      ),
    )
      ? formatNum3(
          parseNum(
            plan?.execution_plan?.breakeven_trigger?.price ??
              plan?.be_trigger ??
              plan?.be,
          ),
        )
      : "",
    confidence_pct: Number.isFinite(planConfidencePctNumber(plan))
      ? planConfidencePctNumber(plan)
      : "",
    risk_pct: Number.isFinite(planRiskPctNumber(plan))
      ? planRiskPctNumber(plan)
      : "",
    estimated_bars: Number.isFinite(planEstimatedBarsNumber(plan))
      ? planEstimatedBarsNumber(plan)
      : "",
    invalidation: planInvalidationText(plan, parsed),
    entry_model: String(plan?.entry_model || parsed?.entry_model || "").trim(),
    strategy: String(plan?.strategy || parsed?.strategy || "").trim(),
    profile: String(plan?.profile || parsed?.profile || "").trim(),
    entry_condition: planEntryConditionText(plan),
    exit_condition: planExitConditionText(plan),
    skip_recommendation: String(
      plan?.skip_recommendation ||
        plan?.position_management?.trade_decision ||
        "",
    ).trim(),
    risk_management: String(
      plan?.risk_management?.grade || plan?.risk_management || "",
    ).trim(),
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
      : isCurrentAiTradePlan(parsed)
        ? [parsed]
        : [];
  if (!plans.length) return false;
  return plans.some((p) => {
    const entry = planEntryNumber(p, parsed || {});
    const sl = planStopLossNumber(p, parsed || {});
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
  const directionRaw = String(
    item.direction ||
      item?.execution_plan?.direction ||
      parsed?.direction ||
      parsed?.execution_plan?.direction ||
      "",
  )
    .trim()
    .toUpperCase();
  const direction =
    directionRaw.includes("SELL") || directionRaw.includes("SHORT")
      ? "SELL"
      : directionRaw.includes("BUY") || directionRaw.includes("LONG")
        ? "BUY"
        : "BUY";
  const entry = planEntryNumber(item, parsed);
  const sl = planStopLossNumber(item, parsed);
  const planTp = getPlanPrimaryTp(item);
  const tp = Number.isFinite(planTp)
    ? planTp
    : parseNum(parsed?.tp ?? parsed?.take_profit);
  const rrRaw = parseNum(item.rr ?? item.risk_reward ?? parsed?.rr);
  let rr = null;
  if (Number.isFinite(entry) && Number.isFinite(sl) && Number.isFinite(tp)) {
    const risk = Math.abs(entry - sl);
    const reward = Math.abs(tp - entry);
    if (risk > 0 && reward > 0) rr = Number((reward / risk).toFixed(2));
  }
  if (!Number.isFinite(rr)) rr = Number.isFinite(rrRaw) ? rrRaw : null;
  return {
    direction,
    entry: Number.isFinite(entry) ? formatNum3(entry) : "",
    tp: Number.isFinite(tp) ? formatNum3(tp) : "",
    sl: Number.isFinite(sl) ? formatNum3(sl) : "",
    rr: Number.isFinite(rr) ? formatNum3(rr) : "",
    trade_type: planOrderTypeText(item, parsed),
    note: String(
      item?.execution_plan?.tp3?.note || item?.note || parsed?.note || "",
    ).trim(),
    tp2: Number.isFinite(planTpLevelNumber(item, 2))
      ? formatNum3(planTpLevelNumber(item, 2))
      : "",
    tp3: Number.isFinite(planTpLevelNumber(item, 3))
      ? formatNum3(planTpLevelNumber(item, 3))
      : "",
    be_trigger: Number.isFinite(
      parseNum(
        item?.execution_plan?.breakeven_trigger?.price ??
          item?.be_trigger ??
          item?.be,
      ),
    )
      ? formatNum3(
          parseNum(
            item?.execution_plan?.breakeven_trigger?.price ??
              item?.be_trigger ??
              item?.be,
          ),
        )
      : "",
    confidence_pct: Number.isFinite(planConfidencePctNumber(item))
      ? planConfidencePctNumber(item)
      : "",
    risk_pct: Number.isFinite(planRiskPctNumber(item))
      ? planRiskPctNumber(item)
      : "",
    estimated_bars: Number.isFinite(planEstimatedBarsNumber(item))
      ? planEstimatedBarsNumber(item)
      : "",
    invalidation: planInvalidationText(item, parsed),
    entry_model: String(item?.entry_model || parsed?.entry_model || "").trim(),
    strategy: String(item?.strategy || parsed?.strategy || "").trim(),
    profile: String(item?.profile || parsed?.profile || "").trim(),
    entry_condition: planEntryConditionText(item),
    exit_condition: planExitConditionText(item),
    skip_recommendation: String(
      item?.skip_recommendation ||
        item?.position_management?.trade_decision ||
        "",
    ).trim(),
    risk_management: String(
      item?.risk_management?.grade || item?.risk_management || "",
    ).trim(),
    confluence_checklist: Array.isArray(item?.confluence_checklist)
      ? item.confluence_checklist
      : [],
    partial_tps: Array.isArray(item?.partial_tps) ? item.partial_tps : [],
  };
}

function buildPerSymbolRawJson(parsed = {}, symbol = "", plan = null) {
  const sym = normalizeSignalSymbol(symbol || "");
  if (!parsed || typeof parsed !== "object") return {};
  if (isCurrentAiTradePlan(parsed)) {
    return { ...parsed };
  }
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
  if (!selected.length && plans.some(isCurrentAiTradePlan)) {
    cloned.trade_plan = plans;
    return cloned;
  }
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
  const tryDecode = (value) => {
    let cur = value;
    for (let i = 0; i < 3; i += 1) {
      if (cur && typeof cur === "object") return cur;
      if (typeof cur !== "string") return null;
      const trimmed = cur.trim();
      if (!trimmed) return null;
      try {
        cur = JSON.parse(trimmed);
      } catch {
        return null;
      }
    }
    return cur && typeof cur === "object" ? cur : null;
  };
  const direct = tryDecode(textRaw);
  if (direct) return direct;
  const candidate = extractJsonCandidate(textRaw);
  if (!candidate) return null;
  try {
    const decoded = tryDecode(candidate);
    if (decoded) return decoded;
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
      const decoded = tryDecode(repaired);
      if (decoded) return decoded;
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function recoverTradePlansFromRaw(rawText) {
  const raw = String(rawText || "");
  let clean = raw.trim();
  // Strip markdown
  if (clean.includes("```")) {
    const m = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (m) clean = m[1];
  }
  clean = clean
    .replace(/^```json/, "")
    .replace(/```$/, "")
    .trim();
  // Unescape JSON-string-wrapped responses
  if (clean.startsWith('"') && clean.endsWith('"') && clean.length > 2) {
    clean = clean
      .slice(1, -1)
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
      .trim();
  }
  if (!clean) return [];

  const extractBalancedArray = (text, startIdx) => {
    let depth = 0,
      inString = false,
      escaped = false;
    for (let i = startIdx; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          continue;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "[") {
        depth++;
        continue;
      }
      if (ch === "]") {
        if (depth > 0) depth--;
        if (depth === 0) return text.slice(startIdx, i + 1);
      }
    }
    return "";
  };

  const out = [];
  const seen = new Set();
  const symbolRe = /"symbol"\s*:\s*"([^"]+)"/g;
  let m;
  while ((m = symbolRe.exec(clean)) !== null) {
    const sym = String(m[1] || "")
      .trim()
      .toUpperCase();
    if (!sym) continue;
    const lookahead = clean.slice(
      m.index,
      Math.min(clean.length, m.index + 20000),
    );
    const tpIdx = lookahead.search(/"trade_plan"\s*:/);
    if (tpIdx < 0) continue;
    const bracketIdx = clean.indexOf("[", m.index + tpIdx);
    if (bracketIdx < 0) continue;
    const arrText = extractBalancedArray(clean, bracketIdx);
    let arr = null;
    if (arrText) {
      try {
        arr = JSON.parse(arrText);
      } catch (_) {
        arr = null;
      }
    }
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (!p || typeof p !== "object") continue;
      const plan = { ...p };
      if (!plan.symbol) plan.symbol = sym;
      const key = JSON.stringify([
        String(plan.symbol || "").toUpperCase(),
        String(plan.trade_id || ""),
        Number(plan.entry_price ?? plan.entry ?? NaN),
        Number(plan.stop_loss ?? plan.sl ?? NaN),
        Number(
          plan.tp ??
            plan.take_profit ??
            plan.tp3 ??
            plan.tp2 ??
            plan.tp1 ??
            plan.multiple_exits?.tp1?.price ??
            NaN,
        ),
      ]);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(plan);
    }
  }
  return out;
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
  const normalized = normalizeAnalysisContract(parsed);

  // If parsed is null or not an object/array, use fallback
  if (!normalized || typeof normalized !== "object") {
    return fallback;
  }

  let res = {};

  // Case 1: AI returned an array of trade plans directly
  if (Array.isArray(normalized)) {
    res = {
      ...fallback,
      trade_plan: normalized,
    };
  } else {
    // Case 2: AI returned a full object
    res = { ...normalized };

    // Ensure trade_plan is an array if it's a single object
    if (res.trade_plan && !Array.isArray(res.trade_plan)) {
      res.trade_plan = [res.trade_plan];
    }
    // Wrap the result itself as trade_plan when it IS a trade plan (has execution_plan)
    if (!res.trade_plan && isCurrentAiTradePlan(res)) {
      res.trade_plan = [res];
    }
  }

  // Merge market_analysis from fallback if missing in res
  if (!res.market_analysis && fallback.market_analysis) {
    res.market_analysis = fallback.market_analysis;
  }

  // Merge symbol/profile if missing
  //   if (!res.symbol && fallback.symbol) res.symbol = fallback.symbol;
  //   if (!res.profile && fallback.profile) res.profile = fallback.profile;

  // Always try raw-text recovery — tryParseJsonLoose may return bad data
  if (rawText && rawText.includes('"trade_plan"')) {
    const recovered = recoverTradePlansFromRaw(rawText);
    if (recovered.length) {
      // Prefer recovered plans if they have valid prices or more entries
      const existingValid = (
        Array.isArray(res.trade_plan) ? res.trade_plan : []
      ).filter(
        (p) => p && !String(p.entry_model || "").includes("No valid setup"),
      );
      const recoveredValid = recovered.filter(
        (p) =>
          p &&
          (Number(p.entry_price ?? p.entry) > 0 ||
            Number(p.stop_loss ?? p.sl) > 0),
      );
      if (
        recoveredValid.length >= existingValid.length ||
        !existingValid.length
      ) {
        res.trade_plan = recovered;
      }
    }
  }

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
      const entry = planEntryNumber(s, fallback);
      const sl = planStopLossNumber(s, fallback);
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
        order_type: planOrderTypeText(s, fallback),
        note: typeof s?.note === "string" ? s.note : "",
        source,
        strategy,
        rr: parseNum(s?.execution_plan?.risk_reward ?? s?.rr ?? s?.risk_reward),
        risk_pct: planRiskPctNumber(s),
        grade: String(s?.risk_management?.grade || s?.grade || "").trim(),
        profile: String(s?.profile || parsed?.profile || "").trim(),
        confidence_pct: planConfidencePctNumber(s),
        invalidation: planInvalidationText(s, parsed),
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

function buildDefaultPosition(seedEntry = null) {
  const entryNum = Number(seedEntry);
  if (Number.isFinite(entryNum) && entryNum > 0) {
    const slNum = entryNum * 0.995;
    const tpNum = entryNum * 1.01;
    const rrNum = Math.abs(tpNum - entryNum) / Math.abs(entryNum - slNum);
    return {
      direction: "BUY",
      entry: formatNum3(entryNum),
      tp: formatNum3(tpNum),
      sl: formatNum3(slNum),
      rr: Number.isFinite(rrNum) ? formatNum3(rrNum) : "2",
      trade_type: "limit",
      note: "",
    };
  }
  return {
    direction: "BUY",
    entry: "0",
    tp: "0",
    sl: "0",
    rr: "",
    trade_type: "limit",
    note: "",
  };
}

export default function ChartSnapshotsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { symbol: paramSymbol } = useParams();
  const [cfg, setCfg] = useState(DEFAULT_CONFIG);

  // Load ANALYSE_SETTINGS from user_settings on mount
  useEffect(() => {
    api
      .getSettings()
      .then((res) => {
        const s = (res?.settings || []).find(
          (x) => x.type === "settings" && x.name === "ANALYSE_SETTINGS",
        );
        if (s?.data && typeof s.data === "object") {
          console.log("[ANALYSE_SETTINGS] Loaded from DB:", s.data);
          setCfg((prev) => ({ ...prev, ...s.data }));
        }
      })
      .catch(() => {});
  }, []);

  const saveSettings = useCallback(() => {
    console.log("[ANALYSE_SETTINGS] Saving:", {
      lookbackBars: cfg.lookbackBars,
      snapshotQuality: cfg.snapshotQuality,
      mergeSnapshots: cfg.mergeSnapshots,
    });
    api
      .upsertSetting({
        type: "settings",
        name: "ANALYSE_SETTINGS",
        data: {
          lookbackBars: cfg.lookbackBars,
          snapshotQuality: cfg.snapshotQuality,
          mergeSnapshots: cfg.mergeSnapshots,
        },
      })
      .then(() => {
        setActionStatus({ action: "save", type: "success", text: "Saved" });
        showToast({ message: "Settings saved", type: "success" });
        setTimeout(
          () => setActionStatus({ action: "", type: "", text: "" }),
          2000,
        );
      })
      .catch((e) => {
        const msg = e?.message || "Save failed";
        setActionStatus({ action: "save", type: "error", text: msg });
        showToast({ message: msg, type: "error" });
      });
  }, [cfg.lookbackBars, cfg.snapshotQuality, cfg.mergeSnapshots]);

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
        models: [
          { value: "openai/gpt-4o", label: "GPT-4o" },
          { value: "openai/gpt-4.1", label: "GPT-4.1" },
          { value: "openai/o3-mini", label: "o3 Mini" },
          {
            value: "anthropic/claude-sonnet-4-20250514",
            label: "Claude Sonnet 4",
          },
          { value: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
          { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
          { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
          { value: "deepseek/deepseek-chat", label: "DeepSeek V3" },
          { value: "deepseek/deepseek-r1", label: "DeepSeek R1" },
          { value: "meta-llama/llama-4-maverick", label: "Llama 4 Maverick" },
          { value: "qwen/qwen3-235b-a22b", label: "Qwen3 235B" },
        ],
      },
    },
  }));
  const [browserTf, setBrowserTf] = useState("4h");
  const [browserTfs, setBrowserTfs] = useState(["4h"]);
  const dragWatchSymbolRef = useRef("");
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
  function buildAiAnalyzeRoute(symbols = []) {
    const list = (Array.isArray(symbols) ? symbols : [])
      .map((x) => normalizeWatchSymbol(x))
      .filter(Boolean);
    if (!list.length) return "/ai/analyze";
    const slug = list.join("-");
    return `/ai/analyze/${encodeURIComponent(slug)}`;
  }
  function buildAiTradeRoute(symbols = []) {
    const list = (Array.isArray(symbols) ? symbols : [])
      .map((x) => normalizeWatchSymbol(x))
      .filter(Boolean);
    if (!list.length) return "/ai/trade";
    const slug = list.join("-");
    return `/ai/trade/${encodeURIComponent(slug)}`;
  }

  const [selectedFiles, setSelectedFiles] = useState(new Set());
  const [watchlist, setWatchlist] = useState([]);
  const [isSymbolPanelOpen, setIsSymbolPanelOpen] = useState(true);
  const [symbolFilterTab, setSymbolFilterTab] = useState("FAVOURITE");
  const [tradeSymbolsByStatus, setTradeSymbolsByStatus] = useState({
    pending: [],
    filled: [],
  });
  const [tradeRowsByStatus, setTradeRowsByStatus] = useState({
    pending: [],
    filled: [],
  });
  const [tradeSymbolsLoading, setTradeSymbolsLoading] = useState(false);
  const [analysisFilesDisplay, setAnalysisFilesDisplay] = useState([]);
  const [autoSaveResult, setAutoSaveResult] = useState(null);
  const [analyzeSessionId, setAnalyzeSessionId] = useState(null);
  const [manualAddedMode, setManualAddedMode] = useState("");
  const [addedEntities, setAddedEntities] = useState({});
  const [position, setPosition] = useState(buildDefaultPosition(null));
  const [barsCache, setBarsCache] = useState({});
  const [selectedPlanIdx, setSelectedPlanIdx] = useState(0);
  const [planEdits, setPlanEdits] = useState({});
  const [aiContext, setAiContext] = useState(null);
  const [barsLoading, setBarsLoading] = useState(false);
  const [barsStatus, setBarsStatus] = useState({}); // { [tf]: { status: 'cached'|'loading'|'none', time: ... } }
  const [snapshotStatus, setSnapshotStatus] = useState({});
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
  const isResultRoute =
    location.pathname.startsWith("/ai/result") ||
    location.pathname.startsWith("/ai/trade");
  const isTradeRoute = location.pathname.startsWith("/ai/trade");
  const isAnalyzeRoute = location.pathname.startsWith("/ai/analyze");
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
      const parsed = enrichParsedAnalysis(raw, tryParseJsonLoose(raw));
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
    setPosition(buildDefaultPosition(null));
    setResponseTab("chart");
    setUsedFiles([]);
    setAnalysisFilesDisplay([]);
    setActionStatus({ action: "", type: "", text: "" });
    setSessionPrefix("");
    setAiContext(null);
    setAutoSaveResult(null);
    setAnalyzeSessionId(null);
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
    const base = Array.isArray(browserTfs)
      ? browserTfs
          .map((x) =>
            String(x || "")
              .toLowerCase()
              .trim(),
          )
          .filter(Boolean)
      : [];
    const uniq = [...new Set(base)];
    const fallback = ["d", "4h", "15m", "5m", "1m", "w"];
    for (const tf of fallback) {
      if (uniq.length >= 4) break;
      if (!uniq.includes(tf)) uniq.push(tf);
    }
    return uniq.slice(0, 4);
  }, [browserTfs]);
  const normalizedSymbolForBars = useMemo(
    () => normalizeSignalSymbol(tvSymbol || cfg.symbol || ""),
    [tvSymbol, cfg.symbol],
  );
  const currentBarsKey = useMemo(
    () =>
      `${normalizedSymbolForBars}|${timeframe}|${resolveLookbackBarsValue(cfg.lookbackBars, timeframe)}`,
    [normalizedSymbolForBars, timeframe, cfg.lookbackBars],
  );
  const currentBarsSnapshot = barsCache[currentBarsKey] || null;
  const defaultSeedEntry = useMemo(() => {
    const bars = normalizeSnapshotBars(currentBarsSnapshot, timeframe);
    const last =
      Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
    const c = Number(last?.close);
    return Number.isFinite(c) && c > 0 ? c : null;
  }, [currentBarsSnapshot, timeframe]);
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

  const hasAnalyzeResponse = useMemo(
    () =>
      Boolean(
        (analysisRaw || "").trim() ||
        (analysisJson || "").trim() ||
        (analysisParsed &&
          typeof analysisParsed === "object" &&
          Object.keys(analysisParsed).length > 0),
      ),
    [analysisRaw, analysisJson, analysisParsed],
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
  const hasPositionInput = useMemo(() => {
    const fields = [position.entry, position.tp, position.sl];
    return fields.some((v) => String(v ?? "").trim() !== "");
  }, [position.entry, position.tp, position.sl]);
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
  const activeAddedTradeEntity = useMemo(() => {
    const values = Object.values(addedEntities || {});
    return (
      [...values]
        .reverse()
        .find((item) => item?.kind === "trade" && item?.id) || null
    );
  }, [addedEntities]);

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
    setPosition(buildDefaultPosition(defaultSeedEntry));
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
      return arr;
    } catch (e) {
      setStatus({
        type: "error",
        text: String(e?.message || e || "Failed to load snapshots."),
      });
      return items;
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
    const snapshotItems = Array.isArray(opts.items) ? opts.items : items;
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
    const candidates = snapshotItems
      .map(parseSnapshotMeta)
      .filter((x) => x && x.createdAtMs > 0)
      .filter((x) => symbolTokens.has(x.symbolToken))
      .filter(
        (x) => x.tfToken === "MASTER" || targetTfTokens.includes(x.tfToken),
      )
      .filter(
        (x) =>
          !activeSessionPrefix ||
          !x.sessionPrefix ||
          x.sessionPrefix === activeSessionPrefix,
      )
      .filter((x) => isSameDay(x.createdAtMs, nowMs))
      .filter((x) => Math.abs(nowMs - x.createdAtMs) <= 60 * 60 * 1000)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);

    const masterCandidate = candidates.find((c) => c.tfToken === "MASTER");
    const matchedFiles = [];
    if (masterCandidate) {
      matchedFiles.push(masterCandidate.fileName);
    } else {
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
    }
    const matchedByTf = new Map();
    if (masterCandidate) {
      targetTfTokens.forEach((tf) => matchedByTf.set(tf, true));
    } else {
      matchedFiles.forEach((f) => {
        const meta = parseSnapshotMeta({
          file_name: f,
          created_at: new Date().toISOString(),
        });
        if (meta?.tfToken) matchedByTf.set(meta.tfToken, true);
      });
    }
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

  const fetchAllBars = async (symbol, tfs, bars) => {
    const sym = normalizeSignalSymbol(symbol || "");
    if (!sym) return;
    const status = {};
    for (const tf of tfs) {
      status[tf] = { status: "loading" };
    }
    setBarsStatus({ ...status });
    for (const tf of tfs) {
      try {
        const cacheKey = `${sym}|${tf}|${bars}`;
        const cached = barsCache[cacheKey];
        if (cached && cached.bar_end) {
          const age = Date.now() - cached.bar_end * 1000;
          if (age < 300000) {
            // 5 min
            status[tf] = {
              status: "cached",
              time: new Date(cached.bar_end * 1000).toLocaleTimeString(),
            };
            setBarsStatus({ ...status });
            continue;
          }
        }
        const out = await api.chartTwelveCandles(sym, tf, bars, true);
        const snap = out?.snapshot
          ? normalizeSnapshotBars(out.snapshot, tf)
          : null;
        if (snap && snap.bars?.length) {
          setBarsCache((prev) => ({ ...prev, [cacheKey]: snap }));
          status[tf] = {
            status: "cached",
            time: new Date().toLocaleTimeString(),
          };
        } else {
          status[tf] = { status: "none" };
        }
      } catch (_) {
        status[tf] = { status: "none" };
      }
      setBarsStatus({ ...status });
    }
  };

  const fetchAllSnapshots = async (symbol, tfs, sessionPrefix, provider) => {
    const sym = normalizeSignalSymbol(symbol || "");
    if (!sym || !tfs.length) return;
    const status = {};
    for (const tf of tfs) {
      status[tf] = { status: "loading" };
    }
    setSnapshotStatus({ ...status });
    try {
      const { promise: snapPromise } = NotificationHub.track(
        "snapshot",
        { symbol: sym },
        () =>
          api.chartSnapshotCreateBatch({
            symbols: [sym],
            provider: provider || "ICMARKETS",
            session_prefix: sessionPrefix || "",
            tfs,
            lookbackBars: resolveLookbackBarsValue(cfg.lookbackBars, timeframe),
            quality: Number(cfg.snapshotQuality || 80) || 80,
            merge_snapshots: cfg.mergeSnapshots !== false,
          }),
      );
      const batch = await snapPromise;
      const items = Array.isArray(batch?.items) ? batch.items : [];
      const createdNames = items
        .map((x) => String(x?.file_name || ""))
        .filter(Boolean);
      console.log(
        "[Snapshot] S button result:",
        `symbol=${sym}`,
        `created=${createdNames.length} files:`,
        createdNames,
      );
      // Attach notification extra info to the result
      if (!batch._notify_extra) {
        batch._notify_extra = createdNames.length
          ? `📷 ${sym}: ${createdNames.length} new`
          : `📷 ${sym}: 0 new (all cached)`;
      }
      // Check for master snapshot (merge mode)
      const masterItem = items.find((x) => {
        const f = String(x?.file_name || "").toUpperCase();
        return f.includes("_MASTER.");
      });
      if (masterItem) {
        const masterTime = new Date(
          masterItem.created_at || Date.now(),
        ).toLocaleTimeString();
        for (const tf of tfs) {
          status[tf] = { status: "master", time: masterTime };
        }
        setSnapshotStatus({ ...status });
      } else {
        for (const tf of tfs) {
          const found = items.find((x) => {
            const f = String(x?.file_name || "");
            const base = f.replace(/\.(png|jpe?g)$/i, "");
            return (
              base.endsWith(`_${tf}`) || base.endsWith(`_${tf.toUpperCase()}`)
            );
          });
          status[tf] = found
            ? {
                status: "snapshot",
                time: new Date(
                  found.created_at || Date.now(),
                ).toLocaleTimeString(),
              }
            : { status: "none" };
        }
        setSnapshotStatus({ ...status });
      }
      // Refresh snapshot list so resolveRecentSnapshots finds new files
      loadSnapshots().catch(() => {});
    } catch (_) {
      for (const tf of tfs) {
        status[tf] = { status: "none" };
      }
      setSnapshotStatus({ ...status });
    }
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
      const { promise: barsPromise } = NotificationHub.track(
        "twelve_data",
        { symbol: sym, timeframe: tf },
        () => api.chartTwelveCandles(sym, tf, bars, forceRefresh),
      );
      const out = await barsPromise;
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
      const plans = Array.isArray(parsed?.trade_plan)
        ? parsed.trade_plan
        : parsed?.trade_plan && typeof parsed.trade_plan === "object"
          ? [parsed.trade_plan]
          : [];
      if (!plans.length) return false;
      return plans.some((p) => {
        const entry = parseNum(p?.entry ?? p?.entry_price);
        const sl = parseNum(p?.sl ?? p?.stop_loss);
        const tp = getPlanPrimaryTp(p);
        return (
          Number.isFinite(entry) &&
          Number.isFinite(sl) &&
          Number.isFinite(tp) &&
          entry !== 0 &&
          sl !== 0 &&
          tp !== 0
        );
      });
    };
    setAnalyzing(true);
    setStatus({ type: "info", text: "Analyzing screenshots..." });
    setAnalysisFilesDisplay(
      Array.isArray(files) && files.length ? files : analysisFilesDisplay,
    );
    setAutoSaveResult(null);
    setAnalyzeSessionId(null);
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
        bars_count: resolveLookbackBarsValue(cfg.lookbackBars, timeframe),
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
      console.log(
        "[analyzeFiles] files param:",
        files,
        "payload.files:",
        payload.files,
      );
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
                  lookbackBars: resolveLookbackBarsValue(
                    cfg.lookbackBars,
                    timeframe,
                  ),
                  quality: Number(cfg.snapshotQuality || 80) || 80,
                  merge_snapshots: cfg.mergeSnapshots !== false,
                }),
            );
            const batch = await snapPromise;
            const freshFiles = Array.isArray(batch?.items)
              ? batch.items
                  .map((x) => String(x?.file_name || "").trim())
                  .filter(Boolean)
              : [];
            if (!batch._notify_extra) {
              batch._notify_extra = freshFiles.length
                ? `Re-captured ${freshFiles.length} snapshots`
                : "No snapshots captured";
            }
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
            const msg = String(
              firstErr?.message || firstErr || "",
            ).toLowerCase();

            // If Claude file references are stale, retry without them.
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

            // Local robustness: if backend reports no snapshots, pull recent snapshots and retry once.
            if (msg.includes("no snapshots found for analysis")) {
              try {
                const recent = await api.chartSnapshots(80);
                const list = Array.isArray(recent?.items)
                  ? recent.items
                  : Array.isArray(recent?.snapshots)
                    ? recent.snapshots
                    : [];
                const wanted = new Set(
                  activeSymbols
                    .map((s) => normalizeWatchSymbol(s))
                    .filter(Boolean),
                );
                const recentFiles = list
                  .map((x) => String(x?.file_name || x?.name || "").trim())
                  .filter(Boolean)
                  .filter((f) => {
                    const parts = f.split("_");
                    const sym = normalizeWatchSymbol(parts[1] || "");
                    return !wanted.size || wanted.has(sym);
                  })
                  .slice(
                    0,
                    Math.max(4, Math.min(24, activeSymbols.length * 4 || 4)),
                  );
                if (recentFiles.length) {
                  payload.files = recentFiles;
                  payload.context_files = [];
                  payload.use_context_files = false;
                  payload.context_mode = "none";
                  return await api.chartSnapshotsAnalyze(payload);
                }
              } catch {
                // keep original error below
              }
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
      if (out?.session_id) setAnalyzeSessionId(out.session_id);
      const autoMode = String(out?.auto_save_result?.mode || "").toLowerCase();
      if (out?.auto_save_result?.saved) {
        const autoEntity = resolveCreatedId(
          out?.auto_save_result,
          autoMode === "trades" ? "trade" : "signal",
        );
        if (autoEntity)
          setAddedEntities((prev) => ({ ...prev, main: autoEntity }));
        if (
          autoMode === "trades" &&
          autoEntity?.kind === "trade" &&
          autoEntity?.id
        ) {
          const sym = normalizeWatchSymbol(activeSymbol || cfg.symbol || "");
          if (sym) {
            navigate(`/ai/trade/${encodeURIComponent(sym)}`, { replace: true });
          } else {
            navigate(`/trades/${autoEntity.id}`);
          }
        }
      }
      setAnalysisRaw(raw);
      const rawParsed = tryParseJsonLoose(raw);
      // Extract canonical parsed_json from API response wrapper when present
      const canonicalPayload =
        rawParsed?.parsed_json &&
        typeof rawParsed.parsed_json === "object" &&
        !Array.isArray(rawParsed.parsed_json)
          ? rawParsed.parsed_json
          : rawParsed;
      let parsed = enrichParsedAnalysis(raw, canonicalPayload);
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
      showToast({ message: normalized.text, type: "error" });
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
      // Ensure snapshot list is fresh before checking
      const freshItems = await loadSnapshots();
      const hasContext = true; // backend handles context bundle in analyze
      const recent = resolveRecentSnapshots({
        items: freshItems,
        sessionPrefix: activeSessionPrefix,
        symbols: targetSymbols,
      });
      console.log(
        "[analyzeSelected] freshItems count:",
        freshItems?.length,
        "matchedFiles:",
        recent.matchedFiles,
        "targetTfTokens:",
        recent.targetTfTokens,
      );
      const isMasterFile = recent.matchedFiles.some((f) =>
        f.toUpperCase().includes("_MASTER."),
      );
      const expectedFilesMin = isMasterFile
        ? 1
        : Math.max(1, targetSymbols.length) *
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
      showToast({ message: normalized.text, type: "error" });
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
      if (["entry", "tp", "tp2", "tp3", "sl", "rr"].includes(key)) {
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
      if (["entry", "tp", "tp2", "tp3", "sl", "rr"].includes(key)) {
        const parsed = parseNum(next[key]);
        next[key] = Number.isFinite(parsed) ? formatNum3(parsed) : "";
      }
      return next;
    });
  };

  const handlePlanLevelChange = (levelKey, price) => {
    const n = Number(price);
    if (!Number.isFinite(n) || n <= 0) return;
    const v = formatNum3(n);
    if (levelKey === "tp1" || levelKey === "tp") {
      updatePositionField("tp", v);
      return;
    }
    if (levelKey === "tp2") {
      updatePositionField("tp2", v);
      return;
    }
    if (levelKey === "tp3") {
      updatePositionField("tp3", v);
      return;
    }
    if (levelKey === "entry" || levelKey === "sl") {
      updatePositionField(levelKey, v);
    }
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
          sid:
            analyzeSessionId ||
            (() => {
              const s = normalizeSignalSymbol(
                payload.symbol || tvSymbol || cfg.symbol || "",
              );
              const p = String(activeSessionPrefix || "")
                .trim()
                .toUpperCase();
              return s && p ? `${s}_${p}` : undefined;
            })(),
          action: dir === "BUY" || dir === "SELL" ? dir : payload.action,
          entry:
            Number.isFinite(parseNum(activePosition.entry)) &&
            parseNum(activePosition.entry) !== null
              ? parseNum(activePosition.entry)
              : payload.entry,
          tp:
            Number.isFinite(parseNum(activePosition.tp)) &&
            parseNum(activePosition.tp) !== null
              ? parseNum(activePosition.tp)
              : payload.tp,
          tp1:
            Number.isFinite(parseNum(activePosition.tp1)) &&
            parseNum(activePosition.tp1) !== null
              ? parseNum(activePosition.tp1)
              : Number.isFinite(parseNum(payload.tp1))
                ? parseNum(payload.tp1)
                : Number.isFinite(parseNum(payload.tp))
                  ? parseNum(payload.tp)
                  : undefined,
          tp2:
            Number.isFinite(parseNum(activePosition.tp2)) &&
            parseNum(activePosition.tp2) !== null
              ? parseNum(activePosition.tp2)
              : Number.isFinite(parseNum(payload.tp2))
                ? parseNum(payload.tp2)
                : undefined,
          tp3:
            Number.isFinite(parseNum(activePosition.tp3)) &&
            parseNum(activePosition.tp3) !== null
              ? parseNum(activePosition.tp3)
              : Number.isFinite(parseNum(payload.tp3))
                ? parseNum(payload.tp3)
                : undefined,
          tp_targets: [
            Number.isFinite(parseNum(activePosition.tp1))
              ? parseNum(activePosition.tp1)
              : Number.isFinite(parseNum(payload.tp1))
                ? parseNum(payload.tp1)
                : Number.isFinite(parseNum(activePosition.tp))
                  ? parseNum(activePosition.tp)
                  : Number.isFinite(parseNum(payload.tp))
                    ? parseNum(payload.tp)
                    : null,
            Number.isFinite(parseNum(activePosition.tp2))
              ? parseNum(activePosition.tp2)
              : Number.isFinite(parseNum(payload.tp2))
                ? parseNum(payload.tp2)
                : null,
            Number.isFinite(parseNum(activePosition.tp3))
              ? parseNum(activePosition.tp3)
              : Number.isFinite(parseNum(payload.tp3))
                ? parseNum(payload.tp3)
                : null,
          ].filter((v) => Number.isFinite(v)),
          sl:
            Number.isFinite(parseNum(activePosition.sl)) &&
            parseNum(activePosition.sl) !== null
              ? parseNum(activePosition.sl)
              : payload.sl,
          rr:
            Number.isFinite(parseNum(activePosition.rr)) &&
            parseNum(activePosition.rr) !== null
              ? parseNum(activePosition.rr)
              : payload.rr,
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
            () => api.createDraftTrade(finalPayload),
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

  const saveDraftFromEditor = (pos, planId = "main") => {
    addBySelection("signal", pos, planId);
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

  const loadTradeSymbols = async (status) => {
    const statusKey = status === "PENDING" ? "pending" : "filled";
    setTradeSymbolsLoading(true);
    try {
      const queryStatus = status === "PENDING" ? "PENDING" : "OPEN";
      const data = await api.v2Trades({
        execution_status: queryStatus,
        range: "all",
      });
      const items = Array.isArray(data?.items) ? data.items : [];
      const symbols = [
        ...new Set(
          items
            .map((t) => normalizeWatchSymbol(String(t?.symbol || "")))
            .filter(Boolean),
        ),
      ].sort((a, b) => a.localeCompare(b));
      setTradeSymbolsByStatus((prev) => ({ ...prev, [statusKey]: symbols }));
      setTradeRowsByStatus((prev) => ({ ...prev, [statusKey]: items }));
    } catch (err) {
      console.warn(`[tradeSymbols] Load ${status} failed:`, err.message);
      setTradeSymbolsByStatus((prev) => ({ ...prev, [statusKey]: [] }));
      setTradeRowsByStatus((prev) => ({ ...prev, [statusKey]: [] }));
    } finally {
      setTradeSymbolsLoading(false);
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

  const moveWatchlistSymbol = useCallback(
    (fromSymbol, toSymbol) => {
      const from = normalizeWatchSymbol(fromSymbol);
      const to = normalizeWatchSymbol(toSymbol);
      if (!from || !to || from === to) return;
      const current = (Array.isArray(watchlist) ? watchlist : [])
        .map((x) => normalizeWatchSymbol(x))
        .filter(Boolean);
      const fromIdx = current.indexOf(from);
      const toIdx = current.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return;
      const next = [...current];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      setWatchlist(next);
      saveWatchlistToDb(next);
    },
    [watchlist, saveWatchlistToDb],
  );

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
    if (isResultRoute) return;
    const symbols = Array.isArray(cfg?.symbols)
      ? cfg.symbols.map((x) => normalizeWatchSymbol(x)).filter(Boolean)
      : [];
    if (!symbols.length) return;
    const next = buildAiAnalyzeRoute(symbols);
    if (`${location.pathname}${location.search}` !== next) {
      navigate(next, { replace: true });
    }
  }, [
    cfg.symbols,
    isResultRoute,
    location.pathname,
    location.search,
    navigate,
  ]);

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

  useEffect(() => {
    if (!isTradeRoute) return;
    setResponseTab("response");
  }, [isTradeRoute]);

  // Fetch trade symbols when tab changes to PENDING or FILLED
  useEffect(() => {
    if (symbolFilterTab === "PENDING") {
      loadTradeSymbols("PENDING");
    } else if (symbolFilterTab === "FILLED") {
      loadTradeSymbols("FILLED");
    }
  }, [symbolFilterTab]);

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
    console.log(
      "[pos-sync] effect FIRED, effectiveParsed type:",
      typeof effectiveParsed,
      "keys:",
      effectiveParsed ? Object.keys(effectiveParsed).length : 0,
    );
    if (!effectiveParsed || typeof effectiveParsed !== "object") {
      console.log("[pos-sync] skip: effectiveParsed null or not object");
      return;
    }
    const pos = extractPositionFromAnalysis(effectiveParsed);
    console.log(
      "[pos-sync] setting position entry:",
      pos?.entry,
      "sl:",
      pos?.sl,
      "tp:",
      pos?.tp,
    );
    setPosition(pos);
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
            value={buildStrategyContext(cfg.strategies || [])}
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
    setAnalyzeSessionId(null);
    setManualAddedMode("");
    setAddedEntities({});
    setStatus({ type: "success", text: "New analyze session started." });
  };
  const resetToDefaultBrowser = () => {
    resetAnalyzeSession();
    setCfgField("symbol", "");
  };

  const handleChartTrade = useCallback(
    ({ symbol, latestPrice }) => {
      const sym = normalizeWatchSymbol(
        symbol || cfg.symbol || paramSymbol || tvSymbol || "",
      );
      if (!sym) return;
      const entry = Number(latestPrice);
      if (Number.isFinite(entry)) {
        setPosition((prev) => ({ ...prev, entry: String(entry) }));
      }
      setSelectedSymbols([sym]);
      setCfg((prev) => ({ ...prev, symbol: sym, symbols: [sym] }));
      navigate(buildAiTradeRoute([sym]), { replace: false });
    },
    [cfg.symbol, paramSymbol, tvSymbol, navigate],
  );

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
    const plans = isCurrentAiTradePlan(effectiveParsed)
      ? [effectiveParsed]
      : Array.isArray(effectiveParsed?.trade_plan)
        ? effectiveParsed.trade_plan
        : effectiveParsed?.trade_plan &&
            typeof effectiveParsed.trade_plan === "object"
          ? [effectiveParsed.trade_plan]
          : [];
    return plans
      .map((p, idx) => {
        const entry = planEntryNumber(p, effectiveParsed || {});
        const sl = planStopLossNumber(p, effectiveParsed || {});
        const tp = getPlanPrimaryTp(p);
        const rr = parseNum(
          p?.execution_plan?.risk_reward ?? p?.rr ?? p?.risk_reward,
        );
        const hasValidLevels = hasNumericEntrySlTp(p);
        const normalizedDecision = String(
          p?.skip_recommendation ||
            p?.skip ||
            p?.position_management?.trade_decision ||
            p?.trade_decision ||
            "",
        )
          .trim()
          .toLowerCase();
        const forcedSkip =
          !hasValidLevels &&
          (!normalizedDecision ||
            normalizedDecision === "proceed" ||
            normalizedDecision === "trade" ||
            normalizedDecision === "enter");
        const skipReasonText = String(
          p?.position_management?.skips_reasons || "",
        ).trim();
        const missingReason =
          "Missing entry/stop-loss/take-profit in AI response. Auto-marked as Skip.";
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
          trade_type: planOrderTypeText(p, effectiveParsed || {}),
          be_trigger:
            p?.be_trigger ??
            p?.be ??
            p?.execution_plan?.breakeven_trigger?.price ??
            p?.multiple_exits?.break_even?.price ??
            null,
          invalidation: String(
            planInvalidationText(p, effectiveParsed || {}),
          ).trim(),
          confidence_pct: planConfidencePctNumber(p),
          estimated_bars: planEstimatedBarsNumber(p),
          reasons_to_skip: forcedSkip
            ? [{ reason: missingReason, severity: "warning" }]
            : Array.isArray(p?.reasons_to_skip)
              ? p.reasons_to_skip
              : skipReasonText
                ? [{ reason: skipReasonText, severity: "" }]
                : [],
          skip_recommendation: forcedSkip
            ? "Skip"
            : p?.skip_recommendation ||
              p?.skip ||
              p?.position_management?.trade_decision ||
              "",
          trade_decision: forcedSkip
            ? "Skip"
            : String(p?.trade_decision || "").trim(),
          entry_condition: String(planEntryConditionText(p)).trim(),
          exit_condition: String(planExitConditionText(p)).trim(),
          note:
            forcedSkip && !String(p?.note || "").trim()
              ? missingReason
              : String(p?.execution_plan?.tp3?.note || p?.note || "").trim(),
          has_valid_levels: hasValidLevels,
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
      tp2: edit.tp2 ?? base.tp2 ?? "",
      tp3: edit.tp3 ?? base.tp3 ?? "",
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
  const effectiveGridCols = useMemo(
    () =>
      masterGridCols ??
      (selectedSymbols.length === 0 || selectedSymbols.length > 2 ? 4 : 2),
    [masterGridCols, selectedSymbols.length],
  );
  const watchlistNormSet = useMemo(
    () =>
      new Set(
        (Array.isArray(watchlist) ? watchlist : [])
          .map((s) => normalizeWatchSymbol(s))
          .filter(Boolean),
      ),
    [watchlist],
  );

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
    if (!activePlan?.raw) return;
    const parsedPlan = extractPositionFromPlan(
      activePlan.raw,
      effectiveParsed || {},
    );
    const nextEntry = parseNum(parsedPlan?.entry);
    const curEntry = parseNum(position?.entry);
    const nextSl = parseNum(parsedPlan?.sl);
    const curSl = parseNum(position?.sl);
    if (
      (!(Number.isFinite(curEntry) && curEntry > 0) &&
        Number.isFinite(nextEntry) &&
        nextEntry > 0) ||
      (!(Number.isFinite(curSl) && curSl > 0) &&
        Number.isFinite(nextSl) &&
        nextSl > 0)
    ) {
      setPosition((prev) => ({
        ...prev,
        entry:
          Number.isFinite(nextEntry) && nextEntry > 0
            ? parsedPlan.entry
            : prev.entry,
        sl: Number.isFinite(nextSl) && nextSl > 0 ? parsedPlan.sl : prev.sl,
        tp: parsedPlan.tp || prev.tp,
        tp2: parsedPlan.tp2 || prev.tp2,
        tp3: parsedPlan.tp3 || prev.tp3,
      }));
    }
  }, [activePlan, effectiveParsed, position?.entry, position?.sl]);

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
      case "PENDING":
        return tradeSymbolsByStatus.pending;
      case "FILLED":
        return tradeSymbolsByStatus.filled;
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
    tradeSymbolsByStatus,
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
          <div style={{ display: "grid", gap: 6 }}>
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
              <select
                className="secondary-button"
                value={symbolFilterTab}
                onChange={(e) => {
                  setSymbolFilterTab(e.target.value);
                  setVisibleCount(8);
                }}
                style={{
                  flex: 1,
                  padding: "6px 8px",
                  paddingRight: 26,
                  fontSize: 12,
                  height: 34,
                }}
              >
                <option value="FAVOURITE">Watchlist</option>
                <option value="PENDING">Pending</option>
                <option value="FILLED">Filled</option>
                <option value="CRYPTO">Crypto</option>
                <option value="FOREX">Forex</option>
                <option value="COMMODITY">Commodity</option>
                <option value="INDICES">Indices</option>
                <option value="SMT">SMT</option>
              </select>
            </div>
            <div style={{ position: "relative", display: "flex", gap: 4 }}>
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
          </div>
          {isSymbolPanelOpen && (
            <>
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
                          draggable={symbolFilterTab === "FAVOURITE"}
                          onDragStart={() => {
                            dragWatchSymbolRef.current = s;
                          }}
                          onDragOver={(e) => {
                            if (symbolFilterTab !== "FAVOURITE") return;
                            e.preventDefault();
                          }}
                          onDrop={(e) => {
                            if (symbolFilterTab !== "FAVOURITE") return;
                            e.preventDefault();
                            const from = dragWatchSymbolRef.current;
                            moveWatchlistSymbol(from, s);
                            dragWatchSymbolRef.current = "";
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
                          {(() => {
                            const inWatchlist = watchlist.includes(s);
                            return (
                              <>
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
                                    color: inWatchlist
                                      ? "rgba(239,68,68,0.7)"
                                      : "var(--muted)",
                                    borderColor: inWatchlist
                                      ? "rgba(239,68,68,0.35)"
                                      : "rgba(255,255,255,0.08)",
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (inWatchlist) {
                                      removeFromWatchlist(s);
                                    } else {
                                      const next = [
                                        ...new Set([...watchlist, s]),
                                      ];
                                      saveWatchlistToDb(next).then(() =>
                                        setWatchlist(next),
                                      );
                                    }
                                  }}
                                  title={
                                    inWatchlist
                                      ? "Remove " + s + " from watchlist"
                                      : "Add " + s + " to watchlist"
                                  }
                                >
                                  {inWatchlist ? "-" : "+"}
                                </button>
                              </>
                            );
                          })()}
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
            {(symbolFilterTab === "PENDING" ||
              symbolFilterTab === "FILLED") && (
              <div
                className="minor-text"
                style={{
                  padding: "4px 0",
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                {symbolFilterTab === "PENDING"
                  ? "Pending Trades"
                  : "Filled Trades"}{" "}
                (
                {symbolFilterTab === "PENDING"
                  ? tradeRowsByStatus.pending.length
                  : tradeRowsByStatus.filled.length}
                )
              </div>
            )}
            <div
              className="snapshot-activity-list-v4"
              style={{ flex: 1, overflowY: "auto" }}
            >
              {symbolFilterTab === "PENDING" || symbolFilterTab === "FILLED" ? (
                <>
                  {tradeSymbolsLoading ? (
                    <div className="minor-text">Loading trades...</div>
                  ) : (symbolFilterTab === "PENDING"
                      ? tradeRowsByStatus.pending
                      : tradeRowsByStatus.filled
                    ).length === 0 ? (
                    <div className="minor-text">No trades found.</div>
                  ) : (
                    (symbolFilterTab === "PENDING"
                      ? tradeRowsByStatus.pending
                      : tradeRowsByStatus.filled
                    ).map((t) => {
                      const sideRaw = String(
                        t?.action || t?.side || "",
                      ).toUpperCase();
                      const isBuy = sideRaw.includes("BUY");
                      const isSell = sideRaw.includes("SELL");
                      const sideColor = isBuy
                        ? "#24e38f"
                        : isSell
                          ? "#ff5a5a"
                          : "#c8d5e8";
                      const entryNum = Number(t?.entry);
                      const tpNum = Number(t?.tp);
                      const entryTxt = Number.isFinite(entryNum)
                        ? entryNum.toFixed(
                            entryNum >= 100 ? 1 : entryNum >= 10 ? 2 : 4,
                          )
                        : "-";
                      const tpTxt = Number.isFinite(tpNum)
                        ? tpNum.toFixed(tpNum >= 100 ? 1 : tpNum >= 10 ? 2 : 4)
                        : "-";
                      const ref = t?.sid || t?.id || "";
                      return (
                        <article
                          key={ref || `${t?.symbol}_${t?.created_at}`}
                          className="snapshot-activity-card-v4 compact"
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            if (ref) navigate(`/trades/${ref}`);
                          }}
                        >
                          <div className="snapshot-activity-row-top">
                            <span
                              style={{
                                color: sideColor,
                                letterSpacing: 0.2,
                              }}
                            >
                              {normalizeSignalSymbol(String(t?.symbol || ""))}
                            </span>
                            <span style={{ color: sideColor, fontSize: 11 }}>
                              {sideRaw || "-"}
                            </span>
                          </div>
                          <div className="snapshot-activity-row-mid">
                            {entryTxt} → {tpTxt}
                          </div>
                          <div
                            className="minor-text"
                            style={{ fontSize: 9, opacity: 0.6 }}
                          >
                            {showDateTime(t?.created_at)}
                          </div>
                        </article>
                      );
                    })
                  )}
                </>
              ) : (
                <>
                  {symbolActivity.loading ? (
                    <div className="minor-text">Loading...</div>
                  ) : null}
                  {!symbolActivity.loading &&
                  symbolActivity.items.length === 0 ? (
                    <div className="minor-text">No related trades/signals.</div>
                  ) : null}
                  {!symbolActivity.loading &&
                    symbolActivity.items.map((x) => {
                      const pnlNum = Number(x?.pnl);
                      const hasPnl = Number.isFinite(pnlNum);
                      const isSignal =
                        String(x?.kind || "").toUpperCase() === "SIGNAL";
                      const sideText = String(x?.side || "").toUpperCase();
                      const isBuy = sideText.includes("BUY");
                      const isSell = sideText.includes("SELL");
                      const sideColor = isBuy
                        ? "#24e38f"
                        : isSell
                          ? "#ff5a5a"
                          : "#c8d5e8";
                      const pnlText = hasPnl
                        ? `${pnlNum > 0 ? "+" : ""}${Math.round(pnlNum)}`
                        : "0";
                      const entryTxt = Number.isFinite(Number(x?.entry))
                        ? Number(x.entry).toFixed(
                            Number(x.entry) >= 100
                              ? 1
                              : Number(x.entry) >= 10
                                ? 2
                                : 4,
                          )
                        : "-";
                      const tpTxt = Number.isFinite(Number(x?.tp))
                        ? Number(x.tp).toFixed(
                            Number(x.tp) >= 100
                              ? 1
                              : Number(x.tp) >= 10
                                ? 2
                                : 4,
                          )
                        : "-";
                      return (
                        <article
                          key={`${x.kind}_${x.id}`}
                          className="snapshot-activity-card-v4 compact"
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            const ref = x.sid || x.id;
                            const k = String(x.kind || "").toUpperCase();
                            if (k === "TRADE" || k === "trade")
                              navigate(`/trades/${ref}`);
                            else navigate(`/signals/${ref}`);
                          }}
                        >
                          <div className="snapshot-activity-row-top">
                            <span
                              style={{
                                color: sideColor,
                                letterSpacing: 0.2,
                              }}
                            >
                              {String(x.symbol || "").toUpperCase()}
                            </span>
                            {!isSignal ? (
                              <span style={{ color: sideColor }}>
                                {pnlText}
                              </span>
                            ) : (
                              <span />
                            )}
                          </div>
                          <div className="snapshot-activity-row-mid">
                            {entryTxt} → {tpTxt}
                          </div>
                        </article>
                      );
                    })}
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      <section
        className="panel snapshot-col-v3 snapshot-col-settings-v3"
        style={isSymbolPanelOpen ? {} : { gridColumn: "1 / -1" }}
      >
        <div className="fadeIn" style={{ marginBottom: 10 }}>
          <div
            className="TFs-Charts-Header"
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
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
            {selectedSymbol && (
              <>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setCfgField("symbol", "");
                    setSelectedSymbols([]);
                    navigate("/ai/analyze", { replace: false });
                  }}
                  style={{ fontSize: 12, padding: "4px 8px" }}
                >
                  {"< List"}
                </button>
                {isTradeRoute ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      navigate(buildAiAnalyzeRoute([selectedSymbol]), {
                        replace: false,
                      })
                    }
                    style={{ fontSize: 12, padding: "4px 8px" }}
                  >
                    {"< AI"}
                  </button>
                ) : isAnalyzeRoute ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      navigate(buildAiTradeRoute([selectedSymbol]), {
                        replace: false,
                      })
                    }
                    style={{ fontSize: 12, padding: "4px 8px" }}
                  >
                    {"< Trade"}
                  </button>
                ) : null}
              </>
            )}
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
            </div>
            <select
              className="secondary-button"
              value={cfg.lookbackBars || "1200"}
              onChange={(e) => setCfgField("lookbackBars", e.target.value)}
              style={{ height: "30px", padding: "0 6px", fontSize: "11px" }}
              title={`Number of bars (${resolveLookbackBarsValue(cfg.lookbackBars, timeframe)} bars on ${String(timeframe || "15m").toUpperCase()})`}
            >
              {[
                "100",
                "300",
                "600",
                "900",
                "1200",
                "1500",
                "1800",
                "2200",
                "2600",
                "3000",
              ].map((v) => (
                <option key={v} value={v}>
                  {v} bars
                </option>
              ))}
            </select>
            <select
              className="secondary-button"
              value={cfg.snapshotQuality || "80"}
              onChange={(e) => setCfgField("snapshotQuality", e.target.value)}
              style={{ height: "30px", padding: "0 6px", fontSize: "11px" }}
              title="Snapshot image quality"
            >
              {["40", "50", "60", "70", "80", "90", "100"].map((v) => (
                <option key={v} value={v}>
                  Q{v}
                </option>
              ))}
            </select>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                cursor: "pointer",
              }}
              title="Merge all TFs into one master snapshot"
            >
              <input
                type="checkbox"
                checked={cfg.mergeSnapshots !== false}
                onChange={(e) =>
                  setCfgField("mergeSnapshots", e.target.checked)
                }
                style={{ cursor: "pointer" }}
              />
              Merge
            </label>
            <div style={{ display: "flex", gap: 4 }}>
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
                  setMasterGridCols((prev) => Math.max(1, (prev ?? 2) - 1))
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
                  setMasterGridCols((prev) => Math.min(6, (prev ?? 2) + 1))
                }
                title="All: Smaller charts"
              >
                -
              </button>
            </div>
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              {actionStatus.action === "save" && actionStatus.text ? (
                <span
                  className={`minor-text ${actionStatus.type === "error" ? "msg-error" : "msg-success"}`}
                  style={{ fontSize: 10 }}
                >
                  {actionStatus.text}
                </span>
              ) : null}
              <button
                className="secondary-button"
                onClick={saveSettings}
                style={{ height: "30px", padding: "0 8px", fontSize: 11 }}
              >
                Save
              </button>
            </div>
          </div>
        </div>

        {!hasAnalyzeResponse && isAnalyzeRoute && (
          <div className="fadeIn">
            <div
              className="Analyze-component"
              style={{
                marginBottom: 8,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
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
                    gridTemplateColumns:
                      "minmax(140px, auto) auto minmax(120px, 1fr) minmax(140px, 1fr) minmax(130px, 1fr) auto",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
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
                      height: "34px",
                      fontSize: "12px",
                      padding: "0 10px",
                    }}
                  >
                    Settings
                  </button>
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
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      justifyContent: "flex-end",
                      flexWrap: "wrap",
                    }}
                  >
                    {isAnalyzeRoute && (
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
                    )}
                    {isTradeRoute && (
                      <button
                        className="primary-button"
                        type="button"
                        onClick={() => {
                          const sym =
                            paramSymbol || cfg.symbol || selectedSymbol || "";
                          navigate(
                            `/ai/analyze/${encodeURIComponent(sym || "")}`,
                          );
                        }}
                        style={{
                          height: 34,
                          padding: "0 16px",
                          whiteSpace: "nowrap",
                        }}
                      >
                        Analyze
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
            {selectedSymbols.length === 0 || selectedSymbols.length > 2 ? (
              <div
                className="browser-grid-v1"
                style={{
                  ...(symbolFilterTab === "SMT"
                    ? { gridTemplateColumns: "1fr" }
                    : {}),
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
                                    initialGridCols={effectiveGridCols}
                                    initialBarsCount={Number(
                                      cfg.lookbackBars || 300,
                                    )}
                                    showPerCardLayoutControls={false}
                                    analyzeLabel={
                                      normalizeWatchSymbol(sym) ===
                                      normalizeWatchSymbol(cfg.symbol)
                                        ? "Analyze"
                                        : ">"
                                    }
                                    onAnalyze={(s) =>
                                      setCfg((prev) => ({
                                        ...prev,
                                        symbol: s,
                                        symbols: [s],
                                      }))
                                    }
                                    onTrade={handleChartTrade}
                                    showTradeButton={true}
                                    showAnalyzeButton={true}
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
                            initialGridCols={effectiveGridCols}
                            initialBarsCount={Number(cfg.lookbackBars || 300)}
                            showPerCardLayoutControls={false}
                            analyzeLabel={
                              normalizeWatchSymbol(sym) ===
                              normalizeWatchSymbol(cfg.symbol)
                                ? "Analyze"
                                : ">"
                            }
                            onAnalyze={(s) =>
                              setCfg((prev) => ({
                                ...prev,
                                symbol: s,
                                symbols: [s],
                              }))
                            }
                            onTrade={handleChartTrade}
                            showTradeButton={true}
                            showAnalyzeButton={true}
                            isInWatchlist={watchlistNormSet.has(
                              normalizeWatchSymbol(sym),
                            )}
                            isInSelected={selectedSymbols.includes(sym)}
                            onToggleWatchlist={(s) => {
                              const sn = normalizeWatchSymbol(s);
                              const inWatchlist = watchlistNormSet.has(sn);
                              if (inWatchlist) {
                                const existingRaw =
                                  (Array.isArray(watchlist)
                                    ? watchlist
                                    : []
                                  ).find(
                                    (w) => normalizeWatchSymbol(w) === sn,
                                  ) || s;
                                removeFromWatchlist(existingRaw);
                              } else {
                                const next = [...new Set([...watchlist, s])];
                                saveWatchlistToDb(next).then(() =>
                                  setWatchlist(next),
                                );
                              }
                            }}
                            onRemoveSelected={(s) => {
                              setCfg((prev) => {
                                const prevSelected = Array.isArray(
                                  prev?.symbols,
                                )
                                  ? prev.symbols
                                  : [];
                                const nextSelected = prevSelected.filter(
                                  (x) => x !== s,
                                );
                                return {
                                  ...prev,
                                  symbols: nextSelected,
                                  symbol: nextSelected[0] || "",
                                };
                              });
                            }}
                          />
                        </Suspense>
                      ));
                    })()}
              </div>
            ) : null}{" "}
          </div>
        )}

        {(selectedSymbols.length === 0 || selectedSymbols.length > 2) &&
          !hasAnalyzeResponse &&
          !isTradeRoute &&
          selectedSymbol && (
            <div
              className="browser-grid-v1"
              style={{
                gridTemplateColumns: "1fr",
                gap: 12,
                marginBottom: 20,
              }}
            >
              {(selectedSymbols.length
                ? selectedSymbols
                : [selectedSymbol]
              ).map((sym) => (
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
                    initialGridCols={effectiveGridCols}
                    initialBarsCount={Number(cfg.lookbackBars || 300)}
                    showPerCardLayoutControls={false}
                    onAnalyze={() => analyzeSelected()}
                    onTrade={handleChartTrade}
                    showAnalyzeButton={isAnalyzeRoute}
                    showTradeButton={false}
                    showEditButton={!isTradeRoute}
                    onRemove={null}
                  />
                </Suspense>
              ))}
            </div>
          )}

        {selectedSymbol && (
          <Suspense
            fallback={<div className="loading-card">Loading Details...</div>}
          >
            <SignalDetailCard
              mode="ai"
              hideTabsBeforeResponse={!hasAnalyzeResponse}
              chart={{
                enabled: true,
                symbol: normalizeSignalSymbol(
                  activePlan?.symbol ||
                    activePlan?.raw?.symbol ||
                    selectedSymbol ||
                    cfg.symbol ||
                    tvSymbol ||
                    "",
                ),
                interval: timeframe,
                entryPrice: position.entry,
                slPrice: position.sl,
                tpPrice: position.tp,
                tp1Price: position.tp || "",
                tp2Price: position.tp2 || "",
                tp3Price: position.tp3 || "",
                onPlanLevelChange: handlePlanLevelChange,
                detailTfTab: timeframe,
                showEditButton: !(isTradeRoute || hasAnalyzeResponse),
                showTradeButton: !(isTradeRoute || hasAnalyzeResponse),
                showAnalyzeButton: !(isTradeRoute || hasAnalyzeResponse),
                profileTfs: widgetTfs,
                initialGridCols: effectiveGridCols,
                initialBarsCount: Number(cfg.lookbackBars || 300),
                showPerCardLayoutControls: false,
                onDetailTfTabChange: setSelectedEntryTf,
                entryNode: (
                  <div className="snapshot-live-card-v3">
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginBottom: 8,
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      {snapshotTfs.map((tf) => {
                        const s = barsStatus[tf] || {};
                        const icon =
                          s.status === "cached"
                            ? "✅"
                            : s.status === "loading"
                              ? "⏳"
                              : "❌";
                        return (
                          <span
                            key={tf}
                            className="minor-text"
                            style={{
                              fontSize: "10px",
                              padding: "2px 6px",
                              background: "rgba(255,255,255,0.05)",
                              borderRadius: 4,
                            }}
                          >
                            {icon} {tf}{" "}
                            {s.time || (s.status === "none" ? "No cache" : "")}
                          </span>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "10px", padding: "2px 8px" }}
                        onClick={() =>
                          fetchAllBars(
                            cfg.symbol || tvSymbol,
                            snapshotTfs,
                            resolveLookbackBarsValue(
                              cfg.lookbackBars,
                              timeframe,
                            ),
                          )
                        }
                      >
                        📊 Cache
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        style={{ fontSize: "10px", padding: "2px 8px" }}
                        onClick={() =>
                          fetchAllSnapshots(
                            cfg.symbol || tvSymbol,
                            snapshotTfs,
                            sessionPrefix,
                            provider,
                          )
                        }
                      >
                        📷 Snapshot
                      </button>
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
                      tp1Price={position.tp || ""}
                      tp2Price={position.tp2 || ""}
                      tp3Price={position.tp3 || ""}
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
                hasData: hasAnalyzeResponse,
                pending: analyzing,
                pendingText:
                  hasAnalyzeResponse || isTradeRoute
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
                tradePlans: analysisTradePlans.length
                  ? analysisTradePlans.map((plan, idx) => ({
                      __raw_plan: plan?.raw || plan,
                      __plan_index: idx,
                      symbol: normalizeSignalSymbol(
                        plan?.raw?.symbol ||
                          plan.symbol ||
                          selectedSymbol ||
                          cfg.symbol ||
                          tvSymbol ||
                          "",
                      ),
                      direction: plan.direction || plan?.raw?.direction,
                      entry:
                        getPlanPositionOverride(plan, idx).entry ||
                        plan?.raw?.execution_plan?.entry?.price ||
                        plan?.entry ||
                        plan?.raw?.entry_price ||
                        plan?.raw?.entry,
                      tp:
                        getPlanPositionOverride(plan, idx).tp ||
                        (() => {
                          const resolved = getPlanPrimaryTp(plan?.raw || {});
                          return Number.isFinite(resolved)
                            ? formatNum3(resolved)
                            : plan?.raw?.take_profit || plan?.raw?.tp || "";
                        })(),
                      tp2:
                        getPlanPositionOverride(plan, idx).tp2 ||
                        (Number.isFinite(planTpLevelNumber(plan?.raw || {}, 2))
                          ? formatNum3(planTpLevelNumber(plan?.raw || {}, 2))
                          : plan?.raw?.tp2 || ""),
                      tp3:
                        getPlanPositionOverride(plan, idx).tp3 ||
                        (Number.isFinite(planTpLevelNumber(plan?.raw || {}, 3))
                          ? formatNum3(planTpLevelNumber(plan?.raw || {}, 3))
                          : plan?.raw?.tp3 || ""),
                      sl:
                        getPlanPositionOverride(plan, idx).sl ||
                        plan?.raw?.execution_plan?.stop_loss?.price ||
                        plan?.sl ||
                        plan?.raw?.stop_loss ||
                        plan?.raw?.sl,
                      rr:
                        getPlanPositionOverride(plan, idx).rr ||
                        plan?.rr ||
                        plan?.raw?.risk_reward ||
                        plan?.raw?.rr,
                      trade_type:
                        getPlanPositionOverride(plan, idx).trade_type ||
                        plan?.raw?.order_type ||
                        plan?.raw?.type ||
                        "limit",
                      note:
                        getPlanPositionOverride(plan, idx).note ||
                        plan?.raw?.note ||
                        "",
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
                      risk_level:
                        plan?.raw?.risk_level || plan?.raw?.risk_tier || "",
                      confluence_checklist:
                        plan?.raw?.ai_full_analysis?.confluence_checklists ||
                        plan?.raw?.confluence_checklist ||
                        [],
                      reasons_to_skip:
                        plan?.raw?.reasons_to_skip ||
                        (plan?.raw?.position_management?.skips_reasons
                          ? [
                              {
                                reason:
                                  plan.raw.position_management.skips_reasons,
                                severity: "",
                              },
                            ]
                          : plan.reasons_to_skip || []),
                    }))
                  : [
                      {
                        __plan_index: 0,
                        symbol: normalizeSignalSymbol(
                          selectedSymbol || cfg.symbol || tvSymbol || "",
                        ),
                        direction: position.direction || "BUY",
                        entry: position.entry || "",
                        tp: position.tp || "",
                        sl: position.sl || "",
                        rr: position.rr || "",
                        trade_type: position.trade_type || "limit",
                        note: position.note || "",
                      },
                    ],
                snapshotFiles: chartFiles,
                snapshotsUsed:
                  Array.isArray(analysisFilesDisplay) &&
                  analysisFilesDisplay.length
                    ? analysisFilesDisplay
                    : Array.isArray(usedFiles) && usedFiles.length
                      ? usedFiles
                      : chartFiles.length
                        ? chartFiles
                        : [],
              }}
              tradePlan={{
                enabled: isTradeRoute || hasAnalyzeResponse,
                signalId: null,
                tradeId: activeAddedTradeEntity?.id || null,
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
                onReset: isTradeRoute
                  ? () =>
                      navigate(buildAiAnalyzeRoute([selectedSymbol]), {
                        replace: false,
                      })
                  : resetToDefaultBrowser,
                resetLabel: "Back",
                addSignalLabel: "+ Signal",
                saveDraftLabel: "Save Draft",
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
                onSaveDraft: (pos, planId = "main") => {
                  saveDraftFromEditor(pos, planId);
                },
                busy: {
                  signal: addingSignal && submittingPlanId === "main",
                  draft: addingSignal && submittingPlanId === "main",
                  trade: addingSignal && submittingPlanId === "main",
                },
                submittingPlanId: submittingPlanId,
                disabled: false,
                error:
                  !canAddSignal && (hasPositionInput || hasAnalyzeResponse)
                    ? validatePosition(position)
                    : "",
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
