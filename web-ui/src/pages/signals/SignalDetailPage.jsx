import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../../api";

const SignalDetailCard = lazy(() => import("../../components/SignalDetailCard"));
import { buildDetailHeader } from "../../components/SignalDetailHeaderBuilder";
import { 
  asNum, 
  buildHeaderMeta, 
  renderHistoryItem,
  extractTradePlanFromSignal,
  applyLinkedPlanChange,
} from "../../utils/signalDetailUtils";
import { showDateTime } from "../../utils/format";

function PnlDisplay({ value }) {
  const n = asNum(value);
  if (n == null) return <span className="minor-text">-</span>;
  const cls = n < 0 ? "money-neg" : "money-pos";
  return <span className={cls} style={{ fontWeight: 800 }}>${n.toFixed(2)}</span>;
}

function statusUi(statusRaw) {
  const s = String(statusRaw || "").toUpperCase();
  if (["ACTIVE", "OPEN", "PLACED", "START", "TRUE"].includes(s)) return { cls: "ACTIVE", label: s === "TRUE" ? "ACTIVE" : s };
  if (["INACTIVE", "FALSE", "DISABLE", "DISABLED", "CANCELLED", "CANCEL"].includes(s)) return { cls: "INACTIVE", label: s === "FALSE" ? "INACTIVE" : s };
  if (s === "LOCKED") return { cls: "LOCKED", label: "LOCKED" };
  if (s === "TP") return { cls: "TP", label: "TP" };
  if (s === "SL") return { cls: "SL", label: "SL" };
  return { cls: "OTHER", label: s || "UNKNOWN" };
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

export default function SignalDetailPage() {
  const { signalId } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [detailTfTab, setDetailTfTab] = useState("ENTRY");
  const [detailPlan, setDetailPlan] = useState({ direction: "BUY", trade_type: "limit", entry: "", tp: "", sl: "", rr: "", note: "" });

  useEffect(() => {
    let live = true;
    api.trade(signalId)
      .then((res) => {
        if (!live) return;
        setData(res);
        if (res?.trade) {
          setDetailPlan(extractTradePlanFromSignal(res.trade));
        }
      })
      .catch((e) => {
        if (!live) return;
        setError(e?.message || "Load failed");
      });
    return () => {
      live = false;
    };
  }, [signalId]);

  const t = data?.trade || null;
  const events = Array.isArray(data?.events) ? data.events : [];

  const header = useMemo(() => {
    if (!t) return null;
    const rr = asNum(t.rr_planned);
    const vol = asNum(t.volume);
    const risk = asNum(t.risk_money_actual ?? t.risk_money_planned ?? t?.raw_json?.risk_money ?? t?.raw_json?.risk);
    const raw = t?.raw_json && typeof t.raw_json === "object" ? t.raw_json : {};
    const riskPct = asNum(raw.riskPct ?? raw.risk_pct ?? raw.volumePct ?? raw.volume_pct);
    const reward = (risk != null && rr != null) ? (Math.abs(risk) * rr) : null;
    const headerMeta = buildHeaderMeta({
      statusRaw: t.status,
      pnlRaw: t.pnl_money_realized,
      rrRaw: rr,
      volumeRaw: vol,
      plannedVolRaw: asNum(raw.volume) ?? vol,
      riskSizeRaw: risk,
      riskPctRaw: riskPct,
      rewardSizeRaw: reward,
      updatedAtRaw: t.updated_at || t.closed_at || t.opened_at || t.created_at,
      statusUi,
    });
    const side = String(t.action || t.side || "-").toUpperCase();
    return buildDetailHeader({
      side,
      symbol: t.symbol || "-",
      sideClass: side === "BUY" ? "side-buy" : "side-sell",
      positionText: `${t.entry_price || t.entry || "-"} → ${t.tp || "-"} / ${t.sl || "-"}`,
      ...headerMeta,
    });
  }, [t]);

  const isClosed = useMemo(() => {
    return ["FILLED", "CLOSED", "CANCELLED", "TP", "SL", "FAIL", "EXPIRED"].includes(String(t?.status || "").toUpperCase());
  }, [t?.status]);

  async function onSaveSignalPlan() {
    if (!t) return;
    try {
      setData(prev => ({ ...prev, trade: { ...prev.trade, note: detailPlan.note } })); // Optimistic
      await api.saveSignalTradePlan(signalId, {
        entry: asNum(detailPlan.entry),
        tp: asNum(detailPlan.tp),
        sl: asNum(detailPlan.sl),
        rr: asNum(detailPlan.rr),
        note: detailPlan.note,
        direction: detailPlan.direction,
      });
      // reload
      const res = await api.trade(signalId);
      setData(res);
    } catch (e) {
      setError(e?.message || "Save failed");
    }
  }

  if (error) return <div className="error">{error}</div>;
  if (!t) return <div className="loading">Loading signal...</div>;

  return (
    <section className="stack-layout" style={{ gap: 14 }}>
      <p style={{ marginBottom: 0 }}><Link to="/signals" className="minor-text">← BACK TO SIGNALS</Link></p>
      <div className="panel">
        <Suspense fallback={<div className="loading-card">Loading Details...</div>}>
          <SignalDetailCard
            mode="signal"
            header={header}
            response={t}
            tradePlan={{
              enabled: true,
              hideEditor: false,
              value: detailPlan,
              onChange: (k, v) => setDetailPlan(p => applyLinkedPlanChange(p, k, v)),
              onSave: onSaveSignalPlan,
              showSaveButton: !isClosed,
              viewOnly: isClosed,
              status: statusUi(t.status),
              volume: `${t.volume ?? "-"} lots`,
              pnl: <PnlDisplay value={t.pnl_money_realized} />,
            }}
            chart={{
              enabled: true,
              detailTfTab,
              onDetailTfTabChange: setDetailTfTab,
              iframeTitle: `signal-detail-tv-${detailTfTab}`,
              symbol: t.symbol,
              interval: t.signal_tf || t.chart_tf || "1h",
              live: true,
              entryPrice: asNum(t.entry_price || t.raw_json?.entry || t.entry),
              slPrice: asNum(t.sl_price || t.raw_json?.sl || t.sl),
              tpPrice: asNum(t.tp_price || t.raw_json?.tp || t.tp),
              analysisSnapshot: t?.raw_json?.analysis_snapshot || null,
            }}
            metaItems={[
              { label: "Signal SID", value: t.sid || "-" },
              { label: "Strategy", value: t.strategy || t.raw_json?.strategy || "-" },
              { label: "Entry Model", value: t.entry_model || t.raw_json?.entry_model || "-" },
              { label: "Status", value: statusUi(t.status).label },
              { label: "Order Type", value: String(t?.raw_json?.order_type || t?.raw_json?.orderType || "limit").toUpperCase() },
              { label: "Signal TF", value: formatTimeframe(t.signal_tf || "-") },
              { label: "Volume", value: `${t.volume ?? "-"} lots` },
              { label: "Created", value: fDateTime(t.created_at) },
              { label: "Note", value: t.note || "-", fullWidth: true },
              { label: "Raw JSON", value: JSON.stringify(t.raw_json || {}, null, 2), fullWidth: true, valueStyle: { whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" } },
            ]}
            history={{
              enabled: true,
              items: [...events].sort((a, b) => new Date(b.event_time || 0).getTime() - new Date(a.event_time || 0).getTime()),
              renderItem: (ev, idx) => renderHistoryItem(ev, idx, { formatDateTime: fDateTime, includeTicket: true }),
            }}
          />
        </Suspense>
      </div>
    </section>
  );
}
