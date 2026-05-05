import { useEffect, useMemo, useState } from "react";
import { TradePlanEditor } from "./TradePlanEditor";
import {
  asNum,
  buildHeaderMeta,
  formatNote,
  renderHistoryItem,
  shouldShowPnl,
} from "../utils/signalDetailUtils";
import { SymbolChart } from "./charts/ChartTile";
import { SmartContent } from "./SmartContent";

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
  const rrNum = Number(String(plan.rr ?? "").replace(",", "."));
  const rrText = Number.isFinite(rrNum) ? `${rrNum.toFixed(1)}r` : "0.0r";
  const directionColor = isBuy ? "#26a69a" : "#ef5350";
  const sideBg = isBuy ? "rgba(38,166,154,0.1)" : "rgba(239,83,80,0.1)";
  const confidenceRaw = plan.confidence ?? plan.confidence_pct;
  const confidenceNum = Number(String(confidenceRaw ?? "").replace(",", "."));
  const confidenceText = Number.isFinite(confidenceNum) ? `${confidenceNum.toFixed(1)}%` : "";
  const skipText = String(
    plan.skip_recommendation ||
      plan.skip ||
      (Array.isArray(plan.skipReasons) && plan.skipReasons.length ? "skip" : ""),
  ).trim();

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8,
        borderBottom: "1px solid var(--accent-soft)",
        paddingBottom: 6,
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
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
          }}
        >
          {isBuy ? "B" : "S"}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              style={{
                fontWeight: 800,
                fontSize: "13px",
                color: "var(--foreground)",
              }}
            >
              {symbol}
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
                {plan.strategy || "market"}
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
            <span style={{ color: "var(--muted)", marginLeft: 8, fontWeight: 400 }}>
              {rrText}
            </span>
          </div>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: "11px",
          color: "var(--muted)",
          textAlign: "right",
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
        {pnl ? (
          <span style={{ fontSize: "11px", fontWeight: 700 }}>{pnl}</span>
        ) : null}
        {skipText ? (
          <span className="badge badge-mini" style={{ padding: "2px 6px", fontSize: "9px", color: "#ef5350", borderColor: "#ef535066" }}>
            {skipText}
          </span>
        ) : null}
        {confidenceText ? (
          <span className="badge badge-mini" style={{ padding: "2px 6px", fontSize: "9px" }}>
            {confidenceText}
          </span>
        ) : null}
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

