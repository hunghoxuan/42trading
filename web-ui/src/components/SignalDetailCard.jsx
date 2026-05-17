import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { TradePlanEditor } from "./TradePlanEditor";
import {
  buildHeaderMeta,
  formatNote,
  renderHistoryItem,
  shouldShowPnl,
  applyLinkedPlanChange,
  formatNum3,
} from "../utils/signalDetailUtils";
const SymbolChart = lazy(() => import("./charts/SymbolChart"));
import { SmartContent } from "./SmartContent";
import { sortTimeframes } from "../utils/format";
import { api } from "../api";
import { NotificationHub } from "../services/NotificationHub";

const TF_WEIGHTS = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "4h": 240,
  d: 1440,
  w: 10080,
  m: 43200,
};

const DEFAULT_TF_TABS = ["ENTRY", "1m", "5m", "15m", "1h", "4h", "d", "W"];
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
    historyEmptyText: "No signal events.",
  },
  trade: {
    headerColumns: "minmax(0, 1fr) minmax(0, 1.25fr) minmax(120px, 0.55fr)",
    historyLoadingText: "Fetching execution logs...",
    historyEmptyText: "No trade events.",
  },
};

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

function parseNumLoose(v) {
  if (v == null) return null;
  const n = Number(String(v).trim().replace(",", "."));
  return Number.isFinite(n) ? n : null;
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
    toCandidate(p?.tp, p?.rr ?? p?.risk_reward, "tp"),
    toCandidate(p?.take_profit, p?.rr ?? p?.risk_reward, "take_profit"),
    toCandidate(p?.tp1, p?.risk_reward, "tp1"),
    toCandidate(
      p?.multiple_exits?.tp1?.price,
      p?.multiple_exits?.tp1?.risk_reward,
      "multiple_exits.tp1",
    ),
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
  const side = String(
    p?.direction || p?.action || p?.side || "BUY",
  ).toUpperCase();
  const direction = side.includes("SELL") ? "SELL" : "BUY";
  const entry = parseNumLoose(p?.entry ?? p?.entry_price ?? p?.target_price);
  const sl = parseNumLoose(p?.sl ?? p?.stop_loss);
  const chosen = choosePrimaryTpAndRr(p, {
    entry: entry,
    direction,
  });
  const tpNum = parseNumLoose(chosen.tp);
  const rrRaw = parseNumLoose(p?.rr ?? p?.risk_reward);
  let rr = null;
  if (
    entry != null &&
    sl != null &&
    tpNum != null &&
    entry !== sl
  ) {
    rr = Math.abs(tpNum - entry) / Math.abs(entry - sl);
  }
  if (rr == null) rr = rrRaw;
  return {
    ...p,
    ai_rr: rrRaw == null ? "" : String(rrRaw),
    direction,
    entry: entry == null ? "" : String(entry),
    tp: chosen.tp,
    sl: sl == null ? "" : String(sl),
    rr: rr == null ? "" : String(rr),
    trade_type: String(p?.type || p?.order_type || "limit").toLowerCase(),
  };
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

function mergePlanKeepingFresh(basePlan = {}, previousDraft = {}) {
  const next = { ...basePlan };
  const prev = previousDraft || {};
  Object.entries(prev).forEach(([k, v]) => {
    if (v === undefined) return;
    const freshVal = next[k];
    // Keep fresh non-zero numeric-ish values from latest analysis payload.
    if (
      typeof freshVal !== "undefined" &&
      freshVal !== null &&
      String(freshVal).trim() !== ""
    ) {
      const freshNum = parseNumLoose(freshVal);
      const prevNum = parseNumLoose(v);
      if (
        freshNum != null &&
        (freshNum !== 0 || prevNum === 0 || prevNum == null)
      ) {
        return;
      }
    }
    next[k] = v;
  });
  return next;
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

  const rrCandidate =
    plan.rr ??
    (entry != null && sl != null && tp != null && Math.abs(entry - sl) > 0
      ? Math.abs(tp - entry) / Math.abs(entry - sl)
      : null);
  const rrNum = Number(String(rrCandidate ?? "").replace(",", "."));
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
    riskMgmt?.estimate_mins_that_entry_happens ??
      plan?.estimate_mins_that_entry_happens,
  );
  const estMinsVal = estMinsNum != null ? `${Math.round(estMinsNum)}m` : "";
  const skipDecisionVal = String(
    riskMgmt?.skip_decision ?? plan?.skip_decision ?? "",
  ).trim();
  const partials = Array.isArray(plan.partial_tps) ? plan.partial_tps : [];
  const strategy = plan.strategy || "";
  const entryModel = plan.entry_model || plan.entryModel || "";
  const sourceVal = plan.source || plan.model || "";
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
            {plan.entry || "-"} →{" "}
            <span style={{ color: "var(--accent)" }}>
              {plan.tp || fallbackTp || "-"}
            </span>{" "}
            / <span style={{ color: "var(--bearish)" }}>{plan.sl || "-"}</span>
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
        {/* Row 1: status + pnl */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {status && (
            <span
              className={`badge ${status.cls} badge-mini`}
              style={{ padding: "2px 6px", fontSize: "9px" }}
            >
              {status.label}
            </span>
          )}
          {pnl && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--foreground)",
              }}
            >
              {pnl}
            </span>
          )}
        </div>

        {/* Row 2: estimate_bars / confidence_level / risk_level badges */}
        {(estimatedBars != null || confidenceLevel || riskLevel) && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
            {estimatedBars != null && (
              <span
                className="badge badge-mini"
                style={{
                  background: "rgba(120,120,200,0.15)",
                  color: "var(--muted-bright)",
                  border: "1px solid rgba(120,120,200,0.25)",
                  padding: "1px 5px",
                  fontSize: "9px",
                }}
              >
                ~{estimatedBars}b
              </span>
            )}
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
        {(sourceVal ||
          strategy ||
          entryModel ||
          confidenceText ||
          riskLevel ||
          gradeVal ||
          confidenceBadgeVal ||
          estMinsVal ||
          skipDecisionVal) && (
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
            {sourceVal && (
              <span
                className="minor-text"
                style={{ fontSize: "9px", fontWeight: 500, opacity: 0.7 }}
              >
                {sourceVal}
              </span>
            )}
            {strategy && (
              <span
                className="minor-text"
                style={{
                  fontSize: "9px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.02em",
                  whiteSpace: "nowrap",
                }}
              >
                {strategy}
              </span>
            )}
            {entryModel && (
              <span
                className="minor-text"
                style={{
                  fontSize: "9px",
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                }}
              >
                {entryModel}
              </span>
            )}
            {confidenceText && (
              <span
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
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
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
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
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
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
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  whiteSpace: "nowrap",
                }}
              >
                {confidenceBadgeVal}
              </span>
            )}
            {estMinsVal && (
              <span
                className="badge badge-mini"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  whiteSpace: "nowrap",
                }}
              >
                {estMinsVal}
              </span>
            )}
            {skipDecisionVal && (
              <span
                className="badge badge-mini"
                style={{
                  padding: "1px 5px",
                  fontSize: "9px",
                  whiteSpace: "nowrap",
                  textTransform: "capitalize",
                }}
              >
                {skipDecisionVal}
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
      {successMessage && isThisPlanAdding && (
        <div style={{ marginTop: 12 }}>
          <span className="minor-text msg-success">{successMessage}</span>
        </div>
      )}
    </div>
  );
}

