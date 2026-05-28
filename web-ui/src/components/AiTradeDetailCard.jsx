import SignalDetailCard from "./SignalDetailCard";
import { applyLinkedPlanChange } from "../utils/signalDetailUtils";

function parseRawJson(raw) {
  try {
    if (raw && typeof raw === "object") return raw;
    if (typeof raw === "string") return JSON.parse(raw);
  } catch (_) {}
  return {};
}

function tradePlansFromTrade(trade) {
  const obj = parseRawJson(trade?.raw_json);
  const tp = Array.isArray(obj?.trade_plan)
    ? obj.trade_plan
    : obj?.trade_plan
      ? [obj.trade_plan]
      : [];
  if (tp.length) return tp;
  return [
    {
      direction: trade?.action || "BUY",
      entry: trade?.entry_price_exec || trade?.entry,
      tp: trade?.tp,
      sl: trade?.sl,
    },
  ];
}

export default function AiTradeDetailCard({
  trade,
  detailPlan,
  setDetailPlan,
  onSave,
  onAddTrade,
  onCancel,
  onClose,
  onGoTrade,
  onGoAnalyze,
  onReset,
  detailTfTab = "4h",
  onDetailTfTabChange,
  provider = "",
}) {
  if (!trade) return null;
  const broker = trade?.metadata?.broker_data || {};
  const bd = (col, metaKey) => {
    const v = col != null ? Number(col) : asNum(broker[metaKey]);
    return Number.isFinite(v) ? v : null;
  };
  const asNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const bVol = bd(trade.broker_volume, "volume");
  const bLots = bd(trade.broker_lots, "lots");
  const bPips = bd(trade.broker_pips, "pips");
  const bProfit = bd(trade.broker_pnl, "pnl") ?? bd(trade.pnl_realized, "net_pnl");
  const bComm = bd(trade.broker_commission, "commission");
  const bSwap = bd(trade.broker_swap, "swap");
  const bMargin = bd(trade.broker_margin, "margin");
  const bTpPnl = bd(trade.broker_tp_pnl, "tp_pnl") ?? asNum(broker.pnl_tp);
  const bSlPnl = bd(trade.broker_sl_pnl, "sl_pnl") ?? asNum(broker.pnl_sl);
  const brokerItems = [
    { label: "Broker Name", value: trade.account_broker_name || trade.account_metadata?.broker_name || trade.metadata?.broker_name || "-", group: "identity" },
    { label: "Provider", value: trade.account_metadata?.provider_code || trade.metadata?.provider_code || "-", group: "identity" },
    { label: "Dispatch", value: trade.dispatch_status || "-", group: "identity" },
    { label: "Account", value: trade.account_id || "-", group: "identity" },
    { label: "Broker Ticket", value: trade.broker_trade_id || broker.ticket || "-", group: "identity" },
    { label: "Broker Status", value: trade.execution_status || broker.status || "-", group: "identity" },
    { label: "Entry (exec)", value: asNum(trade.entry_price_exec || trade.entry_exec || broker.entry)?.toFixed(2), group: "identity" },
    broker.trailing_stop != null ? { label: "Trailing Stop", value: broker.trailing_stop === "true" ? "Yes" : "No", group: "identity" } : null,
    { label: "Spread", value: asNum(broker.spread)?.toFixed(2), group: "pnl" },
    bVol != null ? { label: "Broker Volume", value: `${bVol.toLocaleString()} units`, group: "sizing" } : null,
    bLots != null ? { label: "Broker Lots", value: `${bLots.toFixed(2)} lots`, group: "sizing" } : null,
    bPips != null ? { label: "Broker Pips", value: `${bPips.toFixed(1)} pips`, group: "sizing" } : null,
    bProfit != null ? { label: "Broker Net Profit", value: `$${bProfit.toFixed(2)}`, group: "pnl" } : null,
    bComm != null ? { label: "Commission", value: `$${bComm.toFixed(2)}`, group: "pnl" } : null,
    bSwap != null ? { label: "Swap", value: `$${bSwap.toFixed(2)}`, group: "pnl" } : null,
    bMargin != null ? { label: "Margin", value: `$${bMargin.toFixed(2)}`, group: "pnl" } : null,
    bTpPnl != null ? { label: "Planned TP Profit", value: `$${bTpPnl.toFixed(2)}`, group: "pnl" } : null,
    bSlPnl != null ? { label: "Planned SL Profit", value: `$${bSlPnl.toFixed(2)}`, group: "pnl" } : null,
    asNum(broker.balance_tp) != null ? { label: "Balance TP", value: `$${asNum(broker.balance_tp).toFixed(2)}`, group: "pnl" } : null,
    asNum(broker.balance_sl) != null ? { label: "Balance SL", value: `$${asNum(broker.balance_sl).toFixed(2)}`, group: "pnl" } : null,
    asNum(broker.distance_tp) != null ? { label: "Distance TP (pips)", value: asNum(broker.distance_tp).toFixed(1), group: "pnl" } : null,
    asNum(broker.distance_sl) != null ? { label: "Distance SL (pips)", value: asNum(broker.distance_sl).toFixed(1), group: "pnl" } : null,
    broker.last_sync_at ? { label: "Last Sync", value: new Date(broker.last_sync_at).toLocaleTimeString(), group: "identity" } : null,
  ].filter(Boolean);
  return (
    <SignalDetailCard
      key={`ai-trade-detail-${trade.sid || trade.id}`}
      mode="trade"
      response={{
        raw: parseRawJson(trade?.raw_json),
        tradePlans: tradePlansFromTrade(trade),
      }}
      tradePlan={{
        enabled: true,
        hideEditor: false,
        mode: "trade",
        tradeId: trade.sid || trade.id,
        sid: trade.sid || trade.signal_sid || "",
        broker_trade_id: trade.broker_trade_id || trade.ticket || trade.broker_id || "",
        execution_status: trade.execution_status || "",
        dispatch_status: trade.dispatch_status || "",
        rejection_reason: trade.rejection_reason || null,
        entry_price_exec: trade.entry_price_exec || null,
        value: detailPlan,
        onChange: (k, v) => setDetailPlan((p) => applyLinkedPlanChange(p, k, v)),
        onSave,
        onReset,
        onGoTrade,
        onGoAnalyze,
        onAddTrade,
        showAddSignalButton: false,
        showSaveButton: !["TP", "SL", "FAIL", "EXPIRED"].includes(
          String(trade.execution_status || "").toUpperCase(),
        ),
        saveLabel: "Save Trade",
        showResetButton: true,
        resetLabel: "Reset",
        onCancel,
        onClose,
        viewOnly: ["TP", "SL", "FAIL", "EXPIRED"].includes(
          String(trade.execution_status || "").toUpperCase(),
        ),
      }}
      chart={{
        enabled: true,
        tradeId: trade.sid || trade.id || "",
        detailTfTab,
        onDetailTfTabChange,
        symbol: trade.symbol,
        provider:
          trade.account_metadata?.provider_code ||
          trade.metadata?.provider_code ||
          provider ||
          "",
        interval: trade.signal_tf || trade.chart_tf || "1h",
        live: true,
      }}
      metaItems={brokerItems}
    />
  );
}