export function SignalDetailCard({
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
  useEffect(() => {
    if (!availableTabs.includes(mainTab))
      setMainTab(availableTabs[0] || "info");
  }, [availableTabs, mainTab]);
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
    },
  ];

  useEffect(() => {
    const next = {};
    plans.forEach((p, i) => {
      const planId = i === 0 ? "main" : `suggested_${i}`;
      next[planId] = {
        ...p,
        entry_model: p.entry_model || p.entryModel || "",
        confidence_pct: p.confidence_pct ?? p.confidence ?? null,
        reasons_to_skip: Array.isArray(p.reasons_to_skip)
          ? p.reasons_to_skip
          : (Array.isArray(p.skipReasons) ? p.skipReasons : []),
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

      setSelectedTfs(
        initial.sort(
          (a, b) =>
            (TF_WEIGHTS[a.toLowerCase()] || 0) -
            (TF_WEIGHTS[b.toLowerCase()] || 0),
        ),
      );
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
      return next.sort(
        (a, b) =>
          (TF_WEIGHTS[a.toLowerCase()] || 0) -
          (TF_WEIGHTS[b.toLowerCase()] || 0),
      );
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
            const planValue = isMain ? tradePlan.value : (planDrafts[planId] || p);
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
                  plan={planValue}
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
                          [planId]: applyLinkedPlanChange((prev[planId] || p), k, v),
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
                    onAddSignal={(pos) => tradePlan.onAddSignal?.(pos || planValue, planId)}
                    onAddTrade={(pos) => tradePlan.onAddTrade?.(pos || planValue, planId)}
                    showSaveButton={false}
                    showAddSignalButton={mode === "ai" && tradePlan.showAddSignalButton}
                    showAddTradeButton={mode === "ai" && tradePlan.showAddTradeButton}
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

      {/* INFO TAB (Fields + Analysis) */}
      <div style={{ display: mainTab === "info" ? "block" : "none" }}>
        {/* Fields at the top of Info tab */}
        {metaItems.length > 0 && (() => {
          const hasVal = (x) => x && x.value !== null && x.value !== undefined && String(x.value) !== "";
          const sourceItems = metaItems.filter((x) => x?.group === "source" && x.label !== "Raw JSON" && hasVal(x));
          const accountItems = metaItems.filter((x) => x?.group === "account" && x.label !== "Raw JSON" && hasVal(x));
          const otherItems = metaItems.filter((x) => !x?.group && x.label !== "Raw JSON" && hasVal(x));
          const renderField = (item, i) => (
            <div key={`${item.label}-${i}`} style={{ gridColumn: item.fullWidth ? "1 / -1" : "auto", display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="minor-text" style={{ fontSize: "10px", textTransform: "uppercase", color: "var(--muted-bright)" }}>{item.label}</span>
              <div style={{ fontSize: "12.5px", color: "var(--foreground)", wordBreak: "break-word", fontWeight: 500, ...(item.valueStyle || {}) }}>
                {String(item.label || "").toLowerCase() === "note" ? (
                  <div dangerouslySetInnerHTML={{ __html: formatNote(item.value) }} />
                ) : (
                  typeof item.value === "object" ? JSON.stringify(item.value, null, 2) : item.value
                )}
              </div>
            </div>
          );
          const card = (title, items) => (
            <div className="fields-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, padding: 16, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid var(--border)", marginBottom: 12 }}>
              <div style={{ gridColumn: "1 / -1", fontSize: 11, fontWeight: 800, color: "var(--muted-bright)", textTransform: "uppercase" }}>{title}</div>
              {items.map(renderField)}
            </div>
          );
          return (
            <div style={{ marginBottom: 20 }}>
              {sourceItems.length ? card("Source", sourceItems) : null}
              {accountItems.length ? card("Account", accountItems) : null}
              {otherItems.length ? (
                <div className="fields-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 16, padding: 16, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid var(--border)" }}>
                  {otherItems.map(renderField)}
                </div>
              ) : null}
            </div>
          );
        })()}

        {/* Analysis content below fields */}
        <div
          className="panel"
          style={{
            padding: 16,
            margin: 0,
            lineHeight: 1.6,
            fontSize: "14px",
            background: "var(--card-bg)",
            borderRadius: 12,
          }}
        >
          {(() => {
            const raw = rawData;
            const m = raw.market_analysis || {};
            const compactTfs = Array.isArray(raw.timeframes)
              ? raw.timeframes
              : Array.isArray(m.timeframes)
                ? m.timeframes.map((tf) => ({
                    ...tf,
                    phase: tf?.phase || tf?.market_phase || "",
                    poiAlign:
                      tf?.poiAlign === true || tf?.poiAlign === false
                        ? String(tf.poiAlign)
                        : tf?.poi_alignment === true || tf?.poi_alignment === false
                          ? String(tf.poi_alignment)
                          : "",
                    keyBreaks: Array.isArray(tf?.strongEvents)
                      ? tf.strongEvents
                      : Array.isArray(tf?.price_action_summary?.key_breaks)
                        ? tf.price_action_summary.key_breaks.map((kb) => ({
                            event: kb?.event || "",
                            price: kb?.price_level ?? kb?.price ?? null,
                            direction: kb?.direction || "",
                            time: kb?.time ?? null,
                          }))
                        : [],
                  }))
                : [];
            const primaryTf =
              Array.isArray(m.timeframes) && m.timeframes.length
                ? m.timeframes.find((x) => x?.bias || x?.trend) || {}
                : compactTfs.find((x) => x?.bias || x?.trend) || {};
            const bias = m.bias || raw.bias || primaryTf.bias || "N/A";
            const trend = m.trend || raw.trend || primaryTf.trend || "N/A";
            const confluence = m.confluence || raw.confluence || "";
            const compactChecklist =
              raw.checklist && typeof raw.checklist === "object"
                ? {
                    buy: Array.isArray(raw.checklist?.buy?.items)
                      ? raw.checklist.buy.items.map((x) => ({
                          ...x,
                          checked: Boolean(x?.passed),
                          pd_array_ref: x?.pdRef ?? null,
                        }))
                      : [],
                    sell: Array.isArray(raw.checklist?.sell?.items)
                      ? raw.checklist.sell.items.map((x) => ({
                          ...x,
                          checked: Boolean(x?.passed),
                          pd_array_ref: x?.pdRef ?? null,
                        }))
                      : [],
                  }
                : null;
            const rawChecklist =
              m.confluence_checklist ||
              raw.confluence_checklist ||
              compactChecklist ||
              m.checklist ||
              raw.checklist ||
              [];
            let checklist = Array.isArray(rawChecklist)
              ? rawChecklist
              : [
                  ...(Array.isArray(rawChecklist?.buy)
                    ? rawChecklist.buy.map((x) => ({ side: "Buy", ...x }))
                    : []),
                  ...(Array.isArray(rawChecklist?.sell)
                    ? rawChecklist.sell.map((x) => ({ side: "Sell", ...x }))
                    : []),
                ];
            if (typeof checklist === "string") checklist = [checklist];
            const verdictObj =
              raw.final_verdict || m.final_verdict || raw.verdict || {};
            const verdictText =
              typeof verdictObj === "string"
                ? verdictObj
                : verdictObj.action
                  ? `${verdictObj.action}${verdictObj.risk_tier || verdictObj.tier ? ` / ${verdictObj.risk_tier || verdictObj.tier}` : ""}${verdictObj.confidence ? ` (${verdictObj.confidence}%)` : ""}`
                  : "";
            const firstPlan = Array.isArray(raw.trade_plan)
              ? raw.trade_plan[0]
              : Array.isArray(raw.tradePlan)
                ? raw.tradePlan[0]
                : raw.trade_plan;
            const note =
              raw.note ||
              m.note ||
              (verdictObj && verdictObj.note) ||
              (firstPlan && firstPlan.note) ||
              "";
            const analysis =
              raw.analysis ||
              m.analysis ||
              primaryTf?.price_action_summary?.recent_move ||
              primaryTf?.did ||
              primaryTf?.price_prediction?.narrative ||
              primaryTf?.next ||
              "";
            return (
              <div className="analysis-summary-md">
                {/* Per-TF Cards Row */}
                {Array.isArray(compactTfs) && compactTfs.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 8,
                      }}
                    >
                      Bias & Trend
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {compactTfs.map((tf) => {
                        const b = tf.bias || "";
                        const isLong = b.toLowerCase().includes("long");
                        const isShort = b.toLowerCase().includes("short");
                        const biasColor = isLong
                          ? "#26a69a"
                          : isShort
                            ? "#ef5350"
                            : "var(--muted)";
                        return (
                          <div
                            key={tf.tf}
                            style={{
                              flex: "1 1 0",
                              minWidth: 120,
                              padding: 8,
                              background: "rgba(255,255,255,0.03)",
                              borderRadius: 8,
                              border: `1px solid ${biasColor}30`,
                            }}
                          >
                            <div
                              style={{
                                fontWeight: 700,
                                fontSize: 13,
                                marginBottom: 4,
                                display: "flex",
                                justifyContent: "space-between",
                              }}
                            >
                              <span>{tf.tf}</span>
                              <span style={{ fontSize: 14, color: biasColor }}>
                                {isLong ? "↑" : isShort ? "↓" : ""}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: 10,
                                color: biasColor,
                                fontWeight: 600,
                              }}
                            >
                              {bias || "—"}
                            </div>
                            <div className="minor-text" style={{ fontSize: 9 }}>
                              {tf.trend || ""} · {tf.structure || ""}
                            </div>
                            <div className="minor-text" style={{ fontSize: 9 }}>
                              {tf.phase || ""} · {tf.poiAlign || ""}
                            </div>
                            {tf.keyBreaks?.slice(0, 2).map((kb, i) => (
                              <div
                                key={i}
                                className="minor-text"
                                style={{ fontSize: 8, marginTop: 2 }}
                              >
                                {kb.event}: {kb.price} {kb.direction}
                              </div>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {analysis && (
                  <div style={{ marginBottom: 20 }}>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 8,
                      }}
                    >
                      Analysis
                    </div>
                    <div
                      style={{
                        whiteSpace: "pre-wrap",
                        marginBottom: 12,
                        color: "var(--foreground)",
                        fontSize: "14px",
                        lineHeight: 1.6,
                      }}
                    >
                      {typeof analysis === "object" ? JSON.stringify(analysis, null, 2) : analysis}
                    </div>
                  </div>
                )}
                {confluence && (
                  <div style={{ marginBottom: 20 }}>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 8,
                      }}
                    >
                      Confluence
                    </div>
                    <div style={{ whiteSpace: "pre-wrap", marginBottom: 12 }}>
                      {typeof confluence === "object" ? JSON.stringify(confluence, null, 2) : confluence}
                    </div>
                  </div>
                )}
                {Array.isArray(checklist) && checklist.length > 0 && (
                  <div style={{ marginBottom: 20 }}>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 12,
                      }}
                    >
                      Checklist
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 1fr",
                        gap: 24,
                      }}
                    >
                      {/* BUY COLUMN */}
                      <div>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#26a69a",
                            marginBottom: 8,
                            borderBottom: "1px solid rgba(38, 166, 154, 0.2)",
                            paddingBottom: 4,
                          }}
                        >
                          BUY
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          }}
                        >
                          {checklist
                            .filter((item) => {
                              const side =
                                typeof item === "object"
                                  ? item.side
                                  : String(item).split(":")[0];
                              return String(side || "")
                                .toLowerCase()
                                .includes("buy");
                            })
                            .map((item, idx) => {
                              const label =
                                typeof item === "object"
                                  ? item.item || item.condition || ""
                                  : String(item)
                                      .split(":")
                                      .slice(1)
                                      .join(":")
                                      .trim();
                              const isChecked =
                                typeof item === "object" ? item.checked : true;
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "flex-start",
                                    fontSize: "12.5px",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    readOnly
                                    style={{
                                      marginTop: 3,
                                      pointerEvents: "none",
                                    }}
                                  />
                                  <span
                                    style={{
                                      color: isChecked
                                        ? "var(--foreground)"
                                        : "var(--muted)",
                                    }}
                                  >
                                    {typeof label === "object" ? JSON.stringify(label, null, 2) : label}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                      {/* SELL COLUMN */}
                      <div>
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#ef5350",
                            marginBottom: 8,
                            borderBottom: "1px solid rgba(239, 83, 80, 0.2)",
                            paddingBottom: 4,
                          }}
                        >
                          SELL
                        </div>
                        <div
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 6,
                          }}
                        >
                          {checklist
                            .filter((item) => {
                              const side =
                                typeof item === "object"
                                  ? item.side
                                  : String(item).split(":")[0];
                              return String(side || "")
                                .toLowerCase()
                                .includes("sell");
                            })
                            .map((item, idx) => {
                              const label =
                                typeof item === "object"
                                  ? item.item || item.condition || ""
                                  : String(item)
                                      .split(":")
                                      .slice(1)
                                      .join(":")
                                      .trim();
                              const isChecked =
                                typeof item === "object" ? item.checked : true;
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    display: "flex",
                                    gap: 8,
                                    alignItems: "flex-start",
                                    fontSize: "12.5px",
                                  }}
                                >
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    readOnly
                                    style={{
                                      marginTop: 3,
                                      pointerEvents: "none",
                                    }}
                                  />
                                  <span
                                    style={{
                                      color: isChecked
                                        ? "var(--foreground)"
                                        : "var(--muted)",
                                    }}
                                  >
                                    {typeof label === "object" ? JSON.stringify(label, null, 2) : label}
                                  </span>
                                </div>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
                {verdictText && (
                  <div
                    style={{
                      marginBottom: 20,
                      padding: 12,
                      background: "rgba(38, 166, 154, 0.05)",
                      borderRadius: 8,
                      border: "1px solid rgba(38, 166, 154, 0.2)",
                    }}
                  >
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 4,
                      }}
                    >
                      Final Verdict
                    </div>
                    <div
                      style={{
                        fontWeight: 600,
                        color: "#26a69a",
                        fontSize: "15px",
                      }}
                    >
                      {verdictText}
                    </div>
                  </div>
                )}
                {note && (
                  <div
                    style={{
                      marginTop: 24,
                      padding: 12,
                      background: "rgba(255,255,255,0.03)",
                      borderRadius: 8,
                      borderLeft: "3px solid var(--accent)",
                    }}
                  >
                    <div
                      className="minor-text"
                      style={{ fontSize: "10px", marginBottom: 4 }}
                    >
                      NOTE
                    </div>
                    <SmartContent content={note} mode="readonly" />
                  </div>
                )}

                {/* PD Arrays */}
                {Array.isArray(raw.pdArrays) && raw.pdArrays.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 8,
                      }}
                    >
                      PD Arrays
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {raw.pdArrays.map((pd, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: 11,
                            padding: "4px 8px",
                            background: "rgba(255,255,255,0.03)",
                            borderRadius: 4,
                            display: "flex",
                            gap: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{pd.type}</span>
                          <span
                            style={{
                              color:
                                pd.dir?.toLowerCase() === "long"
                                  ? "#26a69a"
                                  : "#ef5350",
                            }}
                          >
                            {pd.dir}
                          </span>
                          <span className="minor-text">{pd.tf}</span>
                          <span className="minor-text">
                            {pd.top}–{pd.bot}
                          </span>
                          <span className="minor-text">
                            {pd.status}
                            {pd.touched ? " (touched)" : ""}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Levels */}
                {Array.isArray(raw.keyLevels) && raw.keyLevels.length > 0 && (
                  <div style={{ marginTop: 20 }}>
                    <div
                      className="minor-text"
                      style={{
                        fontSize: "11px",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        marginBottom: 8,
                      }}
                    >
                      Key Levels
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {raw.keyLevels.map((kl, i) => (
                        <div
                          key={i}
                          style={{
                            fontSize: 11,
                            padding: "3px 8px",
                            background: "rgba(255,255,255,0.03)",
                            borderRadius: 4,
                          }}
                        >
                          <span style={{ fontWeight: 600 }}>{kl.name}</span>
                          <span
                            className="minor-text"
                            style={{ marginLeft: 6 }}
                          >
                            {kl.price}
                          </span>
                          {kl.swept && (
                            <span
                              style={{
                                marginLeft: 6,
                                color: "#ef5350",
                                fontSize: 9,
                              }}
                            >
                              swept
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Key Levels */}
              </div>
            );
          })()}
        </div>
      </div>

      {/* CHART TAB */}
      <div style={{ display: mainTab === "chart" ? "block" : "none" }}>
        <SymbolChart
          symbol={chart?.symbol}
          timeframes={selectedTfs}
          defaultMode={chart?.mode || "cache"}
          initialGridCols={mode === "trade" ? 2 : chart?.defaultGridCols}
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
          skipFetch={true}
        />
      </div>

      {/* JSON TAB */}
      <div style={{ display: mainTab === "json" ? "block" : "none" }}>
        <div
          style={{
            padding: 16,
            background: "rgba(0,0,0,0.3)",
            borderRadius: 12,
          }}
        >
          <SmartContent content={rawData} mode="readonly" />
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
