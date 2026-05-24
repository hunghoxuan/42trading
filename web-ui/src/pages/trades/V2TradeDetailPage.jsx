import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";
import { NotificationHub } from "../../services/NotificationHub";

const SignalDetailCard = lazy(
  () => import("../../components/SignalDetailCard"),
);
import { buildDetailHeader } from "../../components/SignalDetailHeaderBuilder";
import {
  asNum,
  applyLinkedPlanChange,
  buildHeaderMeta,
  renderHistoryItem,
  extractTradePlanFromTrade,
  validateTradePlan,
} from "../../utils/signalDetailUtils";
import { showDateTime } from "../../utils/format";
import { showToast } from "../../components/ToastContainer";

function PnlDisplay({ value }) {
  const n = asNum(value);
  if (n == null) return <span className="minor-text">-</span>;
  const cls = n < 0 ? "money-neg" : "money-pos";
  return (
    <span className={cls} style={{ fontWeight: 800 }}>
      ${n.toFixed(2)}
    </span>
  );
}

function statusUi(statusRaw) {
  const s = String(statusRaw || "").toUpperCase();
  if (s === "FILLED" || s === "OPEN") return { cls: "ACTIVE", label: "FILLED" };
  if (s === "CLOSED" || s === "CANCELLED") return { cls: "INACTIVE", label: s };
  if (s === "ERROR" || s === "FAIL") return { cls: "FAIL", label: s };
  if (s === "PENDING" || s === "NEW") return { cls: "OTHER", label: "PENDING" };
  return { cls: "OTHER", label: s || "PENDING" };
}

function brokerTicketOf(t) {
  return String(t?.broker_trade_id || t?.ticket || "").trim() || "-";
}

function formatTimeframe(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return String(value || "-");
  if (n < 60) return `${n}m`;
  if (n < 1440) return `${n / 60}h`;
  if (n < 10080) return `${n / 1440}d`;
  if (n < 43200) return `${n / 10080}W`;
  if (n === 43200) return "1M";
  return `${n / 43200}M`;
}

function fDateTime(v) {
  return showDateTime(v);
}

function formatNum3(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Number(n.toFixed(3)));
}

