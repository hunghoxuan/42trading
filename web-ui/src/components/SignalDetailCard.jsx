import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { TradePlanEditor } from "./TradePlanEditor";
import {
  buildHeaderMeta,
  formatNote,
  renderHistoryItem,
  shouldShowPnl,
} from "../utils/signalDetailUtils";
const SymbolChart = lazy(() => import("./charts/SymbolChart"));
import { SmartContent } from "./SmartContent";
import { sortTimeframes } from "../utils/format";

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

function formatNum3(v) {
  if (!Number.isFinite(v)) return "";
  return String(Number(v.toFixed(3)));
}

function applyLinkedPlanChange(prevPlan, key, rawVal) {
  const next = { ...(prevPlan || {}), [key]: rawVal };
  const entry = parseNumLoose(next.entry);
  const sl = parseNumLoose(next.sl);
  const tp = parseNumLoose(next.tp);
  const rr = parseNumLoose(next.rr);
  const side = String(next.direction || "").toUpperCase();
  const isBuy = side === "BUY";
  const risk = entry != null && sl != null ? Math.abs(entry - sl) : null;
  if (risk != null && risk > 0) {
    if (key === "rr" && rr != null && entry != null && sl != null) {
      const tpCalc = isBuy ? entry + risk * rr : entry - risk * rr;
      next.tp = formatNum3(tpCalc);
    } else if (entry != null && tp != null) {
      next.rr = formatNum3(Math.abs(tp - entry) / risk);
    }
  }
  return next;
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
  const tp = parseNumLoose(plan.tp);
  const risk = entry != null && sl != null ? Math.abs(entry - sl) : null;

  const rrNum = Number(String(plan.rr ?? "").replace(",", "."));
  const rrText = Number.isFinite(rrNum) ? `${rrNum.toFixed(1)}r` : "0.0r";
  const directionColor = isBuy ? "#26a69a" : "#ef5350";
  const sideBg = isBuy ? "rgba(38,166,154,0.1)" : "rgba(239,83,80,0.1)";

  const confidenceRaw = plan.confidence ?? plan.confidence_pct;
  const confidenceNum = Number(String(confidenceRaw ?? "").replace(",", "."));
  const confidenceText = Number.isFinite(confidenceNum)
    ? `${confidenceNum.toFixed(1)}%`
    : "";

  const riskTier = plan.risk_management || plan.risk_tier || "";
  const partials = Array.isArray(plan.partial_tps) ? plan.partial_tps : [];
  const strategy = plan.strategy || "";
  const entryModel = plan.entry_model || plan.entryModel || "";

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
              {symbol}
            </span>
            {strategy && (
              <span className="minor-text" style={{ fontSize: "11px", fontWeight: 600 }}>
                {strategy}
              </span>
            )}
            {entryModel && (
              <span className="minor-text" style={{ fontSize: "11px" }}>
                {entryModel}
              </span>
            )}
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
            <span style={{ color: "var(--accent)" }}>{plan.tp || "-"}</span> /{" "}
            <span style={{ color: "var(--bearish)" }}>{plan.sl || "-"}</span>
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
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {status && (
            <span
              className={`badge ${status.cls} badge-mini`}
              style={{ padding: "2px 6px", fontSize: "9px" }}
            >
              {status.label}
            </span>
          )}
          {pnl && (
            <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--foreground)" }}>
              {pnl}
            </span>
          )}
          {confidenceText && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "var(--accent)",
                opacity: 0.9,
              }}
            >
              {confidenceText}
            </span>
          )}
          {riskTier && (
            <span
              className={`badge badge-mini ${
                riskTier.toLowerCase() === "high"
                  ? "badge-danger"
                  : riskTier.toLowerCase() === "medium"
                    ? "badge-warning"
                    : "badge-success"
              }`}
              style={{ padding: "1px 5px", fontSize: "9px", textTransform: "capitalize" }}
            >
              {riskTier}
            </span>
          )}
        </div>

        {partials.length > 0 && (
          <div
            style={{
              fontSize: "9.5px",
              color: "var(--muted-bright)",
              display: "flex",
              gap: 8,
              opacity: 0.8,
            }}
          >
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
                  style={{ cursor: "pointer", borderBottom: "1px dotted var(--muted-soft)" }}
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
  const plans = response?.tradePlans || [
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
    const next = {};
    plans.forEach((p, i) => {
      const planId = i === 0 ? "main" : `suggested_${i}`;
      next[planId] = {
        ...p,
        entry_model: p.entry_model || p.entryModel || "",
        confidence_pct: p.confidence_pct ?? p.confidence ?? null,
        estimated_bars: p.estimated_bars ?? null,
        be_trigger: p.be_trigger ?? p.be ?? null,
        invalidation: p.invalidation || "",
        risk_management: p.risk_management || "",
        entry_condition: p.entry_condition || "",
        exit_condition: p.exit_condition || "",
        confluence_checklist: Array.isArray(p.confluence_checklist) ? p.confluence_checklist : [],
        reasons_to_skip: Array.isArray(p.reasons_to_skip)
          ? p.reasons_to_skip
          : Array.isArray(p.skipReasons)
            ? p.skipReasons
            : [],
        skip_recommendation: p.skip_recommendation || p.skip || "",
      };
    });
    setPlanDrafts(next);
  }, [response?.tradePlans, tradePlan?.value]);

  useEffect(() => {
    if (chart?.enabled) {
      const initial = [];

      // Trade detail chart defaults must stay stable and explicit.
      // Do not derive from signal/chart interval because values like "15"
      // can create duplicate tiles (15m + 15) and hide 5m.
      const signalTf = (chart.interval || "").toLowerCase();
      const defaults = tradePlan?.enabled
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
  }, [chart?.enabled, chart?.interval]);

  useEffect(() => {
    if (
      mainTab === "chart" &&
      chart?.symbol &&
      selectedTfs.length > 0 &&
      chartModes.includes("static")
    ) {
      let isMounted = true;
      setLoadingCharts(true);
      fetch(
        `/api/charts/multi?symbol=${encodeURIComponent(chart.symbol)}&tfs=${encodeURIComponent(selectedTfs.join(","))}`,
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((res) => {
          if (isMounted && res?.ok) setMultiChartData(res.data || {});
        })
        .finally(() => {
          if (isMounted) setLoadingCharts(false);
        });
      return () => {
        isMounted = false;
      };
    }
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

  // Use raw data from multiple possible fields
  const rawData =
    response?.raw || response?.raw_json || response?.metadata || {};

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
          {plans.map((p, i) => {
            const isMain = i === 0;
            const planId = isMain ? "main" : `suggested_${i}`;
            const isSelected = selectedPlanId === planId;
            const isBuy = String(p.direction).toUpperCase() === "BUY";
            const isSimplified = !isSelected;
            const planValue = isMain
              ? tradePlan.value
              : planDrafts[planId] || p;
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
                    onSelectTP: (price) => {
                      if (isMain) {
                        tradePlan.onChange?.("tp", price);
                      } else {
                        setPlanDrafts((prev) => ({
                          ...prev,
                          [planId]: applyLinkedPlanChange(prev[planId] || p, "tp", price),
                        }));
                      }
                    }
                  }}
                  symbol={chart?.symbol || "Plan"}
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
                      if (isMain) {
                        tradePlan.onChange?.(k, v);
                      } else {
                        setPlanDrafts((prev) => ({
                          ...prev,
                          [planId]: applyLinkedPlanChange(
                            prev[planId] || p,
                            k,
                            v,
                          ),
                        }));
                      }
                    }}
                    onReset={tradePlan.onReset}
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
          const p = plans.find((pl, i) => (i === 0 ? "main" : `suggested_${i}`) === selectedPlanId) || plans[0] || {};
          const planVal = selectedPlanId === "main" ? tradePlan?.value || p : planDrafts[selectedPlanId] || p;

          const fields = [
            { label: "Source", value: planVal.source || rawData.source },
            { label: "Invalidation", value: planVal.invalidation || rawData.invalidation, fullWidth: true },
            { label: "Entry Condition", value: planVal.entry_condition || rawData.entry_condition, fullWidth: true },
            { label: "Exit Condition", value: planVal.exit_condition || rawData.exit_condition, fullWidth: true },
            { label: "Reasons to skip", value: planVal.reasons_to_skip || planVal.skipReasons || rawData.reasons_to_skip, isList: true, fullWidth: true },
            { label: "Skip Recommendation", value: planVal.skip_recommendation || planVal.skip || rawData.skip_recommendation, fullWidth: true },
          ];

          const hasVal = (v) => v !== null && v !== undefined && String(v) !== "" && (Array.isArray(v) ? v.length > 0 : true);

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
                  keyBreaks: Array.isArray(tf?.strongEvents) ? tf.strongEvents : [],
                }))
              : [];
          const analysisText = raw.analysis || m.analysis || "";
          const rawChecklist = m.confluence_checklist || raw.confluence_checklist || m.checklist || raw.checklist || [];
          let checklist = Array.isArray(rawChecklist) ? rawChecklist : [];

          return (
            <div style={{ padding: "10px 4px" }}>
              {/* Bias & Trend Cards */}
              {compactTfs.length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <div className="minor-text" style={{ marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>Bias & Trend</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {compactTfs.map((tf) => {
                      const b = tf.bias || "";
                      const isLong = b.toLowerCase().includes("long");
                      const isShort = b.toLowerCase().includes("short");
                      const biasColor = isLong ? "#26a69a" : isShort ? "#ef5350" : "var(--muted)";
                      return (
                        <div key={tf.tf} style={{ flex: "1 1 0", minWidth: 140, padding: 10, background: "rgba(255,255,255,0.03)", borderRadius: 8, border: `1px solid ${biasColor}30` }}>
                          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, display: "flex", justifyContent: "space-between" }}>
                            <span>{tf.tf}</span>
                            <span style={{ fontSize: 14, color: biasColor }}>{isLong ? "↑" : isShort ? "↓" : ""}</span>
                          </div>
                          <div style={{ fontSize: 10, color: biasColor, fontWeight: 600 }}>{b || "—"}</div>
                          <div className="minor-text" style={{ fontSize: 9 }}>{tf.trend || ""} · {tf.structure || ""}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Analysis narrative */}
              {analysisText && (
                <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 4 }}>
                  <span className="minor-text">Analysis</span>
                  <div style={{ fontSize: "13px", color: "var(--foreground)", fontWeight: 500, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                    {analysisText}
                  </div>
                </div>
              )}

              {/* Checklist */}
              {checklist.length > 0 && (
                <div style={{ marginBottom: 24, display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="minor-text">Checklist</span>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {checklist.map((item, idx) => (
                      <span key={idx} className="badge badge-mini" style={{ opacity: 0.8 }}>
                        {typeof item === "object" ? item.item || item.condition : item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Other Fields (Invalidation, Conditions, etc.) */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px 30px" }}>
                {fields.map((f, i) => {
                  if (!hasVal(f.value)) return null;
                  return (
                    <div key={i} style={{ gridColumn: f.fullWidth ? "1 / -1" : "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                      <span className="minor-text">{f.label}</span>
                      <div style={{ fontSize: "13px", color: "var(--foreground)", fontWeight: 500, lineHeight: 1.5 }}>
                        {f.isList ? (
                          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "12px", opacity: 0.9 }}>
                            {(Array.isArray(f.value) ? f.value : []).map((item, idx) => <li key={idx}>{item}</li>)}
                          </ul>
                        ) : f.value}
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
                  {typeof item.value === "object" ? (
                    JSON.stringify(item.value, null, 2)
                  ) : (
                    item.value
                  )}
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
            symbol={chart?.symbol}
            timeframes={selectedTfs}
            defaultMode={chart?.mode || "cache"}
            initialGridCols={Math.min(2, selectedTfs.length || 1)}
            entryPrice={chart?.entryPrice}
            slPrice={chart?.slPrice}
            tpPrice={chart?.tpPrice}
            createdAt={chart?.createdAt}
            openedAt={chart?.openedAt}
            closedAt={chart?.closedAt}
            onPlanLevelChange={chart?.onPlanLevelChange}
            analysisSnapshot={rawData}
            hasTradePlan={Boolean(
              tradePlan?.value?.entry ||
              tradePlan?.value?.tp ||
              tradePlan?.value?.sl,
            )}
            hasAnalysis={Boolean(rawData && Object.keys(rawData).length > 0)}
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
          {rawData && Object.keys(rawData).length > 0 ? (
            <SmartContent content={rawData} mode="readonly" />
          ) : (
            <div className="minor-text">
              {isResponsePending
                ? pendingResponseText
                : "No JSON result yet."}
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
