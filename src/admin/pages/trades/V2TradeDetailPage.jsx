import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { NotificationHub } from "../../services/NotificationHub";
import SignalDetailCard from "../../components/SignalDetailCard";
import { buildDetailHeader } from "../../components/SignalDetailHeaderBuilder";
import {
  asNum,
  asFiniteOrNull,
  applyLinkedPlanChange,
  buildHeaderMeta,
  renderHistoryItem,
  extractTradePlanFromTrade,
  formatNum3,
  normalizeOrderTypeValue,
  validateTradePlan,
} from "../../utils/signalDetailUtils";
import { formatDateTimeWithDuration, showDateTime } from "../../utils/format";
import { showToast } from "../../../shared/components/ToastContainer";
import { BrokerTicketBadge } from "../../components/BrokerTicketBadge";
import PnlDisplay from "../../components/PnlDisplay";
import { getBrokerTicket } from "../../utils/tradeRow";
import { useConfirmDialog } from "../../../shared/components/ConfirmDialog";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";
import {
  plannedPnlValueStyle,
  resolveDisplayedPlannedPnl,
} from "../../utils/tradePlannedPnl";

function statusUi(statusRaw) {
  const s = String(statusRaw || "").toUpperCase();
  if (s === "FILLED" || s === "OPEN") return { cls: "ACTIVE", label: "FILLED" };
  if (s === "CLOSED" || s === "CANCELLED") return { cls: "INACTIVE", label: s };
  if (s === "REJECTED") return { cls: "FAIL", label: "REJECTED" };
  if (s === "ERROR" || s === "FAIL") return { cls: "FAIL", label: s };
  if (s === "PENDING" || s === "NEW") return { cls: "OTHER", label: "PENDING" };
  return { cls: "OTHER", label: s || "PENDING" };
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

function inferDirection(entry, tp, sl, fallback = "BUY") {
  if (Number.isFinite(entry) && Number.isFinite(tp) && Number.isFinite(sl)) {
    if (tp > entry && sl < entry) return "BUY";
    if (tp < entry && sl > entry) return "SELL";
  }
  return String(fallback || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY";
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

function formatClosedWithDuration(openedAt, closedAt) {
  return formatDateTimeWithDuration(closedAt, openedAt);
}

function formatOpenedWithDuration(createdAt, openedAt) {
  return formatDateTimeWithDuration(openedAt, createdAt);
}

function resolveOpenedDisplayAt(trade = {}) {
  return (
    trade?.opened_at ||
    trade?.ack_at ||
    trade?.metadata?.broker_data?.opened_at ||
    trade?.metadata?.broker_data?.openedAt ||
    null
  );
}

function brokerPnlValueStyle(pnlRaw) {
  const pnl = asNum(pnlRaw);
  if (!Number.isFinite(pnl)) return undefined;
  return {
    color: pnl >= 0 ? "#16a34a" : "#dc2626",
    fontWeight: 600,
  };
}

function toTradeVolumeUnits(plan = {}) {
  const displayLots = asFiniteOrNull(plan.volume);
  if (!Number.isFinite(displayLots)) return null;
  const basisUnits = asFiniteOrNull(plan.volume_units);
  const basisLots = asFiniteOrNull(plan.broker_lots ?? plan.volume);
  if (
    Number.isFinite(basisUnits) &&
    basisUnits > 0 &&
    Number.isFinite(basisLots) &&
    basisLots > 0
  ) {
    return Number((displayLots * (basisUnits / basisLots)).toFixed(8));
  }
  return displayLots;
}

export default function TradeDetailPage() {
  const { tradeId } = useParams();
  const navigate = useNavigate();
  const confirmDialog = useConfirmDialog();
  const EMPTY_DETAIL_PLAN = useMemo(
    () => ({
      direction: "BUY",
      trade_type: "limit",
      entry: "",
      tp: "",
      sl: "",
      rr: "",
      note: "",
      close_reason: "",
      rejection_reason: "",
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
  const [detailPlanChartRefreshNonce, setDetailPlanChartRefreshNonce] =
    useState(0);
  const [detailPlanChartRefreshError, setDetailPlanChartRefreshError] =
    useState("");
  const detailPlanChartRefreshInitRef = useRef(false);
  const detailPlanChartRefreshTimerRef = useRef(null);

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

      next.trade_type = normalizeOrderTypeValue(
        key === "trade_type" ? rawValue : next.trade_type || prev.trade_type,
        "limit",
      );

      setPlanError("");
      return next;
    });
  };

  useEffect(() => {
    if (!detailPlanChartRefreshError) return;
    setDetailPlanChartRefreshError("");
  }, [
    detailPlan.direction,
    detailPlan.entry,
    detailPlan.sl,
    detailPlan.tp,
    detailPlan.tp1,
    detailPlan.tp2,
    detailPlan.tp3,
  ]);

  const runDetailPlanChartRefresh = (opts = {}) => {
    const { silent = false } = opts;
    const validationError =
      validateTradePlan(detailPlan, { skipRrCheck: false }) || "";
    if (validationError) {
      if (!silent) setDetailPlanChartRefreshError(validationError);
      return;
    }
    setDetailPlanChartRefreshError("");
    setDetailPlanChartRefreshNonce((prev) => prev + 1);
  };

  const handleDetailPlanChartRefresh = () => {
    runDetailPlanChartRefresh({ silent: false });
  };

  useEffect(() => {
    if (!detailPlanChartRefreshInitRef.current) {
      detailPlanChartRefreshInitRef.current = true;
      return;
    }
    if (detailPlanChartRefreshTimerRef.current) {
      window.clearTimeout(detailPlanChartRefreshTimerRef.current);
    }
    detailPlanChartRefreshTimerRef.current = window.setTimeout(() => {
      runDetailPlanChartRefresh({ silent: true });
      detailPlanChartRefreshTimerRef.current = null;
    }, 220);
    return () => {
      if (detailPlanChartRefreshTimerRef.current) {
        window.clearTimeout(detailPlanChartRefreshTimerRef.current);
        detailPlanChartRefreshTimerRef.current = null;
      }
    };
  }, [
    detailPlan.direction,
    detailPlan.entry,
    detailPlan.sl,
    detailPlan.tp,
    detailPlan.tp1,
    detailPlan.tp2,
    detailPlan.tp3,
  ]);

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
          setDetailPlan({
            ...extractTradePlanFromTrade(t),
            close_reason: t?.close_reason || "",
            rejection_reason: t?.rejection_reason || "",
          });
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
    const sidText = String(trade.sid || trade.signal_sid || "-").trim() || "-";
    const brokerIdText = getBrokerTicket(trade);
    const currentStatus = statusUi(trade.execution_status);
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
      positionText: `${trade.entry_price_exec || trade.entry || "-"} → ${trade.tp || "-"} / ${trade.sl || "-"}`,
      aiBadges: (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 10,
              color: "var(--muted)",
              opacity: 0.95,
            }}
          >
            <span
              className="badge badge-mini"
              style={{ fontSize: 9, fontWeight: 400, padding: "2px 6px" }}
            >
              {sidText}
            </span>
            <BrokerTicketBadge
              brokerId={brokerIdText}
              dispatchStatus={trade.dispatch_status}
            />
            <span>|</span>
            <span
              className={`badge ${currentStatus.cls}`}
              title={
                trade.execution_status === "REJECTED" && trade.rejection_reason
                  ? trade.rejection_reason
                  : undefined
              }
              style={{ cursor: trade.rejection_reason ? "help" : "default" }}
            >
              {currentStatus.label}
            </span>
            {trade.execution_status === "REJECTED" &&
              trade.rejection_reason && (
                <span className="minor-text" style={{ fontSize: 11 }}>
                  {trade.rejection_reason}
                </span>
              )}
            {(() => {
              const d = trade.dispatch_status || "OPEN";
              if (d === "REJECTED")
                return (
                  <span
                    title={trade.rejection_reason || "Sync failed"}
                    style={{ cursor: "default", fontSize: 12 }}
                  >
                    ❌
                  </span>
                );
              if (d === "MODIFY" || d === "CLOSE" || d === "CANCEL")
                return (
                  <span
                    title={`Sync pending: ${d}`}
                    style={{ cursor: "default", fontSize: 12 }}
                  >
                    ⏳
                  </span>
                );
              if (d === "LEASED")
                return (
                  <span
                    title="Syncing with broker..."
                    style={{ cursor: "default", fontSize: 12 }}
                  >
                    🔄
                  </span>
                );
              return null;
            })()}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
              justifyContent: "flex-end",
            }}
          >
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
          </div>
        </div>
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
    return ["CLOSED", "CANCELLED"].includes(
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
      const status = String(trade.execution_status || "").toUpperCase();
      const lockSideType = status === "FILLED";
      const lockAll = status === "CLOSED" || status === "CANCELLED";
      const payload = {
        side: lockSideType || lockAll ? null : detailPlan.direction,
        order_type: lockSideType || lockAll ? null : detailPlan.trade_type,
        price: lockAll ? null : asFiniteOrNull(detailPlan.entry),
        tp: lockAll ? null : asFiniteOrNull(detailPlan.tp1 ?? detailPlan.tp),
        tp1: lockAll ? null : asFiniteOrNull(detailPlan.tp1),
        tp2: lockAll ? null : asFiniteOrNull(detailPlan.tp2),
        tp3: lockAll ? null : asFiniteOrNull(detailPlan.tp3),
        sl: lockAll ? null : asFiniteOrNull(detailPlan.sl),
        rr: lockAll ? null : asFiniteOrNull(detailPlan.rr),
        strategy: detailPlan.strategy,
        entry_model: detailPlan.entry_model,
        source_id: detailPlan.source_id,
        note: detailPlan.note,
        volume: lockAll ? null : asFiniteOrNull(detailPlan.volume),
        lots: lockAll ? null : asFiniteOrNull(detailPlan.volume),
        risk_money: asFiniteOrNull(
          detailPlan.risk_money_planned ?? detailPlan.risk_money,
        ),
        risk_money_planned: asFiniteOrNull(
          detailPlan.risk_money_planned ?? detailPlan.risk_money,
        ),
      };
      await api.saveTradePlan(tradeId, payload);
      if (["CLOSED", "CANCELLED", "CANCEL", "REJECTED"].includes(status)) {
        const closedAt = new Date().toISOString();
        const reasonPayload =
          status === "REJECTED"
            ? {
                execution_status: status,
                rejection_reason: String(
                  detailPlan.rejection_reason || "",
                ).trim(),
                closed_at: closedAt,
              }
            : {
                execution_status: status,
                close_reason: String(detailPlan.close_reason || "").trim(),
                closed_at: closedAt,
              };
        await api.v2UpdateTrade(tradeId, reasonPayload);
      }
      // Reload trade events and trade data (but keep user-edited plan intact)
      const [evs, data] = await Promise.all([
        api.v2TradeEvents(tradeId),
        api.v2Trades({ q: tradeId }),
      ]);
      setEvents(Array.isArray(evs?.items) ? evs.items : []);
      const t =
        (Array.isArray(data?.items) &&
          (data.items.find((x) => String(x?.sid || "") === String(tradeId)) ||
            data.items.find((x) => String(x?.id || "") === String(tradeId)))) ||
        null;
      if (t) setTrade(t);
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

  async function onApproveDraft() {
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
      showToast({ message: validErr, type: "error" });
      return;
    }
    const ok = await confirmDialog({
      title: "Approve Draft",
      message: "Approve this draft and move to pending?",
      confirmLabel: "Approve",
      cancelLabel: "Cancel",
    });
    if (!ok) return;
    try {
      setLoading(true);
      await api.promoteDraftTrade(trade.sid || trade.id);
      navigate(`/trades/pending/${trade.sid || trade.id}`, {
        replace: true,
      });
    } catch (e) {
      setError(e?.message || "Approve failed");
    } finally {
      setLoading(false);
    }
  }

  async function onRejectDraft() {
    if (!trade) return;
    const reason = prompt("Rejection reason (optional):") || "Rejected";
    if (!confirm(`Reject this draft? (${reason})`)) return;
    try {
      setLoading(true);
      await api.v2UpdateTrade(trade.sid || trade.id, {
        execution_status: "REJECTED",
        rejection_reason: reason,
        closed_at: new Date().toISOString(),
      });
      navigate(`/trades/rejected/${trade.sid || trade.id}`, {
        replace: true,
      });
    } catch (e) {
      setError(e?.message || "Reject failed");
    } finally {
      setLoading(false);
    }
  }

  async function onCancelDraft() {
    if (!trade) return;
    const ask = await confirmDialog({
      title: "Cancel Draft Trade",
      message: "Cancel this draft trade?",
      confirmLabel: "Cancel Trade",
      cancelLabel: "Keep Draft",
      tone: "danger",
      input: true,
      inputPlaceholder: "Reason (optional)",
    });
    if (!ask || ask?.ok !== true) return;
    const reason = String(ask?.value || "").trim();
    try {
      setLoading(true);
      await api.v2UpdateTrade(trade.sid || trade.id, {
        execution_status: "CANCELLED",
        close_reason: reason || "CANCEL",
        closed_at: new Date().toISOString(),
      });
      navigate(`/trades/cancelled/${trade.sid || trade.id}`, {
        replace: true,
      });
    } catch (e) {
      setError(e?.message || "Cancel failed");
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
              const ask = await confirmDialog({
                title: "Cancel Trade",
                message: "Cancel this trade?",
                confirmLabel: "Cancel Trade",
                secondaryConfirmLabel: "Cancel & stay",
                cancelLabel: "Cancel",
                tone: "danger",
                input: true,
                inputPlaceholder: "Reason (optional)",
              });
              if (!ask || ask?.ok !== true) return;
              const reason = String(ask?.value || "").trim();
              const stay = ask?.action === "secondary";
              try {
                const { promise: cp } = NotificationHub.track(
                  "cancel_trade",
                  { symbol: trade.symbol, sid: trade.sid || trade.id },
                  () =>
                    api.cancelTrades({
                      ids: [trade.sid || trade.id],
                      reason: reason || "CANCEL",
                    }),
                );
                await cp;
                if (stay) {
                  navigate(`/trades/pending`, { replace: true });
                } else {
                  navigate(`/trades/cancelled/${trade.sid || trade.id}`, {
                    replace: true,
                  });
                }
              } catch (e) {
                setError(e?.message || "Cancel failed");
              }
            }}
          >
            Cancel Trade
          </button>
        </div>
      )}
      {isDraft && (
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="primary-button"
            style={{ background: "#06b6d4", borderColor: "#06b6d4" }}
            onClick={onApproveDraft}
          >
            Approve
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onCancelDraft}
          >
            Cancel
          </button>
          <button
            type="button"
            className="danger-button"
            onClick={onRejectDraft}
          >
            Reject
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
              const ask = await confirmDialog({
                title: "Close Trade",
                message: "Close this trade?",
                confirmLabel: "Close Trade",
                secondaryConfirmLabel: "Close & stay",
                cancelLabel: "Cancel",
                tone: "danger",
                input: true,
                inputPlaceholder: "Reason (optional)",
              });
              if (!ask || ask?.ok !== true) return;
              const reason = String(ask?.value || "").trim();
              const stay = ask?.action === "secondary";
              try {
                const { promise: clp } = NotificationHub.track(
                  "close_trade",
                  { symbol: trade.symbol, sid: trade.sid || trade.id },
                  () =>
                    api.v2UpdateTrade(trade.sid || trade.id, {
                      execution_status: "CLOSED",
                      close_reason: reason || "MANUAL",
                      closed_at: new Date().toISOString(),
                    }),
                );
                await clp;
                if (stay) {
                  navigate(`/trades/filled`, { replace: true });
                } else {
                  navigate(`/trades/closed/${trade.sid || trade.id}`, {
                    replace: true,
                  });
                }
              } catch (e) {
                setError(e?.message || "Close failed");
              }
            }}
          >
            Close Trade
          </button>
        </div>
      )}
      <ResponsivePanel
        title="TRADE DETAIL"
        collapseDirection="top-down"
        bodyClassName="stack-layout"
      >
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
              sid: trade.sid || trade.signal_sid || "",
              broker_trade_id:
                trade.broker_trade_id || trade.ticket || trade.broker_id || "",
              execution_status: trade.execution_status || "",
              dispatch_status: trade.dispatch_status || "",
              rejection_reason: trade.rejection_reason || "",
              value: detailPlan,
              onChange: (k, v) => applyPlanChange(k, v),
              onSave: onUpdateTradePlan,
              onAddTrade: !isDraft ? onReEntryTrade : undefined,
              onPromote: isDraft ? onApproveDraft : undefined,
              onCancel: isDraft ? onCancelDraft : undefined,
              promoteLabel: "Approve",
              showSaveDraftButton: false,
              showSaveButton: !isTerminal,
              viewOnly: isTerminal,
              lockTradeFields: isLocked,
              lockMode: (() => {
                const st = String(trade.execution_status || "").toUpperCase();
                if (st === "CLOSED" || st === "CANCELLED") return "all";
                if (st === "FILLED") return "sideType";
                return "none";
              })(),
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
              entryPrice:
                asNum(trade.entry_price_exec) ||
                asNum(detailPlan.entry) ||
                asNum(trade.entry),
              slPrice: asNum(detailPlan.sl) || asNum(trade.sl),
              tpPrice: asNum(detailPlan.tp) || asNum(trade.tp),
              tp1Price:
                asNum(detailPlan.tp1) || asNum(trade.tp1) || asNum(trade.tp),
              tp2Price: asNum(detailPlan.tp2) || asNum(trade.tp2),
              tp3Price: asNum(detailPlan.tp3) || asNum(trade.tp3),
              onRequestPlanRefresh: handleDetailPlanChartRefresh,
              planRefreshNonce: detailPlanChartRefreshNonce,
              planRefreshError: detailPlanChartRefreshError,
              onPlanLevelChange: (levelKey, levelValue) =>
                applyPlanChange(levelKey, formatNum3(levelValue)),
              createdAt: trade.created_at,
              openedAt: trade.opened_at,
              closedAt: trade.closed_at,
              closeStatus:
                trade.close_reason || trade.execution_status || "",
              exitPrice: asNum(trade.exit_price) || null,
              pnlRealized:
                asNum(trade.broker_pnl) ?? asNum(trade.pnl_realized) ?? null,
              provider:
                trade.account_provider_code ||
                trade.provider ||
                trade.metadata?.provider ||
                "ICMARKETS",
              anchorToTradeTime: Boolean(
                trade.created_at || trade.opened_at || trade.closed_at,
              ),
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
                value:
                  detailPlan.source || trade.source_id || trade.source || "-",
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
              {
                label: "Entry",
                value: trade.entry_price_exec || trade.entry || "-",
              },
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
                label: "Volume",
                value:
                  trade.volume != null
                    ? `${Number(trade.volume).toFixed(2)} lots`
                    : detailPlan.volume != null
                      ? `${Number(detailPlan.volume).toFixed(2)} lots`
                      : "-",
              },
              {
                label: "PnL TP",
                value:
                  trade.broker_tp_pnl != null
                    ? `+$${Number(trade.broker_tp_pnl).toFixed(2)}`
                    : "-",
                cls: "money-pos",
              },
              {
                label: "PnL SL",
                value:
                  trade.broker_sl_pnl != null
                    ? `-$${Math.abs(Number(trade.broker_sl_pnl)).toFixed(2)}`
                    : "-",
                cls: "money-neg",
              },
              { label: "Invalidation", value: detailPlan.invalidation || "-" },
              { label: "BE Trigger", value: detailPlan.be_trigger || "-" },
              { label: "Est. Bars", value: detailPlan.estimated_bars || "-" },
              {
                label: "Status",
                value: statusUi(trade.execution_status).label,
              },
              trade.rejection_reason
                ? {
                    label: "Reason",
                    value: trade.rejection_reason,
                    cls: "warn",
                  }
                : null,
              trade.dispatch_status &&
              trade.dispatch_status !== "CONSUMED" &&
              trade.dispatch_status !== "OPEN"
                ? {
                    label: "Sync Status",
                    value: `${trade.dispatch_status}${trade.rejection_reason ? " — " + trade.rejection_reason : ""}`,
                    cls: trade.dispatch_status === "REJECTED" ? "warn" : "",
                  }
                : null,
              { label: "Broker Ticket", value: getBrokerTicket(trade) },
              { label: "Account", value: trade.account_id || "-" },
              trade.account_broker_name || trade.account_metadata?.broker_name
                ? {
                    label: "Broker Name",
                    value:
                      trade.account_broker_name ||
                      trade.account_metadata?.broker_name ||
                      "-",
                    group: "identity",
                  }
                : null,
              {
                label: "Provider",
                value:
                  trade.account_provider_code ||
                  trade.account_metadata?.provider_code ||
                  trade.metadata?.provider_code ||
                  "-",
                group: "identity",
              },
              resolveDisplayedPlannedPnl(trade, "sl") != null
                ? {
                    label: "Planned SL Profit",
                    value: `$${resolveDisplayedPlannedPnl(trade, "sl").toFixed(2)}`,
                    group: "pnl",
                    valueStyle: plannedPnlValueStyle("sl"),
                  }
                : null,
              resolveDisplayedPlannedPnl(trade, "tp") != null
                ? {
                    label: "Planned TP Profit",
                    value: `$${resolveDisplayedPlannedPnl(trade, "tp").toFixed(2)}`,
                    group: "pnl",
                    valueStyle: plannedPnlValueStyle("tp"),
                  }
                : null,
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
              { label: "Created", value: showDateTime(trade.created_at) },
              {
                label: "Opened",
                value: formatOpenedWithDuration(
                  trade.created_at,
                  resolveOpenedDisplayAt(trade),
                ),
              },
              {
                label: "Closed",
                value: formatClosedWithDuration(
                  resolveOpenedDisplayAt(trade),
                  trade.closed_at,
                ),
              },
              {
                label: "Exit Price",
                value:
                  asNum(trade.exit_price) != null
                    ? String(asNum(trade.exit_price))
                    : "-",
              },
              {
                label: "Broker PnL",
                value: (() => {
                  const pnl =
                    asNum(trade.broker_pnl) ?? asNum(trade.pnl_realized) ?? null;
                  return pnl != null ? `$${Number(pnl).toFixed(2)}` : "-";
                })(),
                valueStyle: brokerPnlValueStyle(
                  asNum(trade.broker_pnl) ?? asNum(trade.pnl_realized) ?? null,
                ),
              },
              asNum(trade.broker_pnl)
                ? {
                    label: "Broker Net Profit",
                    value: `$${asNum(trade.broker_pnl).toFixed(2)}`,
                    group: "pnl",
                  }
                : null,
              {
                label: "Last Synced",
                value: trade.updated_at ? showDateTime(trade.updated_at) : "-",
                group: "sizing",
              },
              asNum(trade.broker_swap)
                ? {
                    label: "Swap",
                    value: `$${asNum(trade.broker_swap).toFixed(2)}`,
                    group: "sizing",
                  }
                : null,
              asNum(trade.broker_margin)
                ? {
                    label: "Broker Margin",
                    value: `$${asNum(trade.broker_margin).toFixed(2)}`,
                    group: "sizing",
                  }
                : null,
              trade.margin != null
                ? {
                    label: "Margin",
                    value: `$${Number(trade.margin).toFixed(2)}`,
                    group: "sizing",
                  }
                : null,
              asNum(trade.broker_commission)
                ? {
                    label: "Commission",
                    value: `$${asNum(trade.broker_commission).toFixed(2)}`,
                    group: "sizing",
                  }
                : null,
              asNum(trade.broker_volume)
                ? {
                    label: "Vol",
                    value: `${Number(trade.broker_volume).toLocaleString()} units`,
                    group: "sizing",
                  }
                : null,
              asNum(trade.broker_lots)
                ? {
                    label: "Lots",
                    value: `${asNum(trade.broker_lots).toFixed(2)} lots`,
                    group: "sizing",
                  }
                : null,
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
                  formatDateTime: showDateTime,
                  includeTicket: true,
                }),
            }}
          />
        </Suspense>
      </ResponsivePanel>
    </section>
  );
}
