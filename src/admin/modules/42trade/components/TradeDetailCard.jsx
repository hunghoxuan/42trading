import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  lazy,
  Suspense,
} from "react";
import { TradePlanEditor } from "./TradePlanEditor";
import {
  buildHeaderMeta,
  formatNote,
  shouldShowPnl,
  applyLinkedPlanChange,
  formatNum3,
} from "../../../shared/utils/tradeDetailUtils";
const SymbolChart = lazy(() => import("./charts/SymbolChart"));
import { SmartContent } from "../../../shared/components/SmartContent.jsx";
import MobileCollapseSection from "../../../shared/components/MobileCollapseSection";
import TradePriceInline from "./TradePriceInline";
const TradeDraftTab = lazy(() => import("./TradeDraftTab"));
const TradeLogsTab = lazy(() => import("./TradeLogsTab"));
import { sortTimeframes } from "../../../shared/utils/format";
import { mergePlanPreservingEdits } from "../../../shared/utils/tradePlanDrafts";
import { api } from "../../../app/api";
import GroupButtons from "../../../shared/components/GroupButtons";
import TabBar from "../../../shared/components/TabBar";
import { NotificationHub } from "../services/NotificationHub";
import { BrokerTicketBadge } from "./BrokerTicketBadge";
import { StatusBadge } from "../../../shared/components/StatusBadge";
import { isCurrentAiTradePlan } from "../../../shared/utils/tradePlanShape";
import { buildSingleTradeForChart } from "./charts/backtestChartTheme";
import {
  formatTradePrice,
  formatTradePriceField,
  parseTradePriceNumber,
  resolveTradePricePrecision,
} from "../utils/tradePriceFormat";

import {
  DEFAULT_TF_TABS,
} from "../pages/ai/AiPromptBuilder";
import {
  SHARED_TIMEFRAME_PRESET_OPTIONS,
  TIMEFRAME_PICKER_TF_OPTIONS,
} from "./timeframePresetOptions";

const MODE_PRESETS = {
  generic: {
    headerColumns: "minmax(0, 1fr) minmax(0, 1.25fr) minmax(120px, 0.55fr)",
    historyLoadingText: "Fetching logs...",
    historyEmptyText: "No events.",
  },
  ai: {
    headerColumns: "minmax(0, 1fr) minmax(0, 1.25fr) minmax(120px, 0.55fr)",
    historyLoadingText: "Fetching logs...",
    historyEmptyText: "No events.",
  },
  signal: {
    headerColumns: "minmax(0, 1fr) minmax(0, 1.25fr) minmax(120px, 0.55fr)",
    historyLoadingText: "Fetching telemetry logs...",
    historyEmptyText: "No trade events.",
  },
  trade: {
    headerColumns: "minmax(0, 1fr) minmax(0, 1.25fr) minmax(120px, 0.55fr)",
    historyLoadingText: "Fetching execution logs...",
    historyEmptyText: "No trade events.",
  },
};

const HASH_TO_CHART_MODE = {
  chart: "live",
  "chart-live": "live",
  "chart-static": "cache",
  "chart-analysis": "cache",
  "chart-svg": "svg",
  "chart-replay": "replay",
};
const REPLAY_SPEED_OPTIONS = [
  { value: 100, label: "0.1s" },
  { value: 200, label: "0.2s" },
  { value: 500, label: "0.5s" },
  { value: 1000, label: "1s" },
  { value: 2000, label: "2s" },
  { value: 5000, label: "5s" },
];

const TRADE_CHART_TF_PRESET_OPTIONS = SHARED_TIMEFRAME_PRESET_OPTIONS;
const TRADE_CHART_INDIVIDUAL_TF_OPTIONS = TIMEFRAME_PICKER_TF_OPTIONS;

function firstObject(...values) {
  for (const value of values) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value;
    }
  }
  return {};
}

function isTerminalTradeChartStatus(status) {
  const key = String(status || "").trim().toUpperCase();
  return [
    "CLOSED",
    "TP",
    "SL",
    "WIN",
    "LOSS",
    "PROFIT",
    "STOPPED",
    "REJECTED",
    "CANCELLED",
    "EXPIRED",
    "MANUAL",
    "MANUAL_CLOSE",
    "CLOSE_MANUAL",
    "BREAKEVEN",
    "BREAK_EVEN",
    "BE",
  ].includes(key);
}

function resolveTradeChartStatus(...values) {
  const normalized = values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const specificTerminal = normalized.find((value) => {
    if (!isTerminalTradeChartStatus(value)) return false;
    const key = String(value).trim().toUpperCase();
    return !["CLOSED", "CANCELLED", "REJECTED", "EXPIRED"].includes(key);
  });
  const terminal = normalized.find((value) => isTerminalTradeChartStatus(value));
  return specificTerminal || terminal || normalized[0] || "";
}

function resolveDetailHashState(rawHash = "", fallbackTab = "chart") {
  const hash = String(rawHash || "")
    .replace(/^#/, "")
    .trim()
    .toLowerCase();
  if (!hash) {
    return {
      tab: fallbackTab,
      chartMode: HASH_TO_CHART_MODE[fallbackTab] || "live",
      autoReplay: false,
    };
  }
  if (hash === "chart-replay") {
    return {
      tab: "chart",
      chartMode: "replay",
      autoReplay: true,
    };
  }
  if (Object.prototype.hasOwnProperty.call(HASH_TO_CHART_MODE, hash)) {
    return {
      tab: "chart",
      chartMode: HASH_TO_CHART_MODE[hash],
      autoReplay: false,
    };
  }
  return {
    tab: hash,
    chartMode: HASH_TO_CHART_MODE[hash] || "live",
    autoReplay: false,
  };
}

function hashForDetailState(tab, chartMode = "live") {
  const normalizedTab = String(tab || "").trim().toLowerCase();
  if (normalizedTab === "chart") {
    if (chartMode === "cache") return "chart-analysis";
    if (chartMode === "svg") return "chart-svg";
    if (chartMode === "replay") return "chart-replay";
    return "chart-live";
  }
  return normalizedTab || "chart";
}

function detailTabToTvInterval(tab) {
  const t = String(tab || "").toUpperCase();
  if (t === "W") return "W";
  if (t === "D") return "D";
  if (t === "4H") return "240";
  if (t === "1H") return "60";
  if (t === "30M") return "30";
  if (t === "15M") return "15";
  if (t === "5M") return "5";
  if (t === "1M") return "1";
  return "15";
}

function toEpochSec(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    if (numeric > 1e12) return Math.floor(numeric / 1000);
    if (numeric > 1e9) return Math.floor(numeric);
  }
  const millis = new Date(value).getTime();
  if (!Number.isFinite(millis) || millis <= 0) return null;
  return Math.floor(millis / 1000);
}

function toTradingViewSymbol(raw) {
  const s = String(raw || "")
    .trim()
    .toUpperCase();
  if (!s) return "BINANCE:BTCUSDT";
  if (s.includes(":")) return s;
  if (s === "BTCUSD" || s === "BTCUSDT") return "BINANCE:BTCUSDT";
  if (s === "ETHUSD" || s === "ETHUSDT") return "BINANCE:ETHUSDT";
  if (s === "XAUUSD" || s === "GOLD") return "OANDA:XAUUSD";
  return `OANDA:${s.replace(/[^A-Z0-9]/g, "")}`;
}

const parseNumLoose = parseTradePriceNumber;