export default function SignalDetailCard({
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
    chart?.tvSymbol || toTradingViewSymbol(chart?.symbol || ""),
  ).trim();

  const availableTabs = useMemo(() => {
    if (hideTabsBeforeResponse && !response?.hasData) return [];
    if (!chart?.symbol) return [];

    const tabs = [];
    const hasRaw =
      response?.raw &&
      typeof response.raw === "object" &&
      Object.keys(response.raw).length > 0;
    const hasPlans =
      Array.isArray(response?.tradePlans) && response.tradePlans.length > 0;
    const trulyHasData = hasRaw || hasPlans;

    if (chart?.enabled) tabs.push("chart");
    if (trulyHasData || metaItems?.length) tabs.push("info");
    if (mode === "trade") tabs.push("broker");
    tabs.push("json");
    if (history?.enabled) tabs.push("history");
    return tabs;
  }, [
    chart?.enabled,
    chart?.symbol,
    response?.hasData,
    response?.raw,
    response?.tradePlans,
    history?.enabled,
    metaItems,
    hideTabsBeforeResponse,
  ]);

  const [mainTab, setMainTab] = useState("chart");
  const [selectedTfs, setSelectedTfs] = useState([]);
  const [chartModes, setChartModes] = useState(["static", "live"]);
  const [multiChartData, setMultiChartData] = useState({});

  const [loadingCharts, setLoadingCharts] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState("main");
  const [planDrafts, setPlanDrafts] = useState({});
  const rawSource =
    response?.raw || response?.raw_json || response?.metadata || {};
  const derivedPlansFromRaw = useMemo(() => {
    if (!rawSource || typeof rawSource !== "object") return [];
    if (Array.isArray(rawSource.trade_plan) && rawSource.trade_plan.length) {
      return rawSource.trade_plan.map((p) => normalizeRawPlan(p || {}));
    }
    if (rawSource.trade_plan && typeof rawSource.trade_plan === "object") {
      return [normalizeRawPlan(rawSource.trade_plan)];
    }
    if (
      rawSource.entry_price != null ||
      rawSource.entry != null ||
      rawSource.stop_loss != null ||
      rawSource.sl != null ||
      rawSource.tp != null ||
      rawSource.multiple_exits
    ) {
      return [normalizeRawPlan(rawSource)];
    }
    return [];
  }, [rawSource]);
  const activeSymbol = normalizePlanSymbol(
    chart?.symbol || response?.symbol || tradePlan?.value?.symbol || "",
  );
  const responsePlans =
    Array.isArray(response?.tradePlans) && response.tradePlans.length
      ? response.tradePlans.filter((p) => {
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
            rr: tradePlan?.value?.rr,
            strategy: tradePlan?.value?.strategy,
            entryModel: tradePlan?.value?.entry_model,
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
            symbol: tradePlan?.value?.symbol || chart?.symbol || "",
            note: tradePlan?.value?.note || "",
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
                rr: tradePlan?.value?.rr,
                strategy: tradePlan?.value?.strategy,
                entryModel: tradePlan?.value?.entry_model,
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

  const hasTradePlanData = useMemo(() => {
    const p = plans[0] || {};
    return Boolean(p.entry || p.tp || p.sl);
  }, [plans]);

  useEffect(() => {
    if (!hasTradePlanData && mainTab === "json") {
      // stay on json if user explicitly went there
    } else if (!hasTradePlanData && mainTab !== "chart") {
      setMainTab("chart");
    }
  }, [hasTradePlanData]);

  useEffect(() => {
    if (!availableTabs.includes(mainTab))
      setMainTab(availableTabs[0] || "info");
  }, [availableTabs, mainTab]);

  useEffect(() => {
    if (tradePlan?.enabled) {
      setSelectedPlanId("main");
    }
  }, [tradePlan?.enabled]);

  useEffect(() => {
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
        next[planId] = mergePlanKeepingFresh(normalized, prev?.[planId] || {});
      });
      if (!next.main) {
        next.main = {
          ...(tradePlan?.value || {}),
          direction: tradePlan?.value?.direction || "BUY",
        };
      }
      return next;
    });
  }, [plans, response?.tradePlans, tradePlan?.value]);

  useEffect(() => {
    if (!displayPlanIds.includes(selectedPlanId)) {
      setSelectedPlanId("main");
    }
  }, [displayPlanIds, selectedPlanId]);

  useEffect(() => {
    if (chart?.enabled) {
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
    }
  }, [chart?.enabled, chart?.interval, chart?.profileTfs, tradePlan?.enabled]);

  useEffect(() => {
    let isMounted = true;
    if (
      mainTab === "chart" &&
      chart?.symbol &&
      selectedTfs.length > 0 &&
      chartModes.includes("static")
    ) {
      const load = async () => {
        setLoadingCharts(true);
        try {
          const res = await fetch(
            `/api/charts/multi?symbol=${encodeURIComponent(chart.symbol)}&tfs=${encodeURIComponent(selectedTfs.join(","))}`,
          );
          const text = await res.text();
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = { ok: false };
          }
          if (isMounted && data.ok) setMultiChartData(data.data || {});
        } catch (e) {
          // ignore
        } finally {
          if (isMounted) setLoadingCharts(false);
        }
      };
      load();
    }
    return () => {
      isMounted = false;
    };
  }, [mainTab, chart?.symbol, selectedTfs, chartModes]);

  const toggleTf = (tf) => {
    const t = tf.toLowerCase();
    setSelectedTfs((prev) => {
      const next = prev.includes(t)
        ? prev.filter((x) => x !== t)
        : [...prev, t];
      return sortTimeframes(next, "desc");
    });
  };

  const toggleMode = (m) =>
    setChartModes((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );

  const effectiveTfs = useMemo(() => {
    const required = ["d", "4h", "15m", "5m"];
    const base = Array.isArray(selectedTfs)
      ? selectedTfs.map((t) => String(t || "").toLowerCase())
      : [];
    const merged = [...new Set([...base, ...required])].filter(Boolean);
    return sortTimeframes(merged, "desc");
  }, [selectedTfs]);

  // Use raw data from multiple possible fields
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
  const liveTradePlansForChart = useMemo(
    () =>
      displayPlanIds.map((planId, i) => {
        const base = plans[i] || {};
        const draft = planDrafts?.[planId] || {};
        return { ...base, ...draft };
      }),
    [displayPlanIds, plans, planDrafts],
  );
  const selectedPlanSymbol = String(
    selectedPlanRaw?.symbol ||
      selectedPlanFromList?.symbol ||
      chart?.symbol ||
      "",
  )
    .trim()
    .toUpperCase();
  const selectedRawData = useMemo(() => {
    if (!rawData || typeof rawData !== "object") return rawData;
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
        <div
          className="trade-plans-grid-v5"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
            gap: 16,
            marginBottom: 20,
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
            return (
              <div
                key={planId}
                onClick={() => setSelectedPlanId(planId)}
                style={{
                  cursor: "pointer",
                  border: isSelected
                    ? "2px solid var(--accent)"
                    : "1px solid var(--accent-soft)",
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: isSelected
                    ? "rgba(255,255,255,0.05)"
                    : "rgba(255,255,255,0.015)",
                  boxShadow: isSelected
                    ? "0 4px 12px rgba(0,0,0,0.15)"
                    : "none",
                }}
              >
                <PlanHeader
                  plan={{
                    ...planValue,
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
                  status={tradePlan.status}
                  volume={tradePlan.volume}
                  pnl={tradePlan.pnl}
                />

                {isSelected && !tradePlan.hideEditor ? (
                  <TradePlanEditor
                    signalId={tradePlan.signalId || null}
                    tradeId={tradePlan.tradeId || null}
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
                        if ((k === "entry" || k === "direction") && nextPlan) {
                          if (nextPlan.tp !== undefined)
                            tradePlan.onChange?.("tp", nextPlan.tp);
                          if (nextPlan.sl !== undefined)
                            tradePlan.onChange?.("sl", nextPlan.sl);
                        }
                      }
                    }}
                    onReset={tradePlan.onReset}
                    onCancel={tradePlan.onCancel}
                    onClose={tradePlan.onClose}
                    onSave={tradePlan.onSave}
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
                    showResetButton={tradePlan.showResetButton !== false}
                    busy={tradePlan.busy || {}}
                    disabled={Boolean(tradePlan.disabled)}
                    lockTradeFields={Boolean(tradePlan.lockTradeFields)}
                    viewOnly={Boolean(tradePlan.viewOnly)}
                    error={tradePlan.error || ""}
                  />
                ) : (
                  <TradePlanEditor
                    value={planValue}
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
                    showResetButton={false}
                    busy={tradePlan.busy || {}}
                    disabled={true}
                    viewOnly={true}
                    lockTradeFields={true}
                  />
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
      )}

      {availableTabs.length ? (
        <div className="snapshot-tabs-v2" style={{ marginBottom: 14 }}>
          {availableTabs.map((t) => (
            <button
              key={t}
              type="button"
              className={`secondary-button ${mainTab === t ? "active" : ""}`}
              onClick={() => setMainTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
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

      {/* INFO TAB (Fields + Analysis) */}
      <div style={{ display: mainTab === "info" ? "block" : "none" }}>
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
              tp3Price != null
                ? `TP3: ${tp3Price} (${tp3Rr ?? "-"}r)`
                : "",
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
                    <div>{plan24?.strategy || "-"}</div>
                  </div>
                  <div>
                    <span className="minor-text">Entry Model</span>
                    <div>{plan24?.entry_model || "-"}</div>
                  </div>
                  <div>
                    <span className="minor-text">Trade Decision</span>
                    <div>{plan24?.trade_decision || "-"}</div>
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
                                        tf?.bias,
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
                                        tf?.bias,
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
                          l: "Risk %",
                          v:
                            rm.risk_percent != null
                              ? `${rm.risk_percent}%`
                              : null,
                        },
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
                      ].filter((r) => r.v != null && String(r.v) !== "");
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
                                  {r.v}
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
                        ) : (
                          f.value
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

      {/* BROKER TAB (Trades only) */}
      <div style={{ display: mainTab === "broker" ? "block" : "none" }}>
        {metaItems.length > 0 &&
          (() => {
            const hasVal = (x) =>
              x &&
              x.value !== null &&
              x.value !== undefined &&
              String(x.value) !== "";
            const isMeta = (x) =>
              x.label === "Metadata" ||
              x.label === "Raw Metadata" ||
              x.label === "Raw JSON";
            const accountItems = metaItems.filter(
              (x) => x?.group === "account" && !isMeta(x) && hasVal(x),
            );
            const rawJsonItem = metaItems.find(
              (x) =>
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
                  gridColumn: item.fullWidth ? "1 / -1" : "auto",
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                <span className="minor-text" style={{ fontSize: "10px" }}>
                  {item.label}
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
                  {typeof item.value === "object"
                    ? JSON.stringify(item.value, null, 2)
                    : item.value}
                </div>
              </div>
            );

            return (
              <div style={{ padding: "0 4px" }}>
                <div
                  className="fields-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns:
                      "repeat(auto-fill, minmax(180px, 1fr))",
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
            symbol={selectedPlanSymbol || chart?.symbol}
            timeframes={effectiveTfs}
            defaultMode={chart?.mode || "live"}
            initialGridCols={
              Number.isFinite(Number(chart?.initialGridCols)) &&
              Number(chart?.initialGridCols) > 0
                ? Number(chart?.initialGridCols)
                : 2
            }
            initialBarsCount={
              Number.isFinite(Number(chart?.initialBarsCount)) &&
              Number(chart?.initialBarsCount) > 0
                ? Number(chart?.initialBarsCount)
                : 300
            }
            entryPrice={selectedPlanRaw?.entry || chart?.entryPrice}
            slPrice={selectedPlanRaw?.sl || chart?.slPrice}
            tpPrice={selectedPlanRaw?.tp || chart?.tpPrice}
            createdAt={chart?.createdAt}
            openedAt={chart?.openedAt}
            closedAt={chart?.closedAt}
            onPlanLevelChange={chart?.onPlanLevelChange}
            analysisSnapshot={{
              ...(rawData && typeof rawData === "object" ? rawData : {}),
              trade_plan: liveTradePlansForChart.length
                ? liveTradePlansForChart
                : Array.isArray(rawData?.trade_plan)
                  ? rawData.trade_plan
                  : rawData?.trade_plan &&
                      typeof rawData.trade_plan === "object"
                    ? [rawData.trade_plan]
                    : [],
            }}
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
            onQuickTradeIntent={(intent) => {
              const side = String(intent?.side || "BUY").toUpperCase();
              const action = String(intent?.action || "ENTRY").toUpperCase();
              const price = Number(intent?.price);
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
              if (tradePlan?.onChange || planId !== "main") {
                if (action === "TP") {
                  if (Number.isFinite(price)) applyToPlan("tp", String(price));
                } else if (action === "SL") {
                  if (Number.isFinite(price)) applyToPlan("sl", String(price));
                } else if (action === "CLEAR_TP") {
                  applyToPlan("tp", "");
                } else if (action === "CLEAR_SL") {
                  applyToPlan("sl", "");
                } else if (action === "CLEAR_ENTRY") {
                  applyToPlan("entry", "");
                } else {
                  applyToPlan("direction", side);
                  if (Number.isFinite(price)) {
                    applyToPlan("entry", String(price));
                  }
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
          {(
            mode === "ai"
              ? selectedPlanRaw && Object.keys(selectedPlanRaw).length > 0
              : selectedRawData && Object.keys(selectedRawData).length > 0
          ) ? (
            <SmartContent
              content={mode === "ai" ? selectedPlanRaw : selectedRawData}
              mode="readonly"
            />
          ) : (
            <div className="minor-text">
              {isResponsePending ? pendingResponseText : "No JSON result yet."}
            </div>
          )}
        </div>
      </div>

      {/* HISTORY TAB */}
      <div style={{ display: mainTab === "history" ? "block" : "none" }}>
        {history?.loading ? (
          <div className="minor-text">{preset.historyLoadingText}</div>
        ) : (
          <div className="telemetry-list">
            {!history?.items || history.items.length === 0 ? (
              <div className="minor-text">{preset.historyEmptyText}</div>
            ) : (
              history.items.map((item, i) => (
                <div key={i} className="telemetry-item">
                  {renderHistoryItem(item, i, { formatDateTime })}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