function inferDirection(entry, tp, sl, fallback = "BUY") {
  if (Number.isFinite(entry) && Number.isFinite(tp) && Number.isFinite(sl)) {
    if (tp > entry && sl < entry) return "BUY";
    if (tp < entry && sl > entry) return "SELL";
  }
  return String(fallback || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
}

function deriveOrderType(direction, entry, lastPrice, fallback = "limit") {
  if (!Number.isFinite(entry) || !Number.isFinite(lastPrice))
    return String(fallback || "limit").toLowerCase();
  const eps = Math.max(Math.abs(lastPrice) * 0.00002, 0.00001);
  if (Math.abs(entry - lastPrice) <= eps) return "market";
  if (String(direction).toUpperCase() === "BUY")
    return entry < lastPrice ? "limit" : "stop";
  return entry > lastPrice ? "limit" : "stop";
}

function orderTypeRuleError(direction, orderType, entry, lastPrice) {
  if (!Number.isFinite(entry) || !Number.isFinite(lastPrice)) return "";
  const side = String(direction || "").toUpperCase();
  const typ = String(orderType || "").toLowerCase();
  if (typ === "market") return "";
  if (side === "BUY" && typ === "limit" && !(entry < lastPrice))
    return "Buy Limit requires Entry < last price.";
  if (side === "BUY" && typ === "stop" && !(entry > lastPrice))
    return "Buy Stop requires Entry > last price.";
  if (side === "SELL" && typ === "limit" && !(entry > lastPrice))
    return "Sell Limit requires Entry > last price.";
  if (side === "SELL" && typ === "stop" && !(entry < lastPrice))
    return "Sell Stop requires Entry < last price.";
  return "";
}

export default function TradeDetailPage() {
  const { tradeId } = useParams();
  const EMPTY_DETAIL_PLAN = useMemo(
    () => ({
      direction: "BUY",
      trade_type: "limit",
      entry: "",
      tp: "",
      sl: "",
      rr: "",
      note: "",
    }),
    [],
  );
  const [trade, setTrade] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [planError, setPlanError] = useState("");
  const [detailTfTab, setDetailTfTab] = useState("ENTRY");
  const [detailPlan, setDetailPlan] = useState(EMPTY_DETAIL_PLAN);

  const lastPrice = useMemo(() => {
    const p = asNum(
      trade?.last_price ??
        trade?.metadata?.last_price ??
        trade?.raw_json?.last_price,
    );
    return p;
  }, [trade]);

  const applyPlanChange = (key, rawValue) => {
    setDetailPlan((prev) => {
      const next = applyLinkedPlanChange(prev, key, rawValue);

      // Only infer direction when user explicitly changes direction field
      if (key === "direction") {
        next.direction =
          String(next.direction || "BUY").toUpperCase() === "SELL"
            ? "SELL"
            : "BUY";
      }

      const nextEntry = asNum(next.entry);
      next.trade_type = deriveOrderType(
        next.direction || prev.direction || "BUY",
        nextEntry,
        lastPrice,
        next.trade_type || prev.trade_type || "limit",
      );

      setPlanError("");
      return next;
    });
  };

  useEffect(() => {
    const pickExactTrade = (items = [], idRaw = "") => {
      const id = String(idRaw || "").trim();
      if (!id || !Array.isArray(items) || items.length === 0) return null;
      return (
        items.find((x) => String(x?.sid || "").trim() === id) ||
        items.find((x) => String(x?.id || "").trim() === id) ||
        null
      );
    };
    let cancelled = false;
    const requestTradeId = String(tradeId || "").trim();
    async function loadData() {
      try {
        setError("");
        setPlanError("");
        setLoading(true);
        setTrade(null);
        setDetailPlan(EMPTY_DETAIL_PLAN);
        const [evs, data] = await Promise.all([
          api.v2TradeEvents(requestTradeId),
          api.v2Trades({ q: requestTradeId }),
        ]);
        if (cancelled) return;
        setEvents(Array.isArray(evs?.items) ? evs.items : []);
        const t = pickExactTrade(data?.items || [], requestTradeId);
        setTrade(t);
        if (t) {
          setDetailPlan(extractTradePlanFromTrade(t));
        } else {
          setError(`Trade not found for id: ${requestTradeId}`);
          setDetailPlan(EMPTY_DETAIL_PLAN);
        }
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [tradeId, EMPTY_DETAIL_PLAN]);

  const header = useMemo(() => {
    if (!trade) return null;
    const action = String(trade.action || trade.side || "-").toUpperCase();
    const rr = asNum(trade.rr_planned);
    const pnl = asNum(trade.pnl_realized);
    const meta =
      trade?.metadata && typeof trade.metadata === "object"
        ? trade.metadata
        : {};
    const raw =
      trade?.raw_json &&
      typeof trade.raw_json === "object" &&
      Object.keys(trade.raw_json).length > 0
        ? trade.raw_json
        : trade?.metadata?.raw_json &&
            typeof trade.metadata.raw_json === "object"
          ? trade.metadata.raw_json
          : trade?.metadata || {};
    const vol = asNum(meta.used_volume) ?? asNum(trade.volume);
    const plannedVol =
      asNum(meta.requested_volume) ?? asNum(raw.volume) ?? asNum(trade.volume);
    const riskSize = asNum(
      meta.risk_money_actual ??
        trade.risk_money_actual ??
        trade.risk_money_planned,
    );
    const riskPct = asNum(
      meta.riskPct ?? meta.risk_pct ?? raw.riskPct ?? raw.risk_pct,
    );
    const reward = asNum(meta.reward_money_planned);
    const aiStrategy = detailPlan.strategy || raw.strategy || "";
    const aiEntry = detailPlan.entry_model || raw.entry_model || "";
    const aiGrade = detailPlan.risk_management || "";
    const aiRisk = asNum(detailPlan.risk_pct) || riskPct;
    const aiConf = asNum(detailPlan.confidence_pct);
    const aiEta = asNum(detailPlan.estimated_bars);
    const aiAction = detailPlan.skip_recommendation || "";
    const headerMeta = buildHeaderMeta({
      statusRaw: trade.execution_status,
      pnlRaw: pnl,
      rrRaw: rr,
      volumeRaw: vol,
      plannedVolRaw: plannedVol,
      riskSizeRaw: riskSize,
      riskPctRaw: riskPct,
      rewardSizeRaw: reward,
      updatedAtRaw:
        trade.updated_at ||
        trade.closed_at ||
        trade.opened_at ||
        trade.created_at,
      statusUi,
      volumeSizeRaw: asNum(meta.broker_data?.volume_size),
    });
    const badgeS = (c) => ({
      fontSize: 10,
      padding: "2px 6px",
      borderRadius: 4,
      background: c ? c + "20" : "transparent",
      color: c || "var(--muted)",
      border: `1px solid ${c || "var(--border)"}`,
      whiteSpace: "nowrap",
    });
    return buildDetailHeader({
      side: action,
      symbol: trade.symbol || "-",
      sideClass: action === "BUY" ? "side-buy" : "side-sell",
      positionText: `${trade.entry || "-"} → ${trade.tp || "-"} / ${trade.sl || "-"}`,
      aiBadges: (
        <>
          {aiStrategy && <span style={badgeS("#8b5cf6")}>{aiStrategy}</span>}
          {aiEntry && <span style={badgeS("#6366f1")}>{aiEntry}</span>}
          {aiGrade && (
            <span style={badgeS(aiGrade === "A" ? "#16a34a" : "#ca8a04")}>
              {aiGrade}
            </span>
          )}
          {aiRisk != null && (
            <span style={badgeS(aiRisk <= 1 ? "#16a34a" : "#dc2626")}>
              {aiRisk}%
            </span>
          )}
          {aiConf != null && (
            <span style={badgeS(aiConf >= 80 ? "#16a34a" : "#dc2626")}>
              {aiConf}%
            </span>
          )}
          {aiEta != null && <span style={badgeS(null)}>{aiEta}m</span>}
          {aiAction && (
            <span
              style={badgeS(aiAction === "Proceed" ? "#16a34a" : "#dc2626")}
            >
              {aiAction}
            </span>
          )}
        </>
      ),
      ...headerMeta,
    });
  }, [trade]);
  const isTerminal = useMemo(() => {
    return ["TP", "SL", "FAIL", "EXPIRED"].includes(
      String(trade?.execution_status || "").toUpperCase(),
    );
  }, [trade?.execution_status]);
  const isLocked = useMemo(() => {
    return ["FILLED", "CLOSED", "CANCELLED"].includes(
      String(trade?.execution_status || "").toUpperCase(),
    );
  }, [trade?.execution_status]);
  const isDraft = useMemo(() => {
    return String(trade?.execution_status || "").toUpperCase() === "DRAFT";
  }, [trade?.execution_status]);
  const mergedRawJson = useMemo(() => {
    const rowRaw =
      trade?.raw_json && typeof trade.raw_json === "object"
        ? trade.raw_json
        : {};
    const metaRaw =
      trade?.metadata?.raw_json && typeof trade.metadata.raw_json === "object"
        ? trade.metadata.raw_json
        : {};
    const canonicalFullRaw =
      metaRaw.__analysis_full_raw ||
      rowRaw.__analysis_full_raw ||
      metaRaw.analysis_result ||
      rowRaw.analysis_result ||
      {};
    return {
      ...(canonicalFullRaw && typeof canonicalFullRaw === "object"
        ? canonicalFullRaw
        : {}),
      ...rowRaw,
      ...metaRaw,
      __analysis_full_raw:
        canonicalFullRaw && typeof canonicalFullRaw === "object"
          ? canonicalFullRaw
          : undefined,
      __metadata_raw_json: metaRaw,
      __row_raw_json: rowRaw,
    };
  }, [trade]);

  async function onUpdateTradePlan() {
    if (!trade) {
      setError("No trade loaded.");
      return;
    }
    const validErr =
      validateTradePlan(detailPlan, { skipRrCheck: false }) ||
      orderTypeRuleError(
        detailPlan.direction,
        detailPlan.trade_type,
        asNum(detailPlan.entry),
        lastPrice,
      );
    if (validErr) {
      setPlanError(validErr);
      showToast({ message: validErr, type: "error" });
      return;
    }
    try {
      setLoading(true);
      const payload = {
        side: detailPlan.direction,
        order_type: detailPlan.trade_type,
        price: asNum(detailPlan.entry),
        tp: asNum(detailPlan.tp1 ?? detailPlan.tp),
        tp1: asNum(detailPlan.tp1),
        tp2: asNum(detailPlan.tp2),
        tp3: asNum(detailPlan.tp3),
        sl: asNum(detailPlan.sl),
        rr: asNum(detailPlan.rr),
        note: detailPlan.note,
      };
      await api.saveTradePlan(tradeId, payload);
      // Reload trade events and trade data (but keep user-edited plan intact)
      const [evs, data] = await Promise.all([
        api.v2TradeEvents(tradeId),
        api.v2Trades({ q: tradeId }),
      ]);
      setEvents(Array.isArray(evs?.items) ? evs.items : []);
      const t =
        (Array.isArray(data?.items) &&
          (data.items.find((x) => String(x?.sid || "") === String(tradeId)) ||
            data.items.find((x) => String(x?.id || "") === String(tradeId)) ||
            data.items[0])) ||
        null;
      setTrade(t);
      // Keep current detailPlan (user just saved it) instead of re-extracting
      setPlanError("");
    } catch (e) {
      setError(e?.message || "Update failed");
    } finally {
      setLoading(false);
    }
  }

  async function onReEntryTrade() {
    if (!trade) return;
    const validErr =
      validateTradePlan(detailPlan, { skipRrCheck: false }) ||
      orderTypeRuleError(
        detailPlan.direction,
        detailPlan.trade_type,
        asNum(detailPlan.entry),
        lastPrice,
      );
    if (validErr) {
      setPlanError(validErr);
      return;
    }
    try {
      setLoading(true);
      const payload = {
        side: detailPlan.direction,
        order_type: detailPlan.trade_type,
        price: asNum(detailPlan.entry),
        tp: asNum(detailPlan.tp1 ?? detailPlan.tp),
        tp1: asNum(detailPlan.tp1),
        tp2: asNum(detailPlan.tp2),
        tp3: asNum(detailPlan.tp3),
        sl: asNum(detailPlan.sl),
        rr: asNum(detailPlan.rr),
        note: detailPlan.note,
        symbol: trade.symbol,
        volume: asNum(trade.volume),
      };
      await api.createTradeDirect(payload);
    } catch (e) {
      setError(e?.message || "Re-entry failed");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div className="loading">Loading trade {tradeId}...</div>;
  if (error) return <div className="error">{error}</div>;
  if (!trade) return <div className="empty-state">Trade not found.</div>;

  return (
    <section className="stack-layout" style={{ gap: 14 }}>
      <p style={{ marginBottom: 0 }}>
        <Link to="/trades" className="minor-text">
          ← BACK TO TRADES
        </Link>
      </p>
      {trade.execution_status === "PENDING" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="primary-button"
            style={{ background: "#ef5350", borderColor: "#ef5350" }}
            onClick={async () => {
              if (!confirm("Cancel this trade?")) return;
              try {
                const { promise: cp } = NotificationHub.track(
                  "cancel_trade",
                  { symbol: trade.symbol, sid: trade.sid || trade.id },
                  () => api.cancelTrades({ ids: [trade.sid || trade.id] }),
                );
                await cp;
                window.location.reload();
              } catch (e) {
                setError(e?.message || "Cancel failed");
              }
            }}
          >
            Cancel Trade
          </button>
        </div>
      )}
      {trade.execution_status === "Draft" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="primary-button"
            style={{ background: "#4caf50", borderColor: "#4caf50" }}
            onClick={async () => {
              if (!confirm("Promote this draft to a live trade?")) return;
              try {
                await api.promoteDraftTrade(trade.sid || trade.id);
                window.location.reload();
              } catch (e) {
                setError(e?.message || "Promote failed");
              }
            }}
          >
            + Trade
          </button>
        </div>
      )}
      {trade.execution_status === "FILLED" && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="primary-button"
            style={{ background: "#ff9800", borderColor: "#ff9800" }}
            onClick={async () => {
              if (!confirm("Close this trade?")) return;
              try {
                const { promise: clp } = NotificationHub.track(
                  "close_trade",
                  { symbol: trade.symbol, sid: trade.sid || trade.id },
                  () =>
                    api.v2UpdateTrade(trade.sid || trade.id, {
                      execution_status: "CLOSED",
                    }),
                );
                await clp;
                window.location.reload();
              } catch (e) {
                setError(e?.message || "Close failed");
              }
            }}
          >
            Close Trade
          </button>
        </div>
      )}
      <div className="panel">
        <Suspense
          fallback={<div className="loading-card">Loading Details...</div>}
        >
          <SignalDetailCard
            key={`trade-detail-${trade?.sid || trade?.id || tradeId}`}
            mode="trade"
            header={header}
            response={trade}
            tradePlan={{
              enabled: true,
              hideEditor: false,
              mode: "trade",
              tradeId: trade.sid || trade.id,
              value: detailPlan,
              onChange: (k, v) => applyPlanChange(k, v),
              onSave: onUpdateTradePlan,
              onAddTrade: onReEntryTrade,
              showSaveDraftButton: false,
              showSaveButton: !isTerminal,
              viewOnly: isTerminal,
              lockTradeFields: isLocked,
              error: planError,
              status: statusUi(trade.execution_status),
              volume: `${trade.volume ?? "-"} lots`,
              pnl: <PnlDisplay value={trade.pnl_realized} />,
            }}
            chart={{
              enabled: true,
              detailTfTab,
              onDetailTfTabChange: setDetailTfTab,
              iframeTitle: `trade-detail-tv-${detailTfTab}`,
              symbol: trade.symbol,
              interval: trade.signal_tf || trade.chart_tf || "1h",
              live: true,
              entryPrice: asNum(detailPlan.entry) || asNum(trade.entry),
              slPrice: asNum(detailPlan.sl) || asNum(trade.sl),
              tpPrice: asNum(detailPlan.tp) || asNum(trade.tp),
              tp1Price:
                asNum(detailPlan.tp1) || asNum(trade.tp1) || asNum(trade.tp),
              tp2Price: asNum(detailPlan.tp2) || asNum(trade.tp2),
              tp3Price: asNum(detailPlan.tp3) || asNum(trade.tp3),
              onPlanLevelChange: (levelKey, levelValue) =>
                applyPlanChange(levelKey, formatNum3(levelValue)),
              createdAt: trade.created_at,
              openedAt: trade.opened_at,
              closedAt: trade.closed_at,
              provider:
                trade.provider || trade.metadata?.provider || "ICMARKETS",
              sessionPrefix:
                trade.session_prefix || trade.metadata?.session_prefix || "",
              tradeId: trade.sid || trade.id || "",
              analysisSnapshot:
                trade?.metadata?.analysis_snapshot ||
                trade?.raw_json?.analysis_snapshot ||
                null,
            }}
            metaItems={[
              { label: "Trade SID", value: trade.sid || "-" },
              { label: "Signal SID", value: trade.signal_sid || "-" },
              {
                label: "Direction",
                value: detailPlan.direction || trade.action || "-",
              },
              {
                label: "Order Type",
                value: detailPlan.trade_type || detailPlan.order_type || "-",
              },
              {
                label: "Strategy",
                value: detailPlan.strategy || trade.strategy || "-",
              },
              {
                label: "Entry Model",
                value: detailPlan.entry_model || trade.entry_model || "-",
              },
              {
                label: "Model",
                value: trade.model || trade.metadata?.model || "-",
              },
              {
                label: "Source",
                value: detailPlan.source || trade.source_id || trade.source || "-",
              },
              {
                label: "Profile",
                value: detailPlan.profile || trade.profile || "-",
              },
              {
                label: "Session",
                value:
                  detailPlan.session ||
                  trade.session_prefix ||
                  trade.metadata?.session_prefix ||
                  "-",
              },
              { label: "Entry", value: detailPlan.entry || trade.entry || "-" },
              { label: "TP", value: detailPlan.tp || trade.tp || "-" },
              { label: "SL", value: detailPlan.sl || trade.sl || "-" },
              { label: "RR", value: detailPlan.rr || trade.rr_planned || "-" },
              {
                label: "Confidence",
                value:
                  detailPlan.confidence_pct != null
                    ? `${detailPlan.confidence_pct}%`
                    : detailPlan.confidence_level || "-",
              },
              {
                label: "Risk Level",
                value:
                  detailPlan.risk_level || trade.metadata?.risk_level || "-",
              },
              {
                label: "Risk %",
                value:
                  detailPlan.risk_pct != null ? `${detailPlan.risk_pct}%` : "-",
              },
              {
                label: "Risk $",
                value:
                  detailPlan.risk_money != null
                    ? `$${Number(detailPlan.risk_money).toFixed(2)}`
                    : "-",
              },
              { label: "Invalidation", value: detailPlan.invalidation || "-" },
              { label: "BE Trigger", value: detailPlan.be_trigger || "-" },
              { label: "Est. Bars", value: detailPlan.estimated_bars || "-" },
              {
                label: "Status",
                value: statusUi(trade.execution_status).label,
              },
              { label: "Broker Ticket", value: brokerTicketOf(trade) },
              { label: "Account", value: trade.account_id || "-" },
              { label: "Volume", value: `${trade.volume ?? "-"} lots` },
              {
                label: "Signal TF",
                value: formatTimeframe(trade.signal_tf || trade.tf || "-"),
              },
              {
                label: "Chart TF",
                value: formatTimeframe(trade.chart_tf || "-"),
              },
              {
                label: "Only Signal",
                value:
                  trade.only_signal != null ? String(trade.only_signal) : "-",
              },
              { label: "Created", value: fDateTime(trade.created_at) },
              {
                label: "Entry Condition",
                value: detailPlan.entry_condition || "-",
                fullWidth: true,
              },
              {
                label: "Exit Condition",
                value: detailPlan.exit_condition || "-",
                fullWidth: true,
              },
              {
                label: "Trade Decision",
                value:
                  detailPlan.trade_decision ||
                  detailPlan.skip_recommendation ||
                  "-",
              },
              {
                label: "Risk Management",
                value: detailPlan.risk_management || "-",
              },
              {
                label: "Multiple Exits",
                value:
                  detailPlan.multiple_exits &&
                  Object.keys(detailPlan.multiple_exits).length
                    ? JSON.stringify(detailPlan.multiple_exits, null, 2)
                    : "-",
                fullWidth: true,
                valueStyle: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              },
              {
                label: "Partial TPs",
                value:
                  Array.isArray(detailPlan.partial_tps) &&
                  detailPlan.partial_tps.length
                    ? JSON.stringify(detailPlan.partial_tps, null, 2)
                    : "-",
                fullWidth: true,
                valueStyle: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              },
              {
                label: "Checklist",
                value:
                  Array.isArray(detailPlan.confluence_checklist) &&
                  detailPlan.confluence_checklist.length
                    ? JSON.stringify(detailPlan.confluence_checklist, null, 2)
                    : "-",
                fullWidth: true,
                valueStyle: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              },
              {
                label: "Reasons to Skip",
                value:
                  Array.isArray(detailPlan.reasons_to_skip) &&
                  detailPlan.reasons_to_skip.length
                    ? JSON.stringify(detailPlan.reasons_to_skip, null, 2)
                    : "-",
                fullWidth: true,
                valueStyle: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              },
              {
                label: "Snapshot Files",
                value:
                  Array.isArray(trade.snapshot_files) &&
                  trade.snapshot_files.length
                    ? trade.snapshot_files.join(", ")
                    : Array.isArray(trade.metadata?.snapshot_files) &&
                        trade.metadata.snapshot_files.length
                      ? trade.metadata.snapshot_files.join(", ")
                      : "-",
                fullWidth: true,
              },
              {
                label: "AI Analysis",
                value:
                  detailPlan.ai_full_analysis &&
                  Object.keys(detailPlan.ai_full_analysis).length
                    ? JSON.stringify(detailPlan.ai_full_analysis, null, 2)
                    : "-",
                fullWidth: true,
                valueStyle: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              },
              {
                label: "Analysis Snapshot",
                value:
                  trade?.metadata?.analysis_snapshot ||
                  trade?.raw_json?.analysis_snapshot
                    ? JSON.stringify(
                        trade?.metadata?.analysis_snapshot ||
                          trade?.raw_json?.analysis_snapshot ||
                          {},
                        null,
                        2,
                      )
                    : "-",
                fullWidth: true,
                valueStyle: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              },
              { label: "Note", value: trade.note || "-", fullWidth: true },
              {
                label: "Raw JSON (Merged)",
                value: JSON.stringify(mergedRawJson || {}, null, 2),
                fullWidth: true,
                valueStyle: {
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
                },
              },
            ]}
            history={{
              enabled: true,
              items: [...events].sort(
                (a, b) =>
                  new Date(b.event_time || b.created_at || 0).getTime() -
                  new Date(a.event_time || a.created_at || 0).getTime(),
              ),
              renderItem: (ev, idx) =>
                renderHistoryItem(ev, idx, {
                  formatDateTime: fDateTime,
                  includeTicket: true,
                }),
            }}
          />
        </Suspense>
      </div>
    </section>
  );
}