function parsePositiveNumLoose(v) {
  const n = parseNumLoose(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizePlanSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function choosePrimaryTpAndRr(p = {}, ctx = {}) {
  const toCandidate = (price, rr = null, source = "") => ({
    price: parseNumLoose(price),
    rr: parseNumLoose(rr),
    source,
  });
  const entry = parseNumLoose(ctx?.entry ?? p?.entry ?? p?.entry_price);
  const direction = String(ctx?.direction || p?.direction || "").toUpperCase();
  const isBuy = direction === "BUY";
  const isSell = direction === "SELL";
  const candidates = [
    toCandidate(p?.tp1, p?.risk_reward, "tp1"),
    toCandidate(
      p?.multiple_exits?.tp1?.price,
      p?.multiple_exits?.tp1?.risk_reward,
      "multiple_exits.tp1",
    ),
    toCandidate(p?.tp, p?.rr ?? p?.risk_reward, "tp"),
    toCandidate(p?.take_profit, p?.rr ?? p?.risk_reward, "take_profit"),
    toCandidate(
      p?.multiple_exits?.tp2?.price,
      p?.multiple_exits?.tp2?.risk_reward,
      "multiple_exits.tp2",
    ),
    toCandidate(
      p?.multiple_exits?.tp3?.price,
      p?.multiple_exits?.tp3?.risk_reward,
      "multiple_exits.tp3",
    ),
    toCandidate(
      p?.multiple_exits?.full_tp?.price,
      p?.multiple_exits?.full_tp?.risk_reward,
      "multiple_exits.full_tp",
    ),
    toCandidate(
      Array.isArray(p?.partial_tps)
        ? (p.partial_tps[0]?.price ?? p.partial_tps[0])
        : null,
      Array.isArray(p?.partial_tps)
        ? (p.partial_tps[0]?.risk_reward ?? p.partial_tps[0]?.rr)
        : null,
      "partial_tps.0",
    ),
  ];

  const selected =
    candidates.find((c) => {
      if (c.price == null || c.price === 0) return false;
      if (Number.isFinite(entry)) {
        if (isBuy && c.price <= entry) return false;
        if (isSell && c.price >= entry) return false;
      }
      return true;
    }) || null;
  return {
    tp: selected ? String(selected.price) : "",
    rr: selected && selected.rr != null ? String(selected.rr) : "",
  };
}

function normalizeRawPlan(p = {}) {
  const canonical =
    p?.__raw_plan && typeof p.__raw_plan === "object" ? p.__raw_plan : null;
  const src = canonical ? { ...p, ...canonical } : p;
  const side = String(
    src?.direction || src?.action || src?.side || "BUY",
  ).toUpperCase();
  const direction = side.includes("SELL") ? "SELL" : "BUY";
  const entry = parseNumLoose(
    src?.execution_plan?.entry?.price ??
      src?.entry ??
      src?.entry_price ??
      src?.target_price,
  );
  const sl = parseNumLoose(
    src?.execution_plan?.stop_loss?.price ?? src?.sl ?? src?.stop_loss,
  );
  const chosen = choosePrimaryTpAndRr(src, {
    entry: entry,
    direction,
  });
  const tp1 = parseNumLoose(
    src?.execution_plan?.tp1?.price ??
      src?.tp1 ??
      src?.multiple_exits?.tp1?.price ??
      chosen.tp,
  );
  const tp2 = parseNumLoose(
    src?.execution_plan?.tp2?.price ??
      src?.tp2 ??
      src?.multiple_exits?.tp2?.price,
  );
  const tp3 = parseNumLoose(
    src?.execution_plan?.tp3?.price ??
      src?.tp3 ??
      src?.multiple_exits?.tp3?.price ??
      src?.multiple_exits?.full_tp?.price,
  );
  const tpNum = tp1 ?? parseNumLoose(chosen.tp);
  const pricePrecision = resolveTradePricePrecision(
    src?.symbol || src?.ticker || src?.asset || "",
    [entry, tp1, tp2, tp3, tpNum, sl].filter((value) => value != null),
  );
  // Always sync tp from tp1 (TP1 is primary target)
  const tpVal =
    tp1 != null
      ? formatTradePriceField(tp1, pricePrecision)
      : chosen.tp
        ? formatTradePriceField(parseNumLoose(chosen.tp), pricePrecision)
        : "";
  const rrRaw = parseNumLoose(
    src?.execution_plan?.risk_reward ?? src?.rr ?? src?.risk_reward,
  );
  let rr = null;
  if (entry != null && sl != null && tpNum != null && entry !== sl) {
    rr = Math.abs(tpNum - entry) / Math.abs(entry - sl);
  }
  if (rr == null) rr = rrRaw;
  return {
    ...src,
    ai_rr: rrRaw == null ? "" : String(rrRaw),
    direction,
    entry: formatTradePriceField(entry, pricePrecision),
    tp: tpVal,
    tp1: formatTradePriceField(tp1, pricePrecision),
    tp2: formatTradePriceField(tp2, pricePrecision),
    tp3: formatTradePriceField(tp3, pricePrecision),
    sl: formatTradePriceField(sl, pricePrecision),
    rr: rr == null ? "" : String(Number(rr.toFixed(1))),
    trade_type: String(src?.type || src?.order_type || "limit").toLowerCase(),
    price_precision: pricePrecision,
    __canonical_plan: Boolean(canonical),
  };
}

function humanizeInfoKey(key) {
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function isPlainObject(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function stringifyDynamicInfoValue(value, depth = 0) {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "bigint")
    return String(value);
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    const arr = value
      .map((item) => stringifyDynamicInfoValue(item, depth + 1))
      .filter((x) => x && x !== "—");
    return arr.length ? arr.join(" | ") : "—";
  }

  if (isPlainObject(value)) {
    const compact = Object.entries(value)
      .filter(([, v]) => v != null && v !== "")
      .map(
        ([k, v]) =>
          `${humanizeInfoKey(k)}: ${stringifyDynamicInfoValue(v, depth + 1)}`,
      )
      .join(" | ");
    return compact || "—";
  }

  return String(value);
}

function renderDynamicInfoSection(sectionKey, sectionVal) {
  const isObj = isPlainObject(sectionVal);
  let sectionItems = [];
  if (isObj) {
    sectionItems = Object.entries(sectionVal);
  } else if (Array.isArray(sectionVal)) {
    sectionItems = sectionVal.map((item, idx) => [`item_${idx + 1}`, item]);
  }

  return (
    <div key={`section_${sectionKey}`}>
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          color: "var(--muted)",
          marginBottom: 6,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          paddingBottom: 3,
        }}
      >
        {humanizeInfoKey(sectionKey)}
      </div>

      {!sectionItems.length ? (
        <div
          style={{
            border: "1px solid rgba(255,255,255,0.07)",
            borderRadius: 6,
            padding: 8,
            background: "rgba(255,255,255,0.02)",
            fontSize: 12,
          }}
        >
          {stringifyDynamicInfoValue(sectionVal)}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 8,
          }}
        >
          {sectionItems.map(([k, v], idx) => (
            <div
              key={`${sectionKey}_${String(k)}_${idx}`}
              style={{
                border: "1px solid rgba(255,255,255,0.07)",
                borderRadius: 6,
                padding: 8,
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div className="minor-text" style={{ fontSize: 9 }}>
                {humanizeInfoKey(
                  String(k).startsWith("item_") ? `Item ${idx + 1}` : k,
                )}
              </div>
              <div
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  lineHeight: 1.45,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {stringifyDynamicInfoValue(v)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function semanticTone(value) {
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (!raw) return "neutral";
  if (
    [
      "yes",
      "true",
      "proceed",
      "ok",
      "pass",
      "safe",
      "bullish",
      "confirming",
    ].some((k) => raw.includes(k))
  ) {
    return "good";
  }
  if (
    ["no", "false", "danger", "reject", "fail", "bearish", "blocked"].some(
      (k) => raw.includes(k),
    )
  ) {
    return "bad";
  }
  if (
    ["warning", "warn", "caution", "medium", "review", "check"].some((k) =>
      raw.includes(k),
    )
  ) {
    return "warn";
  }
  if (raw === "high") return "good";
  if (raw === "low") return "bad";
  return "neutral";
}

function semanticBadgeStyle(value) {
  const tone = semanticTone(value);
  if (tone === "good") {
    return {
      color: "#22c55e",
      border: "1px solid rgba(34,197,94,0.4)",
      background: "rgba(34,197,94,0.12)",
    };
  }
  if (tone === "bad") {
    return {
      color: "#ef4444",
      border: "1px solid rgba(239,68,68,0.4)",
      background: "rgba(239,68,68,0.12)",
    };
  }
  if (tone === "warn") {
    return {
      color: "#facc15",
      border: "1px solid rgba(250,204,21,0.45)",
      background: "rgba(250,204,21,0.12)",
    };
  }
  return {
    color: "#f8fafc",
    border: "1px solid rgba(248,250,252,0.26)",
    background: "rgba(248,250,252,0.08)",
  };
}

function decisionBadgeTone(value) {
  const raw = String(value == null ? "" : value)
    .trim()
    .toLowerCase();
  if (!raw) return "neutral";
  if (
    [
      "no_trade",
      "cancel",
      "cancelled",
      "rejected",
      "reject",
      "abort",
      "blocked",
      "invalid",
    ].some((token) => raw.includes(token))
  ) {
    return "bad";
  }
  if (
    ["skip", "wait", "hold", "review", "await", "pending"].some((token) =>
      raw.includes(token),
    )
  ) {
    return "warn";
  }
  if (
    [
      "buy",
      "sell",
      "proceed",
      "execute",
      "enter",
      "market",
      "limit",
      "stop",
      "trade",
    ].some((token) => raw.includes(token))
  ) {
    return "good";
  }
  return semanticTone(raw);
}

function decisionBadgeStyle(value) {
  const tone = decisionBadgeTone(value);
  if (tone === "good") {
    return {
      color: "#22c55e",
      border: "1px solid rgba(34,197,94,0.4)",
      background: "rgba(34,197,94,0.12)",
    };
  }
  if (tone === "bad") {
    return {
      color: "#ef4444",
      border: "1px solid rgba(239,68,68,0.4)",
      background: "rgba(239,68,68,0.12)",
    };
  }
  if (tone === "warn") {
    return {
      color: "#facc15",
      border: "1px solid rgba(250,204,21,0.45)",
      background: "rgba(250,204,21,0.12)",
    };
  }
  return semanticBadgeStyle(value);
}

function isDecisionField(key = "") {
  const normalized = String(key || "").trim().toLowerCase();
  return (
    normalized === "trade_decision" ||
    normalized === "suggested_action" ||
    normalized === "skip_recommendation" ||
    normalized.endsWith("_decision")
  );
}

function planLooksMeaningful(p = {}) {
  const entry = parseNumLoose(p?.entry ?? p?.entry_price ?? p?.target_price);
  const sl = parseNumLoose(p?.sl ?? p?.stop_loss);
  const tp = parseNumLoose(
    p?.tp ??
      p?.take_profit ??
      p?.tp1 ??
      p?.multiple_exits?.full_tp?.price ??
      p?.multiple_exits?.tp2?.price ??
      p?.multiple_exits?.tp1?.price,
  );
  return (
    (entry != null && entry !== 0) ||
    (sl != null && sl !== 0) ||
    (tp != null && tp !== 0)
  );
}

function formatCompactText(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (Array.isArray(value)) {
    return value
      .map((x) => formatCompactText(x))
      .filter(Boolean)
      .join(" | ");
  }
  if (typeof value === "object") {
    const preferred = [
      value.label,
      value.name,
      value.value,
      value.text,
      value.summary,
      value.narrative,
      value.recent_move,
      value.direction,
      value.structure,
      value.trend,
      value.bias,
      value.prediction,
    ]
      .map((x) => formatCompactText(x))
      .filter(Boolean);
    if (preferred.length) return preferred.join(" · ");
    return Object.entries(value)
      .map(([k, v]) => {
        const vv = formatCompactText(v);
        return vv ? `${k}: ${vv}` : "";
      })
      .filter(Boolean)
      .join(" | ");
  }
  return String(value);
}

function PlanHeader({
  plan,
  symbol,
  isBuy,
  simplified = false,
  status = null,
  volume = null,
  pnl = null,
}) {
  const fmtMoney = (v) => {
    const n = parseNumLoose(v);
    if (n == null) return "";
    const abs = Math.abs(n).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
    return `${n >= 0 ? "+" : "-"}$${abs}`;
  };
  const entry = parseNumLoose(plan.entry);
  const sl = parseNumLoose(plan.sl);
  const fallbackTp =
    plan?.multiple_exits?.full_tp?.price ??
    plan?.multiple_exits?.tp2?.price ??
    plan?.multiple_exits?.tp1?.price ??
    null;
  const tp = parseNumLoose(plan.tp ?? fallbackTp);
  const risk = entry != null && sl != null ? Math.abs(entry - sl) : null;
  const resolvedSymbol = plan.symbol || symbol;
  const pricePrecision = resolveTradePricePrecision(resolvedSymbol, [
    entry,
    sl,
    tp,
    fallbackTp,
    plan?.multiple_exits?.tp1?.price,
    plan?.multiple_exits?.tp2?.price,
    plan?.multiple_exits?.tp3?.price,
    plan?.multiple_exits?.full_tp?.price,
  ]);
  const entryText = entry != null ? formatTradePrice(entry, pricePrecision) : "-";
  const tpText =
    tp != null
      ? formatTradePrice(tp, pricePrecision)
      : fallbackTp != null
        ? formatTradePrice(fallbackTp, pricePrecision)
        : "-";
  const slText = sl != null ? formatTradePrice(sl, pricePrecision) : "-";

  const rrParsed = Number(String(plan.rr ?? "").replace(",", "."));
  const rrCandidate =
    Number.isFinite(rrParsed) && rrParsed > 0
      ? rrParsed
      : entry != null && sl != null && tp != null && Math.abs(entry - sl) > 0
        ? Math.abs(tp - entry) / Math.abs(entry - sl)
        : null;
  const rrNum = Number.isFinite(rrCandidate) ? rrCandidate : 0;
  const rrText = Number.isFinite(rrNum) ? `${rrNum.toFixed(1)}r` : "0.0r";
  const directionColor = isBuy ? "#26a69a" : "#ef5350";
  const sideBg = isBuy ? "rgba(38,166,154,0.1)" : "rgba(239,83,80,0.1)";

  const confidenceRaw = plan.confidence ?? plan.confidence_pct;
  const confidenceNum = Number(String(confidenceRaw ?? "").replace(",", "."));
  const confidenceText = Number.isFinite(confidenceNum)
    ? `${confidenceNum.toFixed(1)}%`
    : "";

  const riskTier = plan.risk_management || plan.risk_tier || "";
  const riskMgmt =
    plan?.risk_management && typeof plan.risk_management === "object"
      ? plan.risk_management
      : {};
  const gradeVal = String(
    riskMgmt?.grade ?? plan?.grade ?? plan?.risk_grade ?? "",
  ).trim();
  const confidenceBadgeNum = parseNumLoose(
    riskMgmt?.confidence_pct ?? plan?.confidence_pct ?? plan?.confidence,
  );
  const confidenceBadgeVal =
    confidenceBadgeNum != null ? `${confidenceBadgeNum.toFixed(1)}%` : "";
  const estMinsNum = parseNumLoose(
    riskMgmt?.estimated_entry_mins ??
      riskMgmt?.estimate_mins_that_entry_happens ??
      plan?.estimate_mins_that_entry_happens,
  );
  const estMinsVal = estMinsNum != null ? `${Math.round(estMinsNum)}m` : "";
  const tradeDecisionVal = String(
    plan?.trade_decision ?? plan?.position_management?.trade_decision ?? "",
  ).trim();
  const actionDecisionVal = String(
    riskMgmt?.suggested_action ??
      plan?.skip_recommendation ??
      riskMgmt?.skip_decision ??
      plan?.skip_decision ??
      "",
  ).trim();
  const riskPercentNum = parseNumLoose(
    riskMgmt?.risk_percent ?? plan?.risk_pct,
  );
  const riskPercentVal =
    riskPercentNum != null ? `${riskPercentNum.toFixed(2)}% risk` : "";
  const partials = Array.isArray(plan.partial_tps) ? plan.partial_tps : [];
  const strategy =
    plan.strategy ||
    plan.strategy_name ||
    plan.metadata?.broker_data?.strategy ||
    plan.raw_json?.broker_data?.strategy ||
    "";
  const entryModel =
    plan.entry_model ||
    plan.entryModel ||
    plan.metadata?.broker_data?.entry_model ||
    plan.raw_json?.broker_data?.entry_model ||
    "";
  const sourceVal = plan.source_id || plan.source || plan.model || "";
  const sidVal = String(plan.sid || plan.trade_id || plan.signal_id || "").trim();
  const brokerIdVal = String(
    plan.broker_trade_id || plan.ticket || plan.broker_id || "",
  ).trim();
  const statusText = String(
    status?.label || status || plan?.execution_status || plan?.status || "",
  )
    .trim()
    .toUpperCase();
  const statusCls = (() => {
    const s = String(statusText || "").toUpperCase();
    if (status && typeof status === "object" && status.cls) return status.cls;
    if (s === "FILLED" || s === "OPEN") return "ACTIVE";
    if (s === "CLOSED" || s === "CANCELLED") return "INACTIVE";
    if (s === "ERROR" || s === "FAIL") return "FAIL";
    if (s === "PENDING" || s === "NEW" || s === "DRAFT") return "OTHER";
    return "OTHER";
  })();
  const isPendingLike =
    statusText === "PENDING" ||
    statusText === "DRAFT" ||
    statusText === "PLANNED";
  const pnlText = typeof pnl === "string" && pnl.trim() ? pnl.trim() : "";
  const estimatedBars =
    plan.estimated_bars ?? plan.estimate_bars_that_entry_happens ?? null;
  const confidenceLevel = (plan.confidence_level || "").toLowerCase();
  const riskLevel = (plan.risk_level || plan.risk_tier || "").toLowerCase();
  const mx = plan.multiple_exits || {};
  const tp3Price = mx.tp3?.price ?? mx.full_tp?.price;
  const mxExits = [
    mx.break_even?.price != null && { label: "BE", price: mx.break_even.price },
    mx.tp1?.price != null && { label: "TP1", price: mx.tp1.price },
    mx.tp2?.price != null && { label: "TP2", price: mx.tp2.price },
    tp3Price != null && { label: "TP3", price: tp3Price },
  ].filter(Boolean);

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 8,
        borderBottom: "1px solid var(--accent-soft)",
        paddingBottom: 6,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div
          style={{
            background: sideBg,
            color: directionColor,
            width: 20,
            height: 20,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            fontSize: "11px",
            fontWeight: 900,
            border: `1px solid ${directionColor}44`,
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          {isBuy ? "B" : "S"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span
              style={{
                fontWeight: 800,
                fontSize: "13px",
                color: "var(--foreground)",
              }}
            >
              {resolvedSymbol}
            </span>
            {!simplified && (
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--muted)",
                  textTransform: "lowercase",
                  opacity: 0.8,
                }}
              >
                {plan.trade_type || plan.order_type || "limit"}
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: "12px",
              color: "var(--foreground)",
              fontWeight: 500,
              letterSpacing: "0.01em",
              opacity: 0.9,
            }}
          >
            <TradePriceInline
              entry={entry}
              tp={tp}
              sl={sl}
              symbol={resolvedSymbol}
            />
            <span
              title="Risk-Reward ratio calculated from Plan prices (Entry, TP, SL). Broker-side 'Planned Profits' may diverge due to commissions, spreads, or platform-specific pip calculations."
              style={{
                color: "var(--muted)",
                marginLeft: 8,
                fontWeight: 400,
                cursor: "help",
                borderBottom: "1px dotted var(--muted-bright)",
              }}
            >
              {rrText}
            </span>
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          textAlign: "right",
        }}
      >
        {!isPendingLike && pnlText && (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              title="Realized/Live PnL for filled/open trade"
              style={{
                fontSize: "10px",
                fontWeight: 400,
                color: "var(--foreground)",
              }}
            >
              PnL: {pnlText}
            </span>
          </div>
        )}

        {(sidVal || brokerIdVal || statusText) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              justifyContent: "flex-end",
              fontSize: "10px",
              color: "var(--muted)",
              opacity: 0.9,
            }}
          >
            {(sidVal || brokerIdVal) && (
              <span
                style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
              >
                <StatusBadge id={sidVal} status={plan.execution_status} />
                <StatusBadge id={brokerIdVal} status={plan.dispatch_status} />
              </span>
            )}
            {(() => {
              const d = String(plan.dispatch_status || "").toUpperCase();
              if (d === "REJECTED")
                return (
                  <span
                    title={plan.rejection_reason || "Sync failed"}
                    style={{ cursor: "default", fontSize: 11 }}
                  >
                    ❌
                  </span>
                );
              if (d === "MODIFY" || d === "CLOSE" || d === "CANCEL")
                return (
                  <span
                    title={`Sync pending: ${d}`}
                    style={{ cursor: "default", fontSize: 11 }}
                  >
                    ⏳
                  </span>
                );
              if (d === "LEASED")
                return (
                  <span
                    title="Syncing with broker..."
                    style={{ cursor: "default", fontSize: 11 }}
                  >
                    🔄
                  </span>
                );
              return null;
            })()}
          </div>
        )}

        {/* Row 2: confidence_level / risk_level badges */}
        {(confidenceLevel || riskLevel) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {confidenceLevel && (
              <span
                className={`badge badge-mini ${
                  confidenceLevel === "high"
                    ? "badge-success"
                    : confidenceLevel === "medium"
                      ? "badge-warning"
                      : "badge-danger"
                }`}
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  textTransform: "capitalize",
                }}
              >
                {confidenceLevel} conf
              </span>
            )}
            {riskLevel && (
              <span
                className={`badge badge-mini ${
                  riskLevel === "high"
                    ? "badge-danger"
                    : riskLevel === "medium"
                      ? "badge-warning"
                      : "badge-success"
                }`}
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  textTransform: "capitalize",
                }}
              >
                {riskLevel} risk
              </span>
            )}
          </div>
        )}

        {/* Row 3: source | strategy | entry_model | confidence | risk — one row */}
        {(confidenceText ||
          riskLevel ||
          gradeVal ||
          confidenceBadgeVal ||
          tradeDecisionVal ||
          actionDecisionVal ||
          riskPercentVal) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "nowrap",
              justifyContent: "flex-end",
              overflow: "hidden",
            }}
          >
            {confidenceText && (
              <span
                title="Confidence"
                style={{
                  fontSize: "10px",
                  fontWeight: 400,
                  color: "var(--accent)",
                  opacity: 0.9,
                  whiteSpace: "nowrap",
                }}
              >
                {confidenceText}
              </span>
            )}
            {riskLevel && (
              <span
                className="badge badge-mini"
                title="Risk level"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  fontWeight: 400,
                  textTransform: "capitalize",
                  whiteSpace: "nowrap",
                }}
              >
                {riskLevel}
              </span>
            )}
            {gradeVal && (
              <span
                className="badge badge-mini"
                title="Grade"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  fontWeight: 400,
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {gradeVal}
              </span>
            )}
            {confidenceBadgeVal && (
              <span
                className="badge badge-mini"
                title="Confidence percentage"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                }}
              >
                {confidenceBadgeVal}
              </span>
            )}
            {riskPercentVal && (
              <span
                className="badge badge-mini"
                title="Risk percent"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                }}
              >
                {riskPercentVal}
              </span>
            )}
            {tradeDecisionVal && (
              <span
                className="badge badge-mini"
                title="Trade decision"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                  ...decisionBadgeStyle(tradeDecisionVal),
                }}
              >
                {`Decision: ${tradeDecisionVal}`}
              </span>
            )}
            {actionDecisionVal && (
              <span
                className="badge badge-mini"
                title="Suggested action / skip decision"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                  ...decisionBadgeStyle(actionDecisionVal),
                }}
              >
                {`Action: ${actionDecisionVal}`}
              </span>
            )}
          </div>
        )}

        {/* Row 4: multiple_exits + partial_tps — clickable to set TP/RR */}
        {(partials.length > 0 || mxExits.length > 0) && (
          <div
            style={{
              fontSize: "9.5px",
              color: "var(--muted-bright)",
              display: "flex",
              gap: 8,
              opacity: 0.8,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {mxExits.map((ex, idx) => {
              const exPrice = parseNumLoose(ex.price);
              let rrEx = "";
              if (risk && exPrice != null && entry != null) {
                const r = Math.abs(exPrice - entry) / risk;
                rrEx = `(${r.toFixed(1)}r)`;
              }
              return (
                <span
                  key={`mx_${idx}`}
                  style={{
                    cursor: "pointer",
                    borderBottom: "1px dotted var(--accent-soft)",
                    color: "var(--accent)",
                  }}
                  onClick={() => {
                    if (typeof plan.onSelectTP === "function") {
                      plan.onSelectTP(ex.price, rrEx.replace(/[()]/g, ""));
                    }
                  }}
                >
                  {ex.label}: {ex.price} {rrEx}
                </span>
              );
            })}
            {partials.map((pt, idx) => {
              const ptPrice = parseNumLoose(pt.price);
              let rrPt = "";
              if (risk && ptPrice != null && entry != null) {
                const r = Math.abs(ptPrice - entry) / risk;
                rrPt = `(${r.toFixed(1)}r)`;
              }
              return (
                <span
                  key={idx}
                  style={{
                    cursor: "pointer",
                    borderBottom: "1px dotted var(--muted-soft)",
                  }}
                  onClick={() => {
                    if (typeof plan.onSelectTP === "function") {
                      plan.onSelectTP(pt.price, rrPt.replace(/[()]/g, ""));
                    }
                  }}
                >
                  tp{idx + 1}: {pt.price} {rrPt}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ExtraPlanBlock({
  planId,
  plan,
  onAddSignal,
  onAddTrade,
  busy,
  submittingPlanId,
  successMessage,
}) {
  const [localPos, setLocalPos] = useState({
    direction: plan.direction || "BUY",
    trade_type: "limit",
    entry: String(plan.entry || ""),
    tp: String(plan.tp || ""),
    sl: String(plan.sl || ""),
    rr: String(plan.rr || ""),
    note: plan.note || "",
  });

  const update = (key, val) => setLocalPos((prev) => ({ ...prev, [key]: val }));
  const isThisPlanAdding = submittingPlanId === planId;
  const isSignalAdding = busy?.signal && isThisPlanAdding;
  const isTradeAdding = busy?.trade && isThisPlanAdding;

  return (
    <div>
      <MobileCollapseSection title="Trade Edit">
        <TradePlanEditor
          value={localPos}
          onChange={update}
          onAddSignal={() => onAddSignal?.(localPos, planId)}
          onAddTrade={() => onAddTrade?.(localPos, planId)}
          showAddSignalButton={true}
          showAddTradeButton={true}
          showResetButton={false}
          busy={{
            signal: isSignalAdding,
            trade: isTradeAdding,
          }}
          disabled={Boolean(submittingPlanId && !isThisPlanAdding)}
        />
      </MobileCollapseSection>
      {successMessage && isThisPlanAdding && (
        <div style={{ marginTop: 12 }}>
          <span className="minor-text msg-success">{successMessage}</span>
        </div>
      )}
    </div>
  );
}

export default function TradeDetailCard({
  mode = "generic",
  emptyText = "Select an item to inspect details.",
  showWhenEmpty = false,
  header = null,
  response = null,
  tradePlan = null,
  chart = null,
  metaItems = [],
  history = null,
  formatDateTime,
  hideTabsBeforeResponse = false,
}) {
  const preset = MODE_PRESETS[mode] || MODE_PRESETS.generic;
  const hasResponseData = Boolean(response?.hasData);
  const isResponsePending = Boolean(response?.pending);
  const pendingResponseText = String(
    response?.pendingText || "Refreshing analysis...",
  ).trim();

  if (
    !showWhenEmpty &&
    !header &&
    !hasResponseData &&
    !tradePlan?.enabled &&
    !chart?.enabled &&
    !metaItems.length &&
    !history?.enabled
  ) {
    return <div className="empty-state">{emptyText}</div>;
  }

  const tfTabs =
    Array.isArray(chart?.detailTfTabs) && chart.detailTfTabs.length
      ? chart.detailTfTabs
      : DEFAULT_TF_TABS;
  const tvSymbol = String(
    chart?.tvSymbol ||
      toTradingViewSymbol(chart?.symbol || "", chart?.provider || ""),
  ).trim();

  const responseRawText =
    typeof response?.raw === "string" ? String(response.raw) : "";
  const responseDisplayText =
    typeof response?.text === "string" ? String(response.text) : "";
  const hasResponseText = Boolean(
    responseDisplayText.trim() || responseRawText.trim(),
  );

  const availableTabs = useMemo(() => {
    if (hideTabsBeforeResponse && !response?.hasData) return [];

    const tabs = [];
    const hasRaw =
      response?.raw &&
      typeof response.raw === "object" &&
      Object.keys(response.raw).length > 0;
    const hasPlans =
      Array.isArray(response?.tradePlans) && response.tradePlans.length > 0;
    const trulyHasData = hasRaw || hasPlans || hasResponseText;

    if (chart?.enabled && chart?.symbol) tabs.push("chart");
    if (trulyHasData || metaItems?.length || tradePlan?.enabled)
      tabs.push("analysis");
    if (mode === "trade" || tradePlan?.enabled) tabs.push("info");
    if (mode === "trade" || mode === "ai") tabs.push("files");
    tabs.push("json");
    if (history?.enabled) tabs.push("history");
    return tabs;
  }, [
    chart?.enabled,
    chart?.symbol,
    response?.hasData,
    JSON.stringify(response?.raw),
    JSON.stringify(response?.tradePlans),
    history?.enabled,
    hasResponseText,
    metaItems,
    hideTabsBeforeResponse,
    tradePlan?.enabled,
  ]);

  const defaultMainTab = useMemo(() => {
    if (typeof window === "undefined") return "chart";
    const path = String(window.location?.pathname || "").trim();
    const statusText = String(
      tradePlan?.execution_status ||
        response?.execution_status ||
        response?.status ||
        response?.raw?.execution_status ||
        response?.raw?.status ||
        response?.raw_json?.execution_status ||
        response?.raw_json?.status ||
        "",
    )
      .trim()
      .toUpperCase();
    const isPendingLike = [
      "PENDING",
      "NEW",
      "PLACED",
      "LOCKED",
      "DRAFT",
      "PLANNED",
    ].includes(statusText);
    const isFilledLike = ["FILLED", "OPEN", "START"].includes(statusText);
    if (path.startsWith("/trades/response") || path.startsWith("/ai/response")) return "analysis";
    if (
      (path.startsWith("/trades") || path.startsWith("/ai/trade")) &&
      !isPendingLike &&
      !isFilledLike
    ) {
      return "analysis";
    }
    return "chart";
  }, [
    tradePlan?.execution_status,
    response?.execution_status,
    response?.status,
    response?.raw,
    response?.raw_json,
  ]);

  const [mainTab, setMainTab] = useState(() =>
    resolveDetailHashState(window.location.hash, defaultMainTab).tab,
  );
  const [chartModeTab, setChartModeTab] = useState(() =>
    resolveDetailHashState(window.location.hash, defaultMainTab).chartMode,
  );
  const [chartAutoReplayRequested, setChartAutoReplayRequested] = useState(() =>
    resolveDetailHashState(window.location.hash, defaultMainTab).autoReplay,
  );
  const [singleTradeReplayPlaying, setSingleTradeReplayPlaying] =
    useState(false);
  const [singleTradeReplaySpeedMs, setSingleTradeReplaySpeedMs] =
    useState(1000);
  const readHashTab = useCallback(() => {
    if (typeof window === "undefined") return "";
    return resolveDetailHashState(
      String(window.location.hash || ""),
      defaultMainTab,
    ).tab;
  }, []);

  useEffect(() => {
    const syncTabFromHash = () => {
      const nextState = resolveDetailHashState(
        String(window.location.hash || ""),
        defaultMainTab,
      );
      setMainTab(nextState.tab);
      setChartModeTab(nextState.chartMode);
      setChartAutoReplayRequested(Boolean(nextState.autoReplay));
    };
    window.addEventListener("hashchange", syncTabFromHash);
    syncTabFromHash();
    return () => window.removeEventListener("hashchange", syncTabFromHash);
  }, [defaultMainTab, readHashTab]);

  const handleTabChange = (t) => {
    setMainTab(t);
    window.location.hash = hashForDetailState(t, chartModeTab);
  };
  const [selectedTfs, setSelectedTfs] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState("main");
  const [planDrafts, setPlanDrafts] = useState({});
  const responseRaw =
    response?.raw && typeof response.raw === "object" ? response.raw : {};
  const responseRowRaw =
    response?.raw_json && typeof response.raw_json === "object"
      ? response.raw_json
      : response?.metadata?.raw_json &&
          typeof response.metadata.raw_json === "object"
        ? response.metadata.raw_json
        : response?.raw && typeof response.raw === "object"
          ? response.raw
          : {};
  const cleanRowJson = useMemo(() => {
    if (!responseRowRaw || typeof responseRowRaw !== "object") return {};
    const cleaned = {};
    for (const [k, v] of Object.entries(responseRowRaw)) {
      if (k.startsWith("__")) continue;
      // prompt is a huge AI system prompt — show truncated for readability
      if (k === "prompt" && typeof v === "string" && v.length > 500) {
        cleaned[k] =
          v.slice(0, 500) +
          ` ... (${v.length - 500} more chars — full text in DB)`;
      } else {
        cleaned[k] = v;
      }
    }
    return cleaned;
  }, [responseRowRaw]);
  const responseMetaRaw =
    response?.metadata?.raw_json &&
    typeof response.metadata.raw_json === "object"
      ? response.metadata.raw_json
      : {};
  const canonicalFullRaw =
    responseMetaRaw.__analysis_full_raw ||
    responseRowRaw.__analysis_full_raw ||
    responseRaw.__analysis_full_raw ||
    responseMetaRaw.analysis_result ||
    responseRowRaw.analysis_result ||
    null;
  const rawSource =
    canonicalFullRaw && typeof canonicalFullRaw === "object"
      ? {
          ...canonicalFullRaw,
          ...responseRowRaw,
          ...responseMetaRaw,
          ...responseRaw,
          __analysis_full_raw: canonicalFullRaw,
        }
      : {
          ...(responseRowRaw || {}),
          ...(responseMetaRaw || {}),
          ...(responseRaw || {}),
          ...(response?.metadata &&
          typeof response.metadata === "object" &&
          !response?.raw_json
            ? response.metadata
            : {}),
        };
  // Unwrap API response wrapper { ok, model, parsed_json: {...} } if present
  const effectiveRawSource = useMemo(() => {
    if (
      rawSource?.parsed_json &&
      typeof rawSource.parsed_json === "object" &&
      !Array.isArray(rawSource.parsed_json) &&
      (rawSource.parsed_json.execution_plan ||
        rawSource.parsed_json.direction ||
        rawSource.parsed_json.symbol)
    ) {
      return {
        ...rawSource.parsed_json,
        __analysis_full_raw: rawSource.__analysis_full_raw,
      };
    }
    return rawSource;
  }, [rawSource]);
  const derivedPlansFromRaw = useMemo(() => {
    if (!effectiveRawSource || typeof effectiveRawSource !== "object")
      return [];
    if (isCurrentAiTradePlan(effectiveRawSource)) {
      return [normalizeRawPlan(effectiveRawSource)];
    }
    if (
      effectiveRawSource?.__raw_plan &&
      typeof effectiveRawSource.__raw_plan === "object"
    ) {
      return [normalizeRawPlan(effectiveRawSource.__raw_plan)];
    }
    if (
      Array.isArray(effectiveRawSource.trade_plan) &&
      effectiveRawSource.trade_plan.length
    ) {
      return effectiveRawSource.trade_plan.map((p) =>
        normalizeRawPlan(p || {}),
      );
    }
    if (
      effectiveRawSource.trade_plan &&
      typeof effectiveRawSource.trade_plan === "object"
    ) {
      return [normalizeRawPlan(effectiveRawSource.trade_plan)];
    }
    if (
      effectiveRawSource.entry_price != null ||
      effectiveRawSource.entry != null ||
      effectiveRawSource.stop_loss != null ||
      effectiveRawSource.sl != null ||
      effectiveRawSource.tp != null ||
      effectiveRawSource.multiple_exits
    ) {
      return [normalizeRawPlan(effectiveRawSource)];
    }
    return [];
  }, [effectiveRawSource]);
  const activeSymbol = normalizePlanSymbol(
    chart?.symbol || response?.symbol || tradePlan?.value?.symbol || "",
  );
  const responsePlans =
    Array.isArray(response?.tradePlans) && response.tradePlans.length
      ? response.tradePlans
          .map((p, idx) => {
            // Force canonical direction/TP mapping from raw payload when available.
            if (idx === 0 && effectiveRawSource?.__raw_plan) {
              return normalizeRawPlan({
                ...(p || {}),
                __raw_plan: effectiveRawSource.__raw_plan,
              });
            }
            return normalizeRawPlan(p || {});
          })
          .filter((p) => {
            if (!activeSymbol) return true;
            const sym = normalizePlanSymbol(p?.symbol || "");
            return !sym || sym === activeSymbol;
          })
      : [];
  const hasMeaningfulResponsePlans = responsePlans.some((p) =>
    planLooksMeaningful(p || {}),
  );
  const hasMeaningfulDerivedPlans = derivedPlansFromRaw.some((p) =>
    planLooksMeaningful(p || {}),
  );
  const plans =
    mode === "trade"
      ? [
          {
            direction: tradePlan?.value?.direction,
            entry: tradePlan?.value?.entry,
            sl: tradePlan?.value?.sl,
            tp: tradePlan?.value?.tp,
            tp1: tradePlan?.value?.tp1,
            tp2: tradePlan?.value?.tp2,
            tp3: tradePlan?.value?.tp3,
            rr: tradePlan?.value?.rr,
            trade_type: tradePlan?.value?.trade_type,
            order_type: tradePlan?.value?.trade_type,
            strategy: tradePlan?.value?.strategy,
            entryModel: tradePlan?.value?.entry_model,
            source_id: tradePlan?.value?.source_id,
            source: tradePlan?.value?.source,
            sid: response?.sid || response?.id || tradePlan?.tradeId || "",
            broker_trade_id:
              response?.broker_trade_id || response?.ticket || "",
            confidence: tradePlan?.value?.confidence_pct,
            volume: tradePlan?.value?.volume,
            volume_basis_lots: tradePlan?.value?.volume_basis_lots,
            volume_units: tradePlan?.value?.volume_units,
            broker_lots: tradePlan?.value?.broker_lots,
            risk_money_planned:
              tradePlan?.value?.risk_money_planned ??
              tradePlan?.value?.risk_money,
            risk_money: tradePlan?.value?.risk_money,
            planned_tp_pnl: tradePlan?.value?.planned_tp_pnl,
            planned_sl_pnl: tradePlan?.value?.planned_sl_pnl,
            broker_tp_pnl: tradePlan?.value?.broker_tp_pnl,
            broker_sl_pnl: tradePlan?.value?.broker_sl_pnl,
            risk_management: tradePlan?.value?.risk_management,
            entry_condition: tradePlan?.value?.entry_condition,
            exit_condition: tradePlan?.value?.exit_condition,
            confluence_checklist: tradePlan?.value?.confluence_checklist,
            partial_tps: tradePlan?.value?.partial_tps,
            reasons_to_skip: tradePlan?.value?.reasons_to_skip,
            skip_recommendation: tradePlan?.value?.skip_recommendation,
            be_trigger: tradePlan?.value?.be_trigger,
            invalidation: tradePlan?.value?.invalidation,
            estimated_bars: tradePlan?.value?.estimated_bars,
            symbol: tradePlan?.value?.symbol || chart?.symbol || "",
            note: tradePlan?.value?.note || "",
            close_reason: tradePlan?.value?.close_reason || "",
            rejection_reason: tradePlan?.value?.rejection_reason || "",
          },
        ]
      : hasMeaningfulResponsePlans
        ? responsePlans
        : hasMeaningfulDerivedPlans
          ? derivedPlansFromRaw
          : [
              {
                direction: tradePlan?.value?.direction,
                entry: tradePlan?.value?.entry,
                sl: tradePlan?.value?.sl,
                tp: tradePlan?.value?.tp,
                tp1: tradePlan?.value?.tp1,
                tp2: tradePlan?.value?.tp2,
                tp3: tradePlan?.value?.tp3,
                rr: tradePlan?.value?.rr,
                trade_type: tradePlan?.value?.trade_type,
                order_type: tradePlan?.value?.trade_type,
                strategy: tradePlan?.value?.strategy,
                entryModel: tradePlan?.value?.entry_model,
                source_id: tradePlan?.value?.source_id,
                source: tradePlan?.value?.source,
                volume: tradePlan?.value?.volume,
                volume_basis_lots: tradePlan?.value?.volume_basis_lots,
                volume_units: tradePlan?.value?.volume_units,
                broker_lots: tradePlan?.value?.broker_lots,
                risk_money_planned:
                  tradePlan?.value?.risk_money_planned ??
                  tradePlan?.value?.risk_money,
                risk_money: tradePlan?.value?.risk_money,
                planned_tp_pnl: tradePlan?.value?.planned_tp_pnl,
                planned_sl_pnl: tradePlan?.value?.planned_sl_pnl,
                broker_tp_pnl: tradePlan?.value?.broker_tp_pnl,
                broker_sl_pnl: tradePlan?.value?.broker_sl_pnl,
                sid: response?.sid || response?.id || tradePlan?.tradeId || "",
                broker_trade_id:
                  response?.broker_trade_id || response?.ticket || "",
                confidence: tradePlan?.value?.confidence_pct,
                risk_management: tradePlan?.value?.risk_management,
                entry_condition: tradePlan?.value?.entry_condition,
                exit_condition: tradePlan?.value?.exit_condition,
                confluence_checklist: tradePlan?.value?.confluence_checklist,
                partial_tps: tradePlan?.value?.partial_tps,
                reasons_to_skip: tradePlan?.value?.reasons_to_skip,
                skip_recommendation: tradePlan?.value?.skip_recommendation,
                be_trigger: tradePlan?.value?.be_trigger,
                invalidation: tradePlan?.value?.invalidation,
                estimated_bars: tradePlan?.value?.estimated_bars,
              },
            ];
  const selectedPlanIndex =
    selectedPlanId === "main"
      ? 0
      : Math.max(0, Number(String(selectedPlanId).replace("suggested_", "")));
  const selectedPlanFromList = plans[selectedPlanIndex] || plans[0] || {};
  const displayPlanIds = useMemo(() => {
    const fromPlans = plans.map((_, i) =>
      i === 0 ? "main" : `suggested_${i}`,
    );
    const fromDrafts = Object.keys(planDrafts || {});
    const all = Array.from(new Set([...fromPlans, ...fromDrafts])).filter(
      Boolean,
    );
    const normalized = all.sort((a, b) => {
      if (a === "main") return -1;
      if (b === "main") return 1;
      const ai = Number(String(a).replace("suggested_", ""));
      const bi = Number(String(b).replace("suggested_", ""));
      return (
        (Number.isFinite(ai) ? ai : 999) - (Number.isFinite(bi) ? bi : 999)
      );
    });
    return normalized.length ? normalized : ["main"];
  }, [plans, planDrafts]);
  const rawData = rawSource;
  const schemaVersion = String(
    response?.schemaVersion || rawData?.schema_version || "",
  ).trim();
  const isSchema24 = schemaVersion.startsWith("2.4");
  const selectedPlanRaw =
    planDrafts[selectedPlanId] ||
    selectedPlanFromList?.__raw_plan ||
    selectedPlanFromList ||
    {};
  const selectedTradePlanGroup = useMemo(() => {
    if (selectedPlanId === "main") return "P1";
    const idx = Number(String(selectedPlanId).replace("suggested_", ""));
    return Number.isFinite(idx) && idx >= 1 ? `P${idx + 1}` : "P1";
  }, [selectedPlanId]);
  const chartAnalysisSnapshot = useMemo(
    () => ({
      ...((response?.raw && typeof response.raw === "object"
        ? response.raw
        : response?.raw_json && typeof response.raw_json === "object"
          ? response.raw_json
          : response?.metadata?.raw_json &&
              typeof response.metadata.raw_json === "object"
            ? response.metadata.raw_json
            : {}) || {}),
      trade_plan: Array.isArray(response?.tradePlans)
        ? response.tradePlans
        : [],
    }),
    [
      JSON.stringify(response?.raw),
      JSON.stringify(response?.raw_json),
      JSON.stringify(response?.metadata?.raw_json),
      JSON.stringify(response?.tradePlans),
    ],
  );
  const chart2AnalysisSnapshot = useMemo(
    () => ({
      ...(rawData && typeof rawData === "object" ? rawData : {}),
      trade_plan: Array.isArray(rawData?.trade_plan)
        ? rawData.trade_plan
        : rawData?.trade_plan && typeof rawData.trade_plan === "object"
          ? [rawData.trade_plan]
          : [],
    }),
    [rawData],
  );

  const hasTradePlanData = useMemo(() => {
    const p = plans[0] || {};
    return Boolean(p.entry || p.tp || p.sl);
  }, [plans]);

  useEffect(() => {
    const requestedTab = readHashTab();
    if (requestedTab && requestedTab !== "chart") {
      return;
    }
    const canShowChart = Boolean(chart?.enabled && chart?.symbol);
    if (!hasTradePlanData && !canShowChart) {
      return;
    }
    if (!hasTradePlanData && mainTab === "json") {
      // stay on json if user explicitly went there
    } else if (!hasTradePlanData && mainTab !== "chart") {
      setMainTab("chart");
    }
  }, [chart?.enabled, chart?.symbol, hasTradePlanData, mainTab, readHashTab]);

  useEffect(() => {
    if (!availableTabs.length) return;
    const requestedTab = readHashTab();
    if (requestedTab && availableTabs.includes(requestedTab)) {
      if (mainTab !== requestedTab) setMainTab(requestedTab);
      return;
    }
    if (!availableTabs.includes(mainTab)) setMainTab(availableTabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTabs, mainTab, readHashTab]);

  // Only reset to main when tradePlan becomes newly enabled from a disabled state,
  // and only if no plan is already selected (preserve user's explicit selection across renders).
  const prevTradePlanEnabledRef = useRef(false);
  useEffect(() => {
    const nowEnabled = Boolean(tradePlan?.enabled);
    if (nowEnabled && !prevTradePlanEnabledRef.current && !selectedPlanId) {
      setSelectedPlanId("main");
    }
    prevTradePlanEnabledRef.current = nowEnabled;
  }, [tradePlan?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Trade mode: when selected trade changes, reset draft cache first
  // so empty fields in new trade don't inherit previous trade values.
  const prevTradeEntityRef = useRef("");
  useEffect(() => {
    if (mode !== "trade") return;
    const entityKey = String(
      tradePlan?.tradeId || response?.id || "",
    ).trim();
    if (!entityKey) return;
    if (
      prevTradeEntityRef.current &&
      prevTradeEntityRef.current !== entityKey
    ) {
      setPlanDrafts({});
      setSelectedPlanId("main");
    }
    prevTradeEntityRef.current = entityKey;
  }, [mode, tradePlan?.tradeId, response?.id]);

  const handleTradePlanReset = useCallback(() => {
    setPlanDrafts({});
    setSelectedPlanId("main");
    if (typeof tradePlan?.onReset === "function") {
      tradePlan.onReset();
    }
  }, [tradePlan]);

  const plansKey = useMemo(() => {
    return plans
      .map((p, i) => [i, p?.entry, p?.tp, p?.sl, p?.direction].join("|"))
      .join("::");
  }, [plans]);

  useEffect(() => {
    if (!plans.length) return;
    setPlanDrafts((prev) => {
      const next = {};
      plans.forEach((p, i) => {
        const planId = i === 0 ? "main" : `suggested_${i}`;
        const normalized = {
          ...p,
          entry_model: p.entry_model || p.entryModel || "",
          confidence_pct: p.confidence_pct ?? p.confidence ?? null,
          estimated_bars: p.estimated_bars ?? null,
          be_trigger: p.be_trigger ?? p.be ?? null,
          invalidation: p.invalidation || "",
          risk_management: p.risk_management || "",
          entry_condition: p.entry_condition || "",
          exit_condition: p.exit_condition || "",
          confluence_checklist: Array.isArray(p.confluence_checklist)
            ? p.confluence_checklist
            : [],
          reasons_to_skip: Array.isArray(p.reasons_to_skip)
            ? p.reasons_to_skip
            : Array.isArray(p.skipReasons)
              ? p.skipReasons
              : [],
          skip_recommendation: p.skip_recommendation || p.skip || "",
        };
        // Trade detail page is single-source-of-truth from selected trade row.
        // Never preserve prior trade drafts here, otherwise values can bleed
        // across trade navigation (A -> B -> A) and appear swapped/stale.
        if (mode === "trade") {
          next[planId] = normalized;
        } else {
          next[planId] = mergePlanPreservingEdits(
            normalized,
            prev?.[planId] || {},
          );
        }
      });
      if (!next.main) {
        next.main = {
          ...(tradePlan?.value || {}),
          direction: tradePlan?.value?.direction || "BUY",
        };
      }
      return next;
    });
  }, [plansKey, JSON.stringify(response?.tradePlans)]);

  useEffect(() => {
    if (!displayPlanIds.length) return;
    if (!displayPlanIds.includes(selectedPlanId)) {
      setSelectedPlanId("main");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPlanIds]);

  const tfSelectionContextRef = useRef("");
  useEffect(() => {
    if (!chart?.enabled) return;

    const contextKey = [
      String(chart?.symbol || "").trim().toUpperCase(),
      String(chart?.interval || "").trim().toLowerCase(),
      String(response?.id || response?.sid || tradePlan?.tradeId || "").trim(),
      tradePlan?.enabled ? "trade" : "analysis",
    ].join("|");

    if (tfSelectionContextRef.current === contextKey) return;
    tfSelectionContextRef.current = contextKey;

    const initial = [];
    const configured = Array.isArray(chart?.profileTfs)
      ? chart.profileTfs
      : [];
    const signalTf = (chart.interval || "").toLowerCase();
    const defaults = configured.length
      ? configured
      : tradePlan?.enabled
        ? ["d", "4h", "15m", "5m"]
        : [signalTf, "15m", "4h", "d"];

    defaults.forEach((tf) => {
      const t = String(tf || "")
        .toLowerCase()
        .trim();
      if (t && t !== "entry" && !initial.includes(t)) initial.push(t);
    });

    setSelectedTfs(sortTimeframes(initial, "desc"));
  }, [
    chart?.enabled,
    chart?.interval,
    chart?.profileTfs,
    chart?.symbol,
    response?.id,
    response?.sid,
    tradePlan?.enabled,
    tradePlan?.tradeId,
  ]);

  const toggleTf = (tf) => {
    const t = tf.toLowerCase();
    setSelectedTfs((prev) => {
      const next = prev.includes(t)
        ? prev.filter((x) => x !== t)
        : [...prev, t];
      return sortTimeframes(next, "desc");
    });
  };

  const effectiveTfs = useMemo(() => {
    const base = Array.isArray(selectedTfs)
      ? selectedTfs.map((t) => String(t || "").toLowerCase()).filter(Boolean)
      : [];
    const fallback = ["d", "4h", "15m", "5m"];
    const chosen = base.length ? base : fallback;
    return sortTimeframes([...new Set(chosen)], "desc");
  }, [selectedTfs]);
  const effectiveChartTfs = effectiveTfs;

  const selectedPlanSymbol = String(
    selectedPlanRaw?.symbol ||
      selectedPlanFromList?.symbol ||
      chart?.symbol ||
      "",
  )
    .trim()
    .toUpperCase();
  const chartInstanceKey = useMemo(
    () =>
      [
        String(selectedPlanSymbol || chart?.symbol || "").trim().toUpperCase(),
        String(chartModeTab || chart?.mode || "live").trim().toLowerCase(),
        effectiveChartTfs.join("|"),
        mode === "trade" ? "trade" : "analysis",
      ].join("::"),
    [chart?.mode, chart?.symbol, chartModeTab, effectiveChartTfs, mode, selectedPlanSymbol],
  );
  const effectiveChartInitialBarsCount = useMemo(() => {
    const configuredBars = Number(chart?.initialBarsCount);
    if (Number.isFinite(configuredBars) && configuredBars > 0) {
      return configuredBars;
    }
    return 1000;
  }, [chart?.initialBarsCount]);
  const chartTradeSide =
    tradePlan?.value?.direction ||
    chart?.side ||
    chart?.action ||
    response?.side ||
    response?.action ||
    rawData?.side ||
    rawData?.action ||
    selectedPlanRaw?.direction ||
    "";
  const chartTradeAction =
    tradePlan?.value?.direction ||
    chart?.action ||
    chart?.side ||
    response?.action ||
    response?.side ||
    rawData?.action ||
    rawData?.side ||
    selectedPlanRaw?.direction ||
    "";
  const handleChartPlanLevelChange = useCallback(
    (field, value) => {
      const normalizedField = String(field || "").trim();
      if (!normalizedField) return;
      const targetPlanId = selectedPlanId || "main";
      const planIndex =
        targetPlanId === "main"
          ? 0
          : Math.max(
              0,
              Number(String(targetPlanId).replace("suggested_", "")) || 0,
            );
      const fallbackPlan =
        (targetPlanId === "main"
          ? plans[0]
          : plans[planIndex]) ||
        tradePlan?.value ||
        {};
      let nextPlan = null;
      setPlanDrafts((prev) => {
        nextPlan = applyLinkedPlanChange(
          prev?.[targetPlanId] || fallbackPlan,
          normalizedField,
          value,
        );
        return {
          ...prev,
          [targetPlanId]: nextPlan,
        };
      });
      if (targetPlanId === "main" && typeof tradePlan?.onChange === "function") {
        const changedFields = new Set([normalizedField]);
        if (normalizedField === "tp1" || normalizedField === "tp") {
          changedFields.add("tp");
          changedFields.add("tp1");
          if (nextPlan?.rr !== undefined) changedFields.add("rr");
        } else if (normalizedField === "entry" || normalizedField === "sl") {
          if (nextPlan?.rr !== undefined) changedFields.add("rr");
        } else if (normalizedField === "rr") {
          changedFields.add("tp");
          changedFields.add("tp1");
        }
        changedFields.forEach((nextField) => {
          if (nextPlan?.[nextField] !== undefined) {
            tradePlan.onChange(nextField, nextPlan[nextField]);
          }
        });
      }
      chart?.onPlanLevelChange?.(normalizedField, value);
    },
    [chart, plans, selectedPlanId, tradePlan],
  );
  const chartEntryPrice =
    selectedPlanRaw?.entry ||
    chart?.entryPrice ||
    response?.entry_exec ||
    response?.entryExec ||
    response?.entry ||
    response?.entry_price ||
    rawData?.entry_exec ||
    rawData?.entryExec ||
    rawData?.entry ||
    rawData?.entry_price ||
    tradePlan?.value?.entry;
  const chartSlPrice =
    selectedPlanRaw?.sl ||
    chart?.slPrice ||
    response?.sl_exec ||
    response?.slExec ||
    response?.sl ||
    response?.stop_loss ||
    rawData?.sl_exec ||
    rawData?.slExec ||
    rawData?.sl ||
    rawData?.stop_loss ||
    tradePlan?.value?.sl;
  const chartTpPrice =
    selectedPlanRaw?.tp ||
    chart?.tpPrice ||
    response?.tp_exec ||
    response?.tpExec ||
    response?.tp ||
    response?.take_profit ||
    rawData?.tp_exec ||
    rawData?.tpExec ||
    rawData?.tp ||
    rawData?.take_profit ||
    tradePlan?.value?.tp;
  const chartTp1Price =
    selectedPlanRaw?.tp1 ||
    chart?.tp1Price ||
    response?.tp1_exec ||
    response?.tp1Exec ||
    response?.tp1 ||
    rawData?.tp1_exec ||
    rawData?.tp1Exec ||
    rawData?.tp1 ||
    tradePlan?.value?.tp1 ||
    chart?.tpPrice ||
    response?.tp ||
    rawData?.tp ||
    tradePlan?.value?.tp;
  const chartTp2Price =
    selectedPlanRaw?.tp2 ||
    chart?.tp2Price ||
    response?.tp2 ||
    rawData?.tp2 ||
    tradePlan?.value?.tp2;
  const chartTp3Price =
    selectedPlanRaw?.tp3 ||
    chart?.tp3Price ||
    response?.tp3 ||
    rawData?.tp3 ||
    tradePlan?.value?.tp3;
  const brokerData = firstObject(
    chart?.brokerData,
    response?.metadata?.broker_data,
    response?.broker_data,
    rawData?.metadata?.broker_data,
    rawData?.broker_data,
    response?.raw_json?.broker_data,
    response?.raw?.broker_data,
  );
  const chartCreatedAt =
    chart?.createdAt ||
    response?.created_at ||
    response?.createdAt ||
    rawData?.created_at ||
    rawData?.createdAt ||
    brokerData?.created_at ||
    brokerData?.createdAt ||
    brokerData?.signal_time ||
    brokerData?.signalTime;
  const chartOpenedAt =
    chart?.openedAt ??
    response?.opened_at ??
    response?.openedAt ??
    rawData?.opened_at ??
    rawData?.openedAt ??
    brokerData?.opened_at ??
    brokerData?.openedAt ??
    brokerData?.entry_time ??
    brokerData?.entryTime ??
    null;
  const chartClosedAt =
    chart?.closedAt ??
    response?.closed_at ??
    response?.closedAt ??
    rawData?.closed_at ??
    rawData?.closedAt ??
    brokerData?.closed_at ??
    brokerData?.closedAt ??
    brokerData?.exit_time ??
    brokerData?.exitTime ??
    null;
  const chartOpenedAtUnix =
    chart?.openedAtUnix ||
    chart?.openedAtSec ||
    (mode === "trade" ? toEpochSec(chart?.openedAt) : null) ||
    response?.entry_time_unix ||
    response?.opened_at_unix ||
    rawData?.entry_time_unix ||
    rawData?.opened_at_unix ||
    brokerData?.entry_time_unix ||
    brokerData?.entryTimeUnix ||
    brokerData?.opened_at_unix ||
    brokerData?.openedAtUnix ||
    null;
  const chartCreatedAtUnix =
    chart?.createdAtUnix ||
    chart?.createdAtSec ||
    (mode === "trade" ? toEpochSec(chart?.createdAt) : null) ||
    response?.created_at_unix ||
    response?.createdAtUnix ||
    rawData?.created_at_unix ||
    rawData?.createdAtUnix ||
    brokerData?.created_at_unix ||
    brokerData?.createdAtUnix ||
    brokerData?.signal_time_unix ||
    brokerData?.signalTimeUnix ||
    null;
  const chartClosedAtUnix =
    chart?.closedAtUnix ||
    chart?.closedAtSec ||
    (mode === "trade" ? toEpochSec(chart?.closedAt) : null) ||
    response?.closed_at_unix ||
    rawData?.closed_at_unix ||
    brokerData?.closed_at_unix ||
    brokerData?.closedAtUnix ||
    brokerData?.exit_time_unix ||
    brokerData?.exitTimeUnix ||
    null;
  const hasChartClosedEvent = Boolean(
    chartClosedAt ||
      (Number.isFinite(Number(chartClosedAtUnix)) && Number(chartClosedAtUnix) > 0),
  );
  const chartCloseStatus = resolveTradeChartStatus(
    chart?.closeStatus,
    response?.execution_status,
    response?.close_status,
    response?.result,
    response?.close_reason,
    rawData?.execution_status,
    rawData?.close_status,
    rawData?.result,
    rawData?.close_reason,
    brokerData?.execution_status,
    brokerData?.close_status,
    brokerData?.status,
    brokerData?.result,
    brokerData?.close_reason,
  );
  const chartExitPrice =
    chart?.exitPrice ||
    response?.exit_price ||
    response?.exitPrice ||
    rawData?.exit_price ||
    rawData?.exitPrice ||
    brokerData?.exit_price ||
    brokerData?.exitPrice ||
    brokerData?.close_price ||
    brokerData?.closePrice;
  const chartPnlRealized =
    chart?.pnlRealized ||
    response?.pnl_realized ||
    response?.pnlRealized ||
    rawData?.pnl_realized ||
    rawData?.pnlRealized ||
    response?.broker_pnl ||
    rawData?.broker_pnl ||
    brokerData?.net_pnl ||
    brokerData?.pnl ||
    brokerData?.broker_pnl;
  const chartExitPriceForClosedTrade = hasChartClosedEvent ? chartExitPrice : null;
  const chartPnlRealizedForClosedTrade = hasChartClosedEvent
    ? chartPnlRealized
    : null;
  const chartCloseStatusForClosedTrade = hasChartClosedEvent ? chartCloseStatus : "";
  const chartTradeLabel =
    chart?.tradeLabel ||
    chart?.strategyName ||
    chart?.strategy_name ||
    response?.strategy_name ||
    response?.strategy ||
    response?.entry_model ||
    rawData?.strategy_name ||
    rawData?.strategy ||
    rawData?.entry_model ||
    selectedPlanRaw?.strategy_name ||
    selectedPlanRaw?.strategy ||
    selectedPlanRaw?.entry_model ||
    tradePlan?.value?.strategy_name ||
    tradePlan?.value?.entry_model ||
    "";
  const chartTradeSid = chart?.tradeId || response?.sid || response?.id || "";
  const singleTradeReplayTrade = useMemo(() => {
    if (mode !== "trade") return null;
    const normalizedTrade = buildSingleTradeForChart({
      sid: chartTradeSid || "selected-trade",
      side: chartTradeSide,
      action: chartTradeAction,
      entryPrice: chartEntryPrice,
      tpPrice: chartTpPrice,
      tp1Price: chartTp1Price,
      slPrice: chartSlPrice,
      exitPrice: chartExitPriceForClosedTrade,
      createdAt: chartCreatedAt,
      openedAt: chartOpenedAt,
      closedAt: chartClosedAt,
      openedAtSec: chartOpenedAtUnix,
      closedAtSec: chartClosedAtUnix,
      closeStatus: chartCloseStatus,
      pnlRealized: chartPnlRealizedForClosedTrade,
      tradeLabel: chartTradeLabel,
    });
    if (!normalizedTrade) return null;
    return {
      sid: normalizedTrade.sid,
      side: normalizedTrade.side,
      action: chartTradeAction || normalizedTrade.side,
      type:
        response?.type ||
        rawData?.type ||
        chart?.type ||
        response?.order_type ||
        rawData?.order_type ||
        chart?.orderType ||
        null,
      entry: normalizedTrade.entry,
      tp: normalizedTrade.tp,
      sl: normalizedTrade.sl,
      exit_price: normalizedTrade.exitPrice,
      created_at: chartCreatedAt,
      opened_at: chartOpenedAt,
      closed_at: chartClosedAt,
      openedAtSec: normalizedTrade.openedAtSec,
      closedAtSec: normalizedTrade.closedAtSec,
      createdAtSec:
        normalizedTrade.createdAtSec ||
        chartCreatedAtUnix ||
        toEpochSec(chartCreatedAt) ||
        null,
      execution_status: chartCloseStatus,
      pnl_realized: normalizedTrade.pnlRealized,
      tradeLabel: chartTradeLabel,
    };
  }, [
    chartCloseStatus,
    chartCloseStatusForClosedTrade,
    chartClosedAt,
    chartClosedAtUnix,
    chartCreatedAt,
    chartCreatedAtUnix,
    chartEntryPrice,
    chartExitPriceForClosedTrade,
    chartOpenedAt,
    chartOpenedAtUnix,
    chartPnlRealizedForClosedTrade,
    chartSlPrice,
    chartTp1Price,
    chartTpPrice,
    chartTradeAction,
    chartTradeLabel,
    chartTradeSide,
    chartTradeSid,
    chart?.orderType,
    chart?.type,
    mode,
    rawData?.order_type,
    rawData?.type,
    response?.order_type,
    response?.type,
  ]);
  const singleTradeReplayTrades = useMemo(
    () => (singleTradeReplayTrade ? [singleTradeReplayTrade] : []),
    [singleTradeReplayTrade],
  );
  const singleTradeReplayConfig = useMemo(() => {
    if (mode !== "trade" || !singleTradeReplayTrade) return null;
    const replaySid = String(singleTradeReplayTrade.sid || "selected-trade");
    return {
      enabled: true,
      playing: singleTradeReplayPlaying,
      speedMs: singleTradeReplaySpeedMs,
      speedOptions: REPLAY_SPEED_OPTIONS,
      runKey: replaySid,
      startTradeSid: replaySid,
      currentTradeIndex: 0,
      totalTrades: 1,
      onSpeedChange: (nextSpeedMs) =>
        setSingleTradeReplaySpeedMs(Math.max(100, Number(nextSpeedMs) || 1000)),
      onToggle: () => {
        setSingleTradeReplayPlaying((prev) => !prev);
      },
      onComplete: () => setSingleTradeReplayPlaying(false),
    };
  }, [
    mode,
    singleTradeReplayPlaying,
    singleTradeReplaySpeedMs,
    singleTradeReplayTrade,
  ]);
  useEffect(() => {
    setSingleTradeReplayPlaying(false);
  }, [chartTradeSid, chartCreatedAt, chartOpenedAt, chartClosedAt]);
  const selectedRawData = useMemo(() => {
    if (!rawData || typeof rawData !== "object") return rawData;
    if (isCurrentAiTradePlan(rawData)) return rawData;
    const cloned = { ...rawData };
    const allPlans = Array.isArray(rawData?.trade_plan)
      ? rawData.trade_plan
      : [];
    if (allPlans.length > 0) {
      const pick =
        allPlans[selectedPlanIndex] ||
        allPlans.find((p) => {
          const sym = String(p?.symbol || "")
            .trim()
            .toUpperCase();
          return selectedPlanSymbol && sym === selectedPlanSymbol;
        }) ||
        allPlans[0];
      cloned.trade_plan = pick ? [pick] : [];
    } else if (selectedPlanRaw && Object.keys(selectedPlanRaw).length) {
      cloned.trade_plan = [selectedPlanRaw];
    }
    return cloned;
  }, [rawData, selectedPlanIndex, selectedPlanRaw, selectedPlanSymbol]);
  const selectedAiPlan = useMemo(() => {
    const candidates = [
      selectedRawData,
      effectiveRawSource,
      selectedPlanFromList?.__raw_plan,
      selectedPlanFromList,
      rawData,
    ];
    for (const item of candidates) {
      if (isCurrentAiTradePlan(item)) return item;
      if (Array.isArray(item?.trade_plan)) {
        const match =
          item.trade_plan[selectedPlanIndex] ||
          item.trade_plan.find((p) => {
            const sym = String(p?.symbol || "")
              .trim()
              .toUpperCase();
            return selectedPlanSymbol && sym === selectedPlanSymbol;
          }) ||
          item.trade_plan[0];
        if (isCurrentAiTradePlan(match)) return match;
      }
    }
    return null;
  }, [
    effectiveRawSource,
    rawData,
    selectedPlanFromList,
    selectedPlanIndex,
    selectedPlanSymbol,
    selectedRawData,
  ]);

  const selectedPlanJsonForDisplay = useMemo(() => {
    if (mode !== "ai") return cleanRowJson || {};
    if (selectedAiPlan && typeof selectedAiPlan === "object")
      return selectedAiPlan;

    const candidates = [];
    if (Array.isArray(selectedRawData?.trade_plan)) {
      const picked =
        selectedRawData.trade_plan[selectedPlanIndex] ||
        selectedRawData.trade_plan[0];
      if (picked && typeof picked === "object") candidates.push(picked);
    }
    if (
      selectedPlanFromList?.__raw_plan &&
      typeof selectedPlanFromList.__raw_plan === "object"
    ) {
      candidates.push(selectedPlanFromList.__raw_plan);
    }
    if (selectedPlanFromList && typeof selectedPlanFromList === "object") {
      candidates.push(selectedPlanFromList);
    }
    if (selectedPlanRaw && typeof selectedPlanRaw === "object") {
      candidates.push(selectedPlanRaw);
    }
    return candidates.find((x) => x && Object.keys(x).length > 0) || {};
  }, [
    cleanRowJson,
    mode,
    selectedAiPlan,
    selectedPlanFromList,
    selectedPlanIndex,
    selectedPlanRaw,
    selectedRawData,
  ]);

  const renderInfoValue = (value) => {
    if (value == null || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) {
      return value
        .map((x) =>
          x && typeof x === "object"
            ? Object.entries(x)
                .map(([k, v]) => `${humanizeInfoKey(k)}: ${renderInfoValue(v)}`)
                .join(", ")
            : String(x),
        )
        .join(" | ");
    }
    if (typeof value === "object") {
      return Object.entries(value)
        .filter(([, v]) => v != null && v !== "")
        .map(([k, v]) => `${humanizeInfoKey(k)}: ${renderInfoValue(v)}`)
        .join(" | ");
    }
    return String(value);
  };

  const compactInfoEntries = (obj) =>
    obj && typeof obj === "object"
      ? Object.entries(obj).filter(
          ([, v]) =>
            v != null &&
            v !== "" &&
            !(Array.isArray(v) && v.length === 0) &&
            !(
              typeof v === "object" &&
              !Array.isArray(v) &&
              Object.keys(v).length === 0
            ),
        )
      : [];

  const decisionBadges = selectedAiPlan
    ? [
        (selectedAiPlan.execution_status || selectedAiPlan.status) && {
          key: "status",
          label: `Status: ${String(selectedAiPlan.execution_status || selectedAiPlan.status).toUpperCase()}`,
          toneSource: String(
            selectedAiPlan.execution_status || selectedAiPlan.status,
          ),
          tooltip: "Current trade/signal execution status",
        },
        selectedAiPlan.risk_management?.grade && {
          key: "grade",
          label: `Grade: ${selectedAiPlan.risk_management.grade}`,
          toneSource: selectedAiPlan.risk_management.grade,
          tooltip: "Overall quality grade of the setup",
        },
        selectedAiPlan.risk_management?.risk_percent != null && {
          key: "risk",
          label: `Risk: ${selectedAiPlan.risk_management.risk_percent}%`,
          toneSource:
            Number(selectedAiPlan.risk_management.risk_percent) <= 2
              ? "good"
              : Number(selectedAiPlan.risk_management.risk_percent) <= 4
                ? "warning"
                : "danger",
          tooltip: "Configured risk percentage for this plan",
        },
        selectedAiPlan.risk_management?.confidence_pct != null && {
          key: "confidence",
          label: `Confidence: ${selectedAiPlan.risk_management.confidence_pct}%`,
          toneSource:
            Number(selectedAiPlan.risk_management.confidence_pct) >= 80
              ? "good"
              : Number(selectedAiPlan.risk_management.confidence_pct) >= 60
                ? "warning"
                : "danger",
          tooltip: "Model confidence score for this setup",
        },
      ].filter(Boolean)
    : [];

  return (
    <div className="trade-detail-content">
      {/* Header - hide if trade plan is showing to avoid duplication */}
      {header && !tradePlan?.enabled && (
        <div style={{ display: "grid", gap: 6, marginBottom: 20 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: header.columns || preset.headerColumns,
              gap: 12,
              alignItems: "center",
            }}
          >
            <div className="cell-major">{header.left}</div>
            <div className="cell-major">{header.center}</div>
            <div style={{ textAlign: "right" }}>{header.rightTop}</div>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: header.columns || preset.headerColumns,
              gap: 12,
              alignItems: "center",
            }}
          >
            <div className="minor-text">{header.leftMinor}</div>
            <div className="minor-text">{header.centerMinor}</div>
            <div style={{ textAlign: "right" }}>{header.rightBottom}</div>
          </div>
        </div>
      )}

      {/* Trade Plans */}
      {tradePlan?.enabled && (
        <div style={{ marginBottom: 20 }}>
          <div
            className="trade-plans-grid-v5"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
              gap: 16,
            }}
          >
            {displayPlanIds.map((planId, i) => {
              const isMain = planId === "main";
              const fallbackIdx = isMain
                ? 0
                : Number(String(planId).replace("suggested_", ""));
              const p = plans[fallbackIdx] || plans[0] || {};
              const isSelected = selectedPlanId === planId;
              const isBuy =
                String((planDrafts[planId] || p)?.direction).toUpperCase() ===
                "BUY";
              const isSimplified = !isSelected;
              const planValue = planDrafts[planId] || p;
              const headerPlan = {
                ...planValue,
                sid:
                  planValue?.sid || tradePlan?.sid || tradePlan?.tradeId || "",
                broker_trade_id:
                  planValue?.broker_trade_id ||
                  tradePlan?.broker_trade_id ||
                  tradePlan?.brokerId ||
                  "",
                execution_status:
                  planValue?.execution_status ||
                  tradePlan?.execution_status ||
                  "",
                dispatch_status:
                  planValue?.dispatch_status ||
                  tradePlan?.dispatch_status ||
                  "",
                rejection_reason:
                  planValue?.rejection_reason ||
                  tradePlan?.rejection_reason ||
                  "",
                strategy: planValue?.strategy || selectedAiPlan?.strategy || "",
                entry_model:
                  planValue?.entry_model || selectedAiPlan?.entry_model || "",
                risk_management: {
                  ...(selectedAiPlan?.risk_management || {}),
                  ...(planValue?.risk_management || {}),
                },
                confidence_pct:
                  planValue?.confidence_pct ??
                  selectedAiPlan?.risk_management?.confidence_pct ??
                  null,
                estimate_mins_that_entry_happens:
                  planValue?.estimate_mins_that_entry_happens ??
                  selectedAiPlan?.risk_management?.estimated_entry_mins ??
                  null,
              };
              return (
                <div
                  key={planId}
                  onClick={() => setSelectedPlanId(planId)}
                  style={{
                    cursor: "pointer",
                    border: isSelected
                      ? "2px solid var(--accent)"
                      : "1px solid var(--accent-soft)",
                    padding: "14px 12px",
                    borderRadius: 10,
                    background: isSelected
                      ? "rgba(255,255,255,0.05)"
                      : "rgba(255,255,255,0.015)",
                    boxShadow: isSelected
                      ? "0 4px 12px rgba(0,0,0,0.15)"
                      : "none",
                    overflow: "hidden",
                    minWidth: 0,
                  }}
                >
                  <PlanHeader
                    plan={{
                      ...headerPlan,
                      onSelectTP: (price, rrVal) => {
                        setPlanDrafts((prev) => {
                          let next = prev[planId] || p;
                          next = applyLinkedPlanChange(next, "tp", price);
                          if (rrVal)
                            next = applyLinkedPlanChange(next, "rr", rrVal);
                          return { ...prev, [planId]: next };
                        });
                        if (isMain) {
                          tradePlan.onChange?.("tp", price);
                          if (rrVal) tradePlan.onChange?.("rr", rrVal);
                        }
                      },
                    }}
                    symbol={
                      planValue?.symbol || p?.symbol || chart?.symbol || "Plan"
                    }
                    isBuy={isBuy}
                    simplified={isSimplified}
                    status={tradePlan.statusUi || tradePlan.status}
                    volume={tradePlan.volume}
                    pnl={tradePlan.pnl}
                  />

                  {isSelected && !tradePlan.hideEditor ? (
                    <MobileCollapseSection title="Trade Edit">
                      <TradePlanEditor
                        tradeContextId={tradePlan.tradeId || null}
                        tradeId={tradePlan.tradeId || null}
                        apiScope={tradePlan.apiScope || chart?.apiScope || ""}
                        value={planValue}
                        onChange={(k, v) => {
                          let nextPlan = null;
                          setPlanDrafts((prev) => {
                            nextPlan = applyLinkedPlanChange(
                              prev[planId] || p,
                              k,
                              v,
                            );
                            return {
                              ...prev,
                              [planId]: nextPlan,
                            };
                          });
                          if (isMain) {
                            tradePlan.onChange?.(k, v);
                            if (
                              (k === "entry" || k === "direction") &&
                              nextPlan
                            ) {
                              if (nextPlan.tp !== undefined)
                                tradePlan.onChange?.("tp", nextPlan.tp);
                              if (nextPlan.sl !== undefined)
                                tradePlan.onChange?.("sl", nextPlan.sl);
                            }
                          }
                        }}
                        onReset={handleTradePlanReset}
                        onGoTrade={tradePlan.onGoTrade}
                        onGoAnalyze={tradePlan.onGoAnalyze}
                        onCancel={tradePlan.onCancel}
                        onClose={tradePlan.onClose}
                        onSave={tradePlan.onSave}
                        onPromote={tradePlan.onPromote}
                        onAddSignal={(pos) =>
                          tradePlan.onAddSignal?.(pos || planValue, planId)
                        }
                        onAddTrade={(pos) =>
                          tradePlan.onAddTrade?.(pos || planValue, planId)
                        }
                        showSaveButton={tradePlan.showSaveButton}
                        showAddSignalButton={tradePlan.showAddSignalButton}
                        showAddTradeButton={tradePlan.showAddTradeButton}
                        showActionsInView={mode === "ai"}
                        addTradeLabel={tradePlan.addTradeLabel}
                        promoteLabel={tradePlan.promoteLabel}
                        showResetButton={tradePlan.showResetButton !== false}
                        busy={tradePlan.busy || {}}
                        disabled={Boolean(tradePlan.disabled)}
                        lockTradeFields={Boolean(tradePlan.lockTradeFields)}
                        viewOnly={Boolean(tradePlan.viewOnly)}
                        error={tradePlan.error || ""}
                        tradeStatus={tradePlan.execution_status || ""}
                      />
                    </MobileCollapseSection>
                  ) : (
                    <MobileCollapseSection title="Trade Edit">
                      <TradePlanEditor
                        value={planValue}
                        onCancel={tradePlan.onCancel}
                        onPromote={tradePlan.onPromote}
                        onAddSignal={(pos) =>
                          tradePlan.onAddSignal?.(pos || planValue, planId)
                        }
                        onAddTrade={(pos) =>
                          tradePlan.onAddTrade?.(pos || planValue, planId)
                        }
                        showSaveButton={false}
                        showAddSignalButton={
                          mode === "ai" && tradePlan.showAddSignalButton
                        }
                        showAddTradeButton={
                          mode === "ai" && tradePlan.showAddTradeButton
                        }
                        showActionsInView={mode === "ai"}
                        promoteLabel={tradePlan.promoteLabel}
                        showResetButton={false}
                        busy={tradePlan.busy || {}}
                        disabled={true}
                        viewOnly={true}
                        lockTradeFields={true}
                        tradeStatus={tradePlan.execution_status || ""}
                      />
                    </MobileCollapseSection>
                  )}
                  {isMain && tradePlan.successMessage && (
                    <div style={{ marginTop: 8 }}>
                      <span className="minor-text msg-success">
                        {tradePlan.successMessage}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {availableTabs.length ? (
        <TabBar
          value={mainTab}
          options={availableTabs.map((t) => ({
            label:
              t === "history"
                ? "Logs"
                : t.charAt(0).toUpperCase() + t.slice(1),
            value: t,
          }))}
          onChange={handleTabChange}
          className="snapshot-tabs-v2"
          style={{ marginBottom: 14 }}
          ariaLabel="Signal detail tabs"
        />
      ) : null}

      {isResponsePending ? (
        <div
          className="loading"
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            borderRadius: 10,
            border: "1px solid rgba(245, 158, 11, 0.25)",
            background: "rgba(245, 158, 11, 0.08)",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div className="spinner" style={{ width: 14, height: 14 }} />
          <span>{pendingResponseText}</span>
        </div>
      ) : null}

      {/* ANALYSIS TAB (Fields + Analysis) */}
      <div style={{ display: mainTab === "analysis" ? "block" : "none" }}>
        {mode === "ai" &&
        !chart?.symbol &&
        hasResponseText &&
        !selectedAiPlan &&
        (!selectedPlanJsonForDisplay ||
          Object.keys(selectedPlanJsonForDisplay).length === 0) ? (
          <div
            style={{
              padding: 16,
              background: "rgba(0,0,0,0.3)",
              borderRadius: 12,
              border: "1px solid var(--border)",
              marginBottom: 16,
            }}
          >
            <div
              className="minor-text"
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                marginBottom: 10,
              }}
            >
              Response
            </div>
            <div
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                lineHeight: 1.55,
                fontSize: 13,
              }}
            >
              {responseDisplayText || responseRawText}
            </div>
          </div>
        ) : null}
        {(() => {
          const p =
            plans.find(
              (pl, i) =>
                (i === 0 ? "main" : `suggested_${i}`) === selectedPlanId,
            ) ||
            plans[0] ||
            {};
          const planVal =
            selectedPlanId === "main"
              ? tradePlan?.value || p
              : planDrafts[selectedPlanId] || p;

          const dynamicRawSource =
            mode === "ai"
              ? selectedPlanJsonForDisplay &&
                typeof selectedPlanJsonForDisplay === "object" &&
                Object.keys(selectedPlanJsonForDisplay).length
                ? selectedPlanJsonForDisplay
                : selectedRawData && typeof selectedRawData === "object"
                  ? selectedRawData
                  : rawData && typeof rawData === "object"
                    ? rawData
                    : {}
              : {};

          if (
            mode === "ai" &&
            dynamicRawSource &&
            typeof dynamicRawSource === "object" &&
            Object.keys(dynamicRawSource).length > 0
          ) {
            const primitiveRows = Object.entries(dynamicRawSource).filter(
              ([, v]) =>
                v != null && v !== "" && !Array.isArray(v) && !isPlainObject(v),
            );
            const sectionRows = Object.entries(dynamicRawSource).filter(
              ([, v]) =>
                v != null && v !== "" && (Array.isArray(v) || isPlainObject(v)),
            );

            return (
              <div style={{ padding: "10px 4px", display: "grid", gap: 14 }}>
                {primitiveRows.length ? (
                  <div style={{ marginBottom: 4 }}>
                    <div
                      style={{
                        fontSize: 10,
                        textTransform: "uppercase",
                        color: "var(--muted)",
                        marginBottom: 6,
                        borderBottom: "1px solid rgba(255,255,255,0.06)",
                        paddingBottom: 3,
                      }}
                    >
                      Summary
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns:
                          "repeat(auto-fit, minmax(180px, 1fr))",
                        gap: 8,
                      }}
                    >
                      {primitiveRows.map(([k, v]) => (
                        <div
                          key={`summary_${k}`}
                          style={{
                            border: "1px solid rgba(255,255,255,0.07)",
                            borderRadius: 6,
                            padding: 8,
                            background: "rgba(255,255,255,0.02)",
                          }}
                        >
                          <div className="minor-text" style={{ fontSize: 9 }}>
                            {humanizeInfoKey(k)}
                          </div>
                          <div style={{ fontSize: 12, marginTop: 3 }}>
                            {stringifyDynamicInfoValue(v)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {sectionRows.map((pair, idx) =>
                  renderDynamicInfoSection(pair[0], pair[1], idx),
                )}
              </div>
            );
          }

          const fields = [
            {
              label: "Invalidation",
              value: planVal.invalidation || rawData.invalidation,
              fullWidth: true,
            },
            {
              label: "Entry Condition",
              value: planVal.entry_condition || rawData.entry_condition,
              fullWidth: true,
            },
            {
              label: "Exit Condition",
              value: planVal.exit_condition || rawData.exit_condition,
              fullWidth: true,
            },
            {
              label: "Reasons to skip",
              value:
                planVal.reasons_to_skip ||
                planVal.skipReasons ||
                rawData.reasons_to_skip,
              isList: true,
              fullWidth: true,
            },
            {
              label: "Skip Recommendation",
              value:
                planVal.skip_recommendation ||
                planVal.skip ||
                rawData.skip_recommendation,
              fullWidth: true,
            },
          ];

          const hasVal = (v) =>
            v !== null &&
            v !== undefined &&
            String(v) !== "" &&
            (Array.isArray(v) ? v.length > 0 : true);

          // Data extraction for Bias/Trend and Analysis
          const raw = rawData;
          const m = raw.market_analysis || {};
          const compactTfs = Array.isArray(raw.timeframes)
            ? raw.timeframes
            : Array.isArray(m.timeframes)
              ? m.timeframes.map((tf) => ({
                  ...tf,
                  phase: tf?.phase || tf?.market_phase || "",
                  poiAlign: String(tf?.poiAlign ?? tf?.poi_alignment ?? ""),
                  keyBreaks: Array.isArray(tf?.strongEvents)
                    ? tf.strongEvents
                    : [],
                }))
              : [];
          const analysisText = raw.analysis || m.analysis || "";
          const rawChecklist =
            m.confluence_checklist ||
            raw.confluence_checklist ||
            m.checklist ||
            raw.checklist ||
            [];
          let checklist = Array.isArray(rawChecklist) ? rawChecklist : [];

          if (isSchema24) {
            const plan24 = selectedPlanRaw || {};
            const tf24 = Array.isArray(raw?.market_analysis?.timeframes)
              ? raw.market_analysis.timeframes
              : [];
            const mx = plan24?.multiple_exits || {};
            const tp3Price = mx?.tp3?.price ?? mx?.full_tp?.price;
            const tp3Rr = mx?.tp3?.risk_reward ?? mx?.full_tp?.risk_reward;
            const mxRows = [
              mx?.break_even?.price != null
                ? `BE: ${mx.break_even.price} (${mx.break_even.risk_reward ?? "-"}r)`
                : "",
              mx?.tp1?.price != null
                ? `TP1: ${mx.tp1.price} (${mx.tp1.risk_reward ?? "-"}r)`
                : "",
              mx?.tp2?.price != null
                ? `TP2: ${mx.tp2.price} (${mx.tp2.risk_reward ?? "-"}r)`
                : "",
              tp3Price != null ? `TP3: ${tp3Price} (${tp3Rr ?? "-"}r)` : "",
            ].filter(Boolean);
            const skips = Array.isArray(
              plan24?.position_management?.skips_reasons,
            )
              ? plan24.position_management.skips_reasons
              : [];
            return (
              <div style={{ padding: "10px 4px" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 16,
                  }}
                >
                  <div>
                    <span className="minor-text">Strategy</span>
                    <div>
                      {plan24?.strategy ||
                        plan24?.strategy_name ||
                        brokerData?.strategy ||
                        "-"}
                    </div>
                  </div>
                  <div>
                    <span className="minor-text">Entry Model</span>
                    <div>
                      {plan24?.entry_model ||
                        plan24?.entryModel ||
                        brokerData?.entry_model ||
                        "-"}
                    </div>
                  </div>
                  <div>
                    <span className="minor-text">Trade Decision</span>
                    <div style={{ marginTop: 4 }}>
                      <span
                        className="badge badge-mini"
                        style={{
                          fontSize: 10,
                          padding: "3px 7px",
                          ...(plan24?.trade_decision
                            ? decisionBadgeStyle(plan24.trade_decision)
                            : semanticBadgeStyle("")),
                        }}
                      >
                        {plan24?.trade_decision || "-"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <span className="minor-text">Confidence</span>
                    <div>{plan24?.confidence_pct ?? "-"}</div>
                  </div>
                </div>
                {mxRows.length ? (
                  <div style={{ marginTop: 14 }}>
                    <span className="minor-text">Multiple Exits</span>
                    <div>{mxRows.join(" | ")}</div>
                  </div>
                ) : null}
                {tf24.length ? (
                  <div style={{ marginTop: 14 }}>
                    <span className="minor-text">Timeframes</span>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "repeat(3,minmax(0,1fr))",
                        gap: 8,
                      }}
                    >
                      {tf24.map((tf) => (
                        <div
                          key={String(tf?.tf || tf?.timeframe || Math.random())}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: 8,
                          }}
                        >
                          <div style={{ fontWeight: 700 }}>
                            {tf?.tf || tf?.timeframe || "-"}
                          </div>
                          <div className="minor-text">
                            {tf?.bias || "-"} · {tf?.trend || "-"}
                          </div>
                          <div className="minor-text" style={{ marginTop: 4 }}>
                            {tf?.price_prediction?.narrative ||
                              tf?.analysis ||
                              ""}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {skips.length ? (
                  <div style={{ marginTop: 14 }}>
                    <span className="minor-text">Skip Reasons</span>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {skips.map((x, i) => (
                        <li key={i}>
                          {typeof x === "string"
                            ? x
                            : x?.reason || JSON.stringify(x)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <div style={{ padding: "10px 4px" }}>
              {selectedAiPlan && (
                <div style={{ marginBottom: 18 }}>
                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      marginBottom: 12,
                    }}
                  >
                    {decisionBadges.map((item) => (
                      <span
                        key={item.key}
                        className="badge badge-mini"
                        title={item.tooltip || item.label}
                        style={{
                          padding: "3px 7px",
                          fontSize: 10,
                          ...(item.useDecisionTone
                            ? decisionBadgeStyle(item.toneSource)
                            : semanticBadgeStyle(item.toneSource)),
                        }}
                      >
                        {item.label}
                      </span>
                    ))}
                  </div>

                  {[
                    ["Context", selectedAiPlan.context],
                    ["Execution", selectedAiPlan.execution_plan],
                    ["Risk Management", selectedAiPlan.risk_management],
                  ].map(([title, section]) => {
                    const rows = compactInfoEntries(section);
                    if (!rows.length) return null;
                    return (
                      <div key={title} style={{ marginBottom: 14 }}>
                        <div
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            color: "var(--muted)",
                            marginBottom: 6,
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            paddingBottom: 3,
                          }}
                        >
                          {title}
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(5,minmax(120px,1fr))",
                            gap: 8,
                          }}
                        >
                          {rows.map(([k, v]) => (
                            (() => {
                              const showSemanticPill =
                                typeof v === "boolean" ||
                                [
                                  "yes",
                                  "no",
                                  "true",
                                  "false",
                                  "high",
                                  "low",
                                ].includes(String(v).toLowerCase());
                              const badgeStyle =
                                isDecisionField(k) || title === "Execution"
                                  ? decisionBadgeStyle(v)
                                  : showSemanticPill
                                    ? semanticBadgeStyle(v)
                                    : null;
                              return (
                            <div
                              key={k}
                              style={{
                                border: "1px solid rgba(255,255,255,0.07)",
                                borderRadius: 6,
                                padding: 8,
                                background: "rgba(255,255,255,0.02)",
                                gridColumn:
                                  typeof v === "object" ? "1 / -1" : "auto",
                              }}
                            >
                              <div
                                className="minor-text"
                                style={{ fontSize: 9 }}
                              >
                                {humanizeInfoKey(k)}
                              </div>
                              <div style={{ fontSize: 11, marginTop: 3 }}>
                                <span
                                  style={{
                                    display: "inline-block",
                                    padding:
                                      badgeStyle
                                        ? "1px 6px"
                                        : 0,
                                    borderRadius:
                                      badgeStyle
                                        ? 999
                                        : 0,
                                    ...(badgeStyle || {}),
                                  }}
                                >
                                  {renderInfoValue(v)}
                                </span>
                              </div>
                            </div>
                              );
                            })()
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {selectedAiPlan.analysis &&
                    typeof selectedAiPlan.analysis === "object" && (
                      <div style={{ marginBottom: 16 }}>
                        <div
                          style={{
                            fontSize: 10,
                            textTransform: "uppercase",
                            color: "var(--muted)",
                            marginBottom: 6,
                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                            paddingBottom: 3,
                          }}
                        >
                          Analysis
                        </div>
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(4,minmax(140px,1fr))",
                            gap: 8,
                          }}
                        >
                          {compactInfoEntries(selectedAiPlan.analysis).map(
                            ([groupKey, groupVal]) => (
                              <div
                                key={groupKey}
                                style={{
                                  border: "1px solid rgba(255,255,255,0.07)",
                                  borderRadius: 6,
                                  padding: 8,
                                  background: "rgba(255,255,255,0.02)",
                                }}
                              >
                                <div
                                  style={{
                                    fontSize: 10,
                                    fontWeight: 700,
                                    marginBottom: 6,
                                  }}
                                >
                                  {humanizeInfoKey(groupKey)}
                                </div>
                                {compactInfoEntries(groupVal).map(([k, v]) => (
                                  (() => {
                                    const showSemanticPill =
                                      typeof v === "boolean" ||
                                      [
                                        "yes",
                                        "no",
                                        "true",
                                        "false",
                                        "high",
                                        "low",
                                      ].includes(String(v).toLowerCase());
                                    const badgeStyle = isDecisionField(k)
                                      ? decisionBadgeStyle(v)
                                      : showSemanticPill
                                        ? semanticBadgeStyle(v)
                                        : null;
                                    return (
                                      <div key={k} style={{ marginBottom: 6 }}>
                                        <span
                                          className="minor-text"
                                          style={{ fontSize: 9 }}
                                        >
                                          {humanizeInfoKey(k)}
                                        </span>
                                        <div
                                          style={{ fontSize: 11, marginTop: 1 }}
                                        >
                                          <span
                                            style={{
                                              display: "inline-block",
                                              padding: badgeStyle
                                                ? "1px 6px"
                                                : 0,
                                              borderRadius: badgeStyle
                                                ? 999
                                                : 0,
                                              ...(badgeStyle || {}),
                                            }}
                                          >
                                            {renderInfoValue(v)}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  })()
                                ))}
                              </div>
                            ),
                          )}
                        </div>
                      </div>
                    )}
                </div>
              )}
              {/* ── AI Multi-Timeframe Analysis (at top) ── */}
              {(() => {
                const mta =
                  rawData?.multi_timeframes_analysis ||
                  rawData?.analysis_snapshot?.multi_timeframes_analysis;
                if (!mta || typeof mta !== "object") return null;
                const htfCtx = Array.isArray(mta.htf_context)
                  ? mta.htf_context
                  : [];
                const ltfAn = Array.isArray(mta.ltf_analysis)
                  ? mta.ltf_analysis
                  : [];
                const confluence =
                  mta.confluence_checklist || mta.confluence || {};
                const events = mta.events_patterns;
                const pdArrays = mta.pd_arrays_key_levels;
                const tradePlans = Array.isArray(rawData?.trade_plan)
                  ? rawData.trade_plan
                  : [];
                const sec = { marginBottom: 18 };
                const head = {
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--muted)",
                  marginBottom: 6,
                  borderBottom: "1px solid rgba(255,255,255,0.06)",
                  paddingBottom: 3,
                };
                const card = {
                  padding: "6px 8px",
                  borderRadius: 5,
                  border: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 11,
                  flex: "1 1 0",
                  minWidth: 120,
                };
                return (
                  <div style={{ marginBottom: 8 }}>
                    {(htfCtx.length > 0 || ltfAn.length > 0) && (
                      <div style={sec}>
                        <div style={head}>Trend / Bias</div>
                        {htfCtx.length > 0 && (
                          <>
                            <span
                              className="minor-text"
                              style={{ fontSize: 9 }}
                            >
                              HTF
                            </span>
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                flexWrap: "wrap",
                                marginTop: 2,
                                marginBottom: 6,
                              }}
                            >
                              {htfCtx.map((tf, i) => {
                                const b = String(tf?.bias || "").toUpperCase();
                                const up =
                                  b.includes("BULL") || b.includes("LONG");
                                const dn =
                                  b.includes("BEAR") || b.includes("SHORT");
                                const c = up
                                  ? "#26a69a"
                                  : dn
                                    ? "#ef5350"
                                    : "var(--muted)";
                                return (
                                  <div
                                    key={`h-${i}`}
                                    style={{ ...card, borderColor: `${c}30` }}
                                  >
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        color: c,
                                        marginBottom: 1,
                                      }}
                                    >
                                      {tf?.timeframe || "-"}{" "}
                                      {up ? "▲" : dn ? "▼" : ""}
                                    </div>
                                    <div
                                      className="minor-text"
                                      style={{ fontSize: 10 }}
                                    >
                                      {[
                                        tf?.trend,
                                        tf?.phase,
                                        tf?.market_structure?.narrative,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ") || "—"}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                        {ltfAn.length > 0 && (
                          <>
                            <span
                              className="minor-text"
                              style={{ fontSize: 9 }}
                            >
                              LTF
                            </span>
                            <div
                              style={{
                                display: "flex",
                                gap: 4,
                                flexWrap: "wrap",
                                marginTop: 2,
                              }}
                            >
                              {ltfAn.map((tf, i) => {
                                const b = String(tf?.bias || "").toUpperCase();
                                const up =
                                  b.includes("BULL") || b.includes("LONG");
                                const dn =
                                  b.includes("BEAR") || b.includes("SHORT");
                                const c = up
                                  ? "#26a69a"
                                  : dn
                                    ? "#ef5350"
                                    : "var(--muted)";
                                return (
                                  <div
                                    key={`l-${i}`}
                                    style={{ ...card, borderColor: `${c}30` }}
                                  >
                                    <div
                                      style={{
                                        fontWeight: 700,
                                        color: c,
                                        marginBottom: 1,
                                      }}
                                    >
                                      {tf?.timeframe || "-"}{" "}
                                      {up ? "▲" : dn ? "▼" : ""}
                                    </div>
                                    <div
                                      className="minor-text"
                                      style={{ fontSize: 10 }}
                                    >
                                      {[
                                        tf?.trend,
                                        tf?.phase,
                                        tf?.structure,
                                        tf?.market_structure?.narrative,
                                      ]
                                        .filter(Boolean)
                                        .join(" · ") || "—"}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                    {tradePlans.map((plan, pi) => {
                      const cl = plan?.entry_checklists;
                      if (!cl || typeof cl !== "object") return null;
                      const items = Object.entries(cl).filter(
                        ([, v]) => v != null,
                      );
                      if (!items.length) return null;
                      return (
                        <div key={`ec-${pi}`} style={sec}>
                          <div style={head}>
                            Entry Checklists
                            {tradePlans.length > 1 ? ` #${pi + 1}` : ""}
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: 3,
                            }}
                          >
                            {items.map(([k, v]) => (
                              <div
                                key={k}
                                style={{
                                  display: "flex",
                                  alignItems: "flex-start",
                                  gap: 5,
                                  fontSize: 11,
                                }}
                              >
                                <span
                                  style={{
                                    color: v ? "#26a69a" : "var(--muted)",
                                    fontWeight: 700,
                                    flexShrink: 0,
                                  }}
                                >
                                  {v ? "☑" : "☐"}
                                </span>
                                <span
                                  style={{
                                    color: v
                                      ? "var(--foreground)"
                                      : "var(--muted)",
                                  }}
                                >
                                  {String(k).replace(/_/g, " ")}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {tradePlans.map((plan, pi) => {
                      const rm = plan?.risk_management;
                      if (!rm || typeof rm !== "object") return null;
                      const rows = [
                        {
                          l: "Confidence",
                          v:
                            rm.confidence_pct != null
                              ? `${rm.confidence_pct}%`
                              : null,
                        },
                        {
                          l: "Volume",
                          v:
                            plan?.volume != null
                              ? `${Number(plan.volume).toFixed(2)} lots`
                              : null,
                        },
                        (() => {
                          const tpPnl =
                            plan?.broker_tp_pnl ??
                            plan?.planned_tp_pnl ??
                            plan?.tp_pnl;
                          const slPnl =
                            plan?.broker_sl_pnl ??
                            plan?.planned_sl_pnl ??
                            plan?.sl_pnl;
                          const fmtPnl = (v) => {
                            const n = Number(v);
                            if (!Number.isFinite(n)) return null;
                            const abs = Math.abs(n).toLocaleString(undefined, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 2,
                            });
                            return `${n >= 0 ? "+" : "-"}$${abs}`;
                          };
                          return [
                            { l: "PnL TP", v: fmtPnl(tpPnl), cls: "money-pos" },
                            { l: "PnL SL", v: fmtPnl(slPnl), cls: "money-neg" },
                          ];
                        })(),
                        { l: "Grade", v: rm.grade },
                        {
                          l: "Skip",
                          v:
                            rm.skip_decision !== undefined
                              ? String(rm.skip_decision)
                              : null,
                        },
                        { l: "Entry Trigger", v: rm.entry_trigger, f: 1 },
                        {
                          l: "Invalidation",
                          v: rm.pre_entry_invalidation,
                          f: 1,
                        },
                        { l: "Mid Inval.", v: rm.mid_trade_invalidation, f: 1 },
                        {
                          l: "Skip Reasons",
                          v: Array.isArray(rm.skip_reasons)
                            ? rm.skip_reasons.join(", ")
                            : rm.skip_reasons,
                          f: 1,
                        },
                      ]
                        .flat()
                        .filter((r) => r.v != null && String(r.v) !== "");
                      if (!rows.length) return null;
                      return (
                        <div key={`rm-${pi}`} style={sec}>
                          <div style={head}>
                            Risk Management
                            {tradePlans.length > 1 ? ` #${pi + 1}` : ""}
                          </div>
                          <div
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: "4px 12px",
                            }}
                          >
                            {rows.map((r, i) => (
                              <div
                                key={i}
                                style={{ gridColumn: r.f ? "1 / -1" : "auto" }}
                              >
                                <span
                                  className="minor-text"
                                  style={{ fontSize: 9 }}
                                >
                                  {r.l}
                                </span>
                                <div style={{ fontSize: 11, marginTop: 1 }}>
                                  <span
                                    className={r.cls || ""}
                                    style={{
                                      display: "inline-block",
                                      padding: "1px 6px",
                                      borderRadius: 999,
                                      ...(r.cls ? {} : semanticBadgeStyle(r.v)),
                                    }}
                                  >
                                    {r.v}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {confluence &&
                      typeof confluence === "object" &&
                      Object.keys(confluence).length > 0 && (
                        <div style={sec}>
                          <div style={head}>Confluence</div>
                          {["sell", "buy"].map((side) => {
                            const s = confluence[side];
                            if (!s || typeof s !== "object") return null;
                            const sc = s.weighted_score ?? s.score ?? "-";
                            const pa = Array.isArray(s.passed_items)
                              ? s.passed_items
                              : [];
                            const fa = Array.isArray(s.failed_critical)
                              ? s.failed_critical
                              : [];
                            return (
                              <div
                                key={side}
                                style={{ fontSize: 10, marginBottom: 2 }}
                              >
                                <span
                                  style={{
                                    fontWeight: 700,
                                    textTransform: "uppercase",
                                    color:
                                      side === "buy" ? "#26a69a" : "#ef5350",
                                  }}
                                >
                                  {side}
                                </span>
                                <span style={{ marginLeft: 6 }}>
                                  score={sc}
                                </span>
                                {pa.length > 0 && (
                                  <span
                                    style={{ marginLeft: 6, color: "#26a69a" }}
                                  >
                                    ✓{pa.join(",")}
                                  </span>
                                )}
                                {fa.length > 0 && (
                                  <span
                                    style={{ marginLeft: 6, color: "#ef5350" }}
                                  >
                                    ✗{fa.join(",")}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    {events &&
                      typeof events === "object" &&
                      Object.keys(events).length > 0 && (
                        <div style={sec}>
                          <div style={head}>Events &amp; Patterns</div>
                          <pre
                            style={{
                              fontSize: 10,
                              color: "var(--muted)",
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: 180,
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(events, null, 1)}
                          </pre>
                        </div>
                      )}
                    {pdArrays &&
                      typeof pdArrays === "object" &&
                      Object.keys(pdArrays).length > 0 && (
                        <div style={sec}>
                          <div style={head}>PD Arrays / Key Levels</div>
                          <pre
                            style={{
                              fontSize: 10,
                              color: "var(--muted)",
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              maxHeight: 180,
                              overflow: "auto",
                            }}
                          >
                            {JSON.stringify(pdArrays, null, 1)}
                          </pre>
                        </div>
                      )}
                    {(() => {
                      const draws = [
                        ...htfCtx.filter((t) => t?.draw_on_liquidity),
                        ...ltfAn.filter((t) => t?.draw_on_liquidity),
                      ];
                      if (!draws.length) return null;
                      return (
                        <div style={sec}>
                          <div style={head}>Draw on Liquidity</div>
                          {draws.map((d, i) => (
                            <div
                              key={i}
                              style={{ fontSize: 10, marginBottom: 1 }}
                            >
                              <span style={{ fontWeight: 600 }}>
                                {d?.timeframe || "TF"}:
                              </span>{" "}
                              {typeof d.draw_on_liquidity === "string"
                                ? d.draw_on_liquidity
                                : JSON.stringify(d.draw_on_liquidity)}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}

              {/* Other Fields (Invalidation, Conditions, etc.) */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "20px 30px",
                }}
              >
                {fields.map((f, i) => {
                  if (!hasVal(f.value)) return null;
                  return (
                    <div
                      key={i}
                      style={{
                        gridColumn: f.fullWidth ? "1 / -1" : "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      <span className="minor-text">{f.label}</span>
                      <div
                        style={{
                          fontSize: "13px",
                          color: "var(--foreground)",
                          fontWeight: 500,
                          lineHeight: 1.5,
                        }}
                      >
                        {f.isList ? (
                          <ul
                            style={{
                              margin: 0,
                              paddingLeft: 18,
                              fontSize: "12px",
                              opacity: 0.9,
                            }}
                          >
                            {(Array.isArray(f.value) ? f.value : []).map(
                              (item, idx) => {
                                if (
                                  typeof item === "string" ||
                                  typeof item === "number" ||
                                  typeof item === "boolean"
                                ) {
                                  return <li key={idx}>{String(item)}</li>;
                                }
                                if (item && typeof item === "object") {
                                  const reason = formatCompactText(
                                    item.reason ||
                                      item.item ||
                                      item.condition ||
                                      item.text ||
                                      "",
                                  );
                                  const severity = formatCompactText(
                                    item.severity || "",
                                  );
                                  const rendered = [reason, severity]
                                    .filter(Boolean)
                                    .join(" | ");
                                  return (
                                    <li key={idx}>
                                      {rendered || formatCompactText(item)}
                                    </li>
                                  );
                                }
                                return <li key={idx}>-</li>;
                              },
                            )}
                          </ul>
                        ) : f.value && typeof f.value === "object" ? (
                          <pre
                            style={{
                              margin: 0,
                              whiteSpace: "pre-wrap",
                              wordBreak: "break-word",
                              fontFamily:
                                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                              fontSize: 12,
                            }}
                          >
                            {JSON.stringify(f.value, null, 2)}
                          </pre>
                        ) : (
                          String(f.value ?? "")
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}
      </div>

      {/* INFO TAB (Trades only) */}
      <div style={{ display: mainTab === "info" ? "block" : "none" }}>
        {metaItems.length > 0 &&
          (() => {
            const hasVal = (x) =>
              x &&
              (x.spacer ||
                (x.value !== null &&
                  x.value !== undefined &&
                  String(x.value) !== ""));
            const isMeta = (x) =>
              x.label === "Metadata" ||
              x.label === "Raw Metadata" ||
              x.label === "Raw JSON";
            const brokerGroups = new Set([
              "account",
              "identity",
              "pnl",
              "sizing",
            ]);
            const accountItems = metaItems.filter(
              (x) =>
                x &&
                (x.spacer || brokerGroups.has(x?.group)) &&
                !isMeta(x) &&
                hasVal(x),
            );
            const rawJsonItem = metaItems.find(
              (x) =>
                x &&
                (x.label === "Metadata" ||
                  x.label === "Raw Metadata" ||
                  x.label === "Raw JSON") &&
                (x.group === "account" || mode === "trade"),
            );

            if (!accountItems.length && !rawJsonItem) {
              return (
                <div className="minor-text" style={{ padding: 20 }}>
                  No broker data available for this trade.
                </div>
              );
            }

            const renderField = (item, i) => (
              <div
                key={`${item.label}-${i}`}
                style={{
                  visibility: item.spacer ? "hidden" : "visible",
                  gridColumn: item.fullWidth ? "1 / -1" : "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                  pointerEvents: item.spacer ? "none" : "auto",
                }}
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  {item.spacer ? "" : item.label}
                </span>
                <div
                  style={{
                    fontSize: "12.5px",
                    color: "var(--foreground)",
                    wordBreak: "break-word",
                    fontWeight: 500,
                    ...(item.valueStyle || {}),
                  }}
                >
                  {item.spacer
                    ? ""
                    : item.renderValue
                    ? item.renderValue
                    : typeof item.value === "object"
                    ? JSON.stringify(item.value, null, 2)
                    : item.value}
                </div>
              </div>
            );

            return (
              <div style={{ padding: "0 4px" }}>
                <div
                  className="fields-grid trade-info-grid"
                  style={{
                    display: "grid",
                    gap: 16,
                    padding: 20,
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    marginBottom: 16,
                  }}
                >
                  {accountItems.map(renderField)}
                </div>

                {rawJsonItem && (
                  <div style={{ marginTop: 24 }}>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 12,
                        paddingLeft: 4,
                      }}
                    >
                      Broker Metadata
                    </div>
                    <div
                      style={{
                        padding: 16,
                        background: "rgba(0,0,0,0.3)",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,0.05)",
                      }}
                    >
                      <SmartContent
                        content={
                          typeof rawJsonItem.value === "string"
                            ? (() => {
                                try {
                                  return JSON.parse(rawJsonItem.value);
                                } catch (e) {
                                  return { raw: rawJsonItem.value };
                                }
                              })()
                            : rawJsonItem.value
                        }
                        mode="readonly"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
      </div>

      {/* CHART TAB */}
      <div style={{ display: mainTab === "chart" ? "block" : "none" }}>
        <Suspense
          fallback={<div className="loading-container">Loading chart...</div>}
        >
          <SymbolChart
            key={chartInstanceKey}
            symbol={selectedPlanSymbol || chart?.symbol}
            provider={chart?.provider || ""}
            timeframes={effectiveChartTfs}
            timeframePresets={mode === "trade" ? TRADE_CHART_TF_PRESET_OPTIONS : []}
            timeframeOptions={mode === "trade" ? TRADE_CHART_INDIVIDUAL_TF_OPTIONS : []}
            onTimeframesChange={
              mode === "trade"
                ? (nextTfs) => setSelectedTfs(sortTimeframes(nextTfs || [], "desc"))
                : null
            }
            defaultMode={chartModeTab || chart?.mode || "live"}
            onModeChange={(nextMode) => {
              const normalizedMode = String(nextMode || "live").trim().toLowerCase();
              setChartModeTab(normalizedMode);
              setChartAutoReplayRequested(false);
              if (mainTab === "chart") {
                window.location.hash = hashForDetailState("chart", normalizedMode);
              }
            }}
            autoLoadOnMount={true}
            showObjectInspector={mode === "trade"}
            enableChartObjects={false}
            showEventMarkers={true}
            initialGridCols={
              Number.isFinite(Number(chart?.initialGridCols)) &&
              Number(chart?.initialGridCols) > 0
                ? Number(chart?.initialGridCols)
                : 2
            }
            initialBarsCount={effectiveChartInitialBarsCount}
            persistMarketUiConfig={mode !== "trade"}
            anchorToTradeTime={
              typeof chart?.anchorToTradeTime === "boolean"
                ? chart.anchorToTradeTime
                : mode === "trade"
            }
            side={chartTradeSide}
            action={chartTradeAction}
            entryPrice={chartEntryPrice}
            slPrice={chartSlPrice}
            tpPrice={chartTpPrice}
            tp1Price={chartTp1Price}
            tp2Price={chartTp2Price}
            tp3Price={chartTp3Price}
            onRequestPlanRefresh={chart?.onRequestPlanRefresh}
            planRefreshNonce={chart?.planRefreshNonce || 0}
            planRefreshError={chart?.planRefreshError || ""}
            createdAt={chartCreatedAt}
            openedAt={chartOpenedAt}
            closedAt={chartClosedAt}
            createdAtSec={chartCreatedAtUnix}
            openedAtSec={chartOpenedAtUnix}
            closedAtSec={chartClosedAtUnix}
            closeStatus={chartCloseStatus}
            exitPrice={chartExitPriceForClosedTrade}
            pnlRealized={chartPnlRealizedForClosedTrade}
            tradeLabel={chartTradeLabel}
            onPlanLevelChange={handleChartPlanLevelChange}
            analysisSnapshot={chart2AnalysisSnapshot}
            hasTradePlan={Boolean(
              (Array.isArray(response?.tradePlans) &&
                response.tradePlans.length > 0) ||
              (Array.isArray(rawData?.trade_plan) &&
                rawData.trade_plan.length > 0) ||
              tradePlan?.value?.entry ||
              tradePlan?.value?.tp ||
              tradePlan?.value?.sl,
            )}
            hasAnalysis={Boolean(
              selectedRawData && Object.keys(selectedRawData).length > 0,
            )}
            profile={chart?.profile || tradePlan?.value?.profile || "day"}
            attachedSnapshotFiles={
              Array.isArray(selectedRawData?.snapshot_files)
                ? selectedRawData.snapshot_files
                : Array.isArray(response?.snapshot_files)
                  ? response.snapshot_files
                  : Array.isArray(response?.metadata?.snapshot_files)
                    ? response.metadata.snapshot_files
                    : []
            }
            tradeSid={chartTradeSid}
            apiScope={chart?.apiScope || tradePlan?.apiScope || ""}
            trades={singleTradeReplayTrades}
            backtestReplay={singleTradeReplayConfig}
            autoStartReplay={chartAutoReplayRequested}
            onQuickTradeIntent={(intent) => {
              const side = String(intent?.side || "BUY").toUpperCase();
              const action = String(intent?.action || "ENTRY").toUpperCase();
              const price = Number(intent?.price);
              const suggestedTp = parsePositiveNumLoose(intent?.tp);
              const suggestedSl = parsePositiveNumLoose(intent?.sl);
              const requestedPlan = String(
                intent?.plan_id || "P1",
              ).toUpperCase();
              const requestedPlanNum = Number(
                String(requestedPlan).replace(/^P/i, ""),
              );
              const planIndex =
                Number.isFinite(requestedPlanNum) && requestedPlanNum > 0
                  ? requestedPlanNum - 1
                  : 0;
              const planId = planIndex <= 0 ? "main" : `suggested_${planIndex}`;
              const nextTradeType =
                String(
                  intent?.trade_type || intent?.order_type || "limit",
                ).trim().toLowerCase() === "market"
                  ? "market"
                  : "limit";
              const pricePrecision = resolveTradePricePrecision(
                selectedPlanSymbol || chart?.symbol || tradePlan?.value?.symbol || "",
                [price, suggestedTp, suggestedSl].filter((value) =>
                  Number.isFinite(value),
                ),
              );
              const formatPlanPrice = (value) =>
                formatTradePriceField(value, pricePrecision);
              if (action === "ENTRY") {
                setSelectedPlanId(planId);
              }
              if (
                planId === "main" &&
                action === "ENTRY" &&
                typeof tradePlan?.onApplyQuickTradeIntent === "function"
              ) {
                const entry = parsePositiveNumLoose(intent?.price);
                const tp = parsePositiveNumLoose(intent?.tp);
                const sl = parsePositiveNumLoose(intent?.sl);
                const rr =
                  entry != null &&
                  tp != null &&
                  sl != null &&
                  Math.abs(entry - sl) > 0
                    ? Math.abs(tp - entry) / Math.abs(entry - sl)
                    : null;
                setPlanDrafts((prev) => ({
                  ...prev,
                  main: {
                    ...(prev?.main || tradePlan?.value || plans?.[0] || {}),
                    direction: side,
                    trade_type: nextTradeType,
                    order_type: nextTradeType,
                    entry: formatPlanPrice(entry),
                    tp: formatPlanPrice(tp),
                    tp1: formatPlanPrice(tp),
                    tp2: "",
                    tp3: "",
                    sl: formatPlanPrice(sl),
                    rr: rr != null ? String(Number(rr.toFixed(3))) : "",
                    price_precision: pricePrecision,
                    source_id:
                      String(intent?.source_id || intent?.source || "auto_chart").trim() ||
                      "auto_chart",
                    source:
                      String(intent?.source || intent?.source_id || "auto_chart").trim() ||
                      "auto_chart",
                    strategy: String(intent?.strategy || "").trim(),
                    entry_model: String(
                      intent?.entry_model || intent?.entryModel || "",
                    ).trim(),
                  },
                }));
                tradePlan.onApplyQuickTradeIntent(intent);
                return;
              }
              const applyToPlan = (field, value) => {
                if (planId === "main") {
                  tradePlan?.onChange?.(field, value);
                  return;
                }
                setPlanDrafts((prev) => ({
                  ...prev,
                  [planId]: applyLinkedPlanChange(
                    prev?.[planId] ||
                      plans?.[planIndex] || {
                        ...(tradePlan?.value || plans?.[0] || {}),
                        direction:
                          planIndex === 1
                            ? "SELL"
                            : String(side || "BUY").toUpperCase(),
                        entry: "",
                        tp: "",
                        sl: "",
                        rr: "",
                      },
                    field,
                    value,
                  ),
                }));
              };
              const withTpSlots = (planDraft, newTp) => {
                const base = planDraft || {};
                const sideDir = String(
                  base?.direction || side || "BUY",
                ).toUpperCase();
                const prices = [base.tp1, base.tp2, base.tp3]
                  .map((x) => parseNumLoose(x))
                  .filter((x) => x != null);
                const n = Number(newTp);
                if (Number.isFinite(n)) prices.push(n);
                const uniq = Array.from(
                  new Set(prices.map((x) => Number(x.toFixed(8)))),
                );
                uniq.sort((a, b) => (sideDir === "SELL" ? b - a : a - b));
                const out = {
                  ...base,
                  tp1: formatPlanPrice(uniq[0]),
                  tp2: formatPlanPrice(uniq[1]),
                  tp3: formatPlanPrice(uniq[2]),
                };
                out.tp = out.tp1 || "";
                return out;
              };
              if (tradePlan?.onChange || planId !== "main") {
                if (/^TP[123]$/.test(action)) {
                  if (Number.isFinite(price)) {
                    const slot = action.toLowerCase();
                    applyToPlan(slot, formatPlanPrice(price));
                    if (slot === "tp1") applyToPlan("tp", formatPlanPrice(price));
                  }
                } else if (action === "TP") {
                  if (Number.isFinite(price)) {
                    const current =
                      (planId === "main"
                        ? tradePlan?.value
                        : planDrafts?.[planId] || plans?.[planIndex]) || {};
                    const nextPlan = withTpSlots(current, price);
                    applyToPlan("tp1", nextPlan.tp1 || "");
                    applyToPlan("tp2", nextPlan.tp2 || "");
                    applyToPlan("tp3", nextPlan.tp3 || "");
                    applyToPlan("tp", nextPlan.tp || "");
                  }
                } else if (action === "SL") {
                  if (Number.isFinite(price)) applyToPlan("sl", formatPlanPrice(price));
                } else if (action === "CLEAR_TP") {
                  applyToPlan("tp", "");
                  applyToPlan("tp1", "");
                  applyToPlan("tp2", "");
                  applyToPlan("tp3", "");
                } else if (action === "CLEAR_SL") {
                  applyToPlan("sl", "");
                } else if (action === "CLEAR_ENTRY") {
                  applyToPlan("entry", "");
                } else {
                  applyToPlan("trade_type", nextTradeType);
                  applyToPlan("direction", side);
                  if (Number.isFinite(price)) {
                    applyToPlan("entry", formatPlanPrice(price));
                  } else {
                    applyToPlan("entry", "");
                  }
                  if (suggestedTp != null) {
                    applyToPlan("tp", formatPlanPrice(suggestedTp));
                    applyToPlan("tp1", formatPlanPrice(suggestedTp));
                  } else {
                    applyToPlan("tp", "");
                    applyToPlan("tp1", "");
                  }
                  applyToPlan("tp2", "");
                  applyToPlan("tp3", "");
                  applyToPlan(
                    "sl",
                    formatPlanPrice(suggestedSl),
                  );
                }
              }
            }}
            selectedTradePlanGroup={selectedTradePlanGroup}
            onTradePlanGroupChange={(planGroup) => {
              const planNum = Number(
                String(planGroup || "").replace(/^P/i, ""),
              );
              if (!Number.isFinite(planNum) || planNum <= 1) {
                setSelectedPlanId("main");
                return;
              }
              const nextPlanId = `suggested_${planNum - 1}`;
              const existsInResponse = planNum - 1 < plans.length;
              const existsInDraft = Boolean(planDrafts?.[nextPlanId]);
              if (!existsInResponse && !existsInDraft) return;
              setSelectedPlanId(nextPlanId);
            }}
            showEditButton={chart?.showEditButton !== false}
            showTradeButton={chart?.showTradeButton !== false}
            showAnalyzeButton={chart?.showAnalyzeButton !== false}
            skipFetch={false}
          />
        </Suspense>
      </div>

      {/* FILES TAB (Trades only) */}
      <div style={{ display: mainTab === "files" ? "block" : "none" }}>
        <Suspense
          fallback={<div className="loading-card">Loading files...</div>}
        >
          <TradeDraftTab
            tradeSid={
              tradePlan?.tradeId ||
              
              chart?.tradeId ||
              response?.sid ||
              response?.id ||
              null
            }
            apiScope={chart?.apiScope || tradePlan?.apiScope || ""}
            symbol={chart?.symbol || null}
            snapshotFiles={
              response?.snapshotFiles ||
              response?.snapshot_files ||
              response?.metadata?.snapshot_files ||
              []
            }
          />
        </Suspense>
      </div>

      {/* JSON TAB */}
      <div style={{ display: mainTab === "json" ? "block" : "none" }}>
        <div
          style={{
            padding: 16,
            background: "rgba(0,0,0,0.3)",
            borderRadius: 12,
            minHeight: "400px",
            maxHeight: "800px",
            overflow: "auto",
          }}
        >
          {selectedPlanJsonForDisplay &&
          typeof selectedPlanJsonForDisplay === "object" &&
          Object.keys(selectedPlanJsonForDisplay).length > 0 ? (
            <SmartContent
              content={selectedPlanJsonForDisplay}
              mode="readonly"
              showCopy
            />
          ) : responseRawText ? (
            <pre
              style={{
                margin: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                fontSize: 12,
                lineHeight: 1.55,
              }}
            >
              {responseRawText}
            </pre>
          ) : (
            <div className="minor-text">
              {isResponsePending ? pendingResponseText : "No JSON result yet."}
            </div>
          )}
        </div>
      </div>

      {/* HISTORY TAB */}
      <div style={{ display: mainTab === "history" ? "block" : "none" }}>
        <Suspense fallback={<div className="loading-card">Loading logs...</div>}>
          <TradeLogsTab
            tradeSid={
              tradePlan?.tradeId ||
              chart?.tradeId ||
              response?.sid ||
              response?.id ||
              null
            }
            emptyText={preset.historyEmptyText}
          />
        </Suspense>
      </div>
    </div>
  );
}
