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
  const bPips = bd(trade.broker_pips, "pips");
  const bProfit =
    bd(trade.broker_pnl, "pnl") ?? bd(trade.pnl_realized, "net_pnl");
  const bComm = bd(trade.broker_commission, "commission");
  const bSwap = bd(trade.broker_swap, "swap");
  const bMargin = bd(trade.broker_margin, "margin");
  const bLots = bd(trade.broker_lots, "lots");
  const bTpPnl = bd(trade.broker_tp_pnl, "tp_pnl") ?? asNum(broker.pnl_tp);
  const bSlPnl = bd(trade.broker_sl_pnl, "sl_pnl") ?? asNum(broker.pnl_sl);
  const brokerItems = [
    // Identity
    {
      label: "Broker Name",
      value:
        trade.account_broker_name ||
        trade.account_metadata?.broker_name ||
        trade.metadata?.broker_name ||
        "-",
      group: "identity",
    },
    {
      label: "Provider",
      value:
        trade.account_metadata?.provider_code ||
        trade.metadata?.provider_code ||
        "-",
      group: "identity",
    },
    { label: "Account", value: trade.account_id || "-", group: "identity" },
    {
      label: "Dispatch Status",
      value: trade.dispatch_status || "-",
      group: "identity",
    },
    {
      label: "Broker Ticket",
      value: trade.broker_trade_id || broker.ticket || "-",
      group: "identity",
    },
    {
      label: "Broker Status",
      value: trade.execution_status || broker.status || "-",
      group: "identity",
    },
    broker.last_sync_at
      ? {
          label: "Last Sync",
          value: new Date(broker.last_sync_at).toLocaleTimeString(),
          group: "identity",
        }
      : null,
    {
      label: "Created",
      value: trade.created_at
        ? new Date(trade.created_at).toLocaleString()
        : "-",
      group: "identity",
    },
    {
      label: "Updated",
      value: trade.updated_at
        ? new Date(trade.updated_at).toLocaleString()
        : "-",
      group: "identity",
    },
    {
      label: "Opened",
      value: trade.opened_at ? new Date(trade.opened_at).toLocaleString() : "-",
      group: "identity",
    },
    {
      label: "Closed",
      value: trade.closed_at ? new Date(trade.closed_at).toLocaleString() : "-",
      group: "identity",
    },
    // PnL
    {
      label: "Broker PnL",
      value:
        trade.pnl_realized != null
          ? `$${Number(trade.pnl_realized).toFixed(2)}`
          : "-",
      group: "pnl",
    },
    bProfit != null
      ? {
          label: "Broker Net Profit",
          value: `$${bProfit.toFixed(2)}`,
          group: "pnl",
        }
      : null,
    bTpPnl != null
      ? {
          label: "Planned TP Profit",
          value: `$${bTpPnl.toFixed(2)}`,
          group: "pnl",
        }
      : null,
    bSlPnl != null
      ? {
          label: "Planned SL Profit",
          value: `$${bSlPnl.toFixed(2)}`,
          group: "pnl",
        }
      : null,
    // Costs
    bMargin != null
      ? {
          label: "Broker Margin",
          value: `$${bMargin.toFixed(2)}`,
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
    bVol != null
      ? {
          label: "Vol",
          value: `${bVol.toLocaleString()} units`,
          group: "sizing",
        }
      : null,
    trade.volume != null
      ? {
          label: "Volume",
          value: `${Number(trade.volume).toLocaleString()}`,
          group: "sizing",
        }
      : null,
    bLots != null
      ? { label: "Lots", value: `${bLots.toFixed(2)} lots`, group: "sizing" }
      : null,
    bSwap != null
      ? { label: "Swap", value: `$${bSwap.toFixed(2)}`, group: "sizing" }
      : null,
    bComm != null
      ? { label: "Commission", value: `$${bComm.toFixed(2)}`, group: "sizing" }
      : null,
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
        broker_trade_id:
          trade.broker_trade_id || trade.ticket || trade.broker_id || "",
        execution_status: trade.execution_status || "",
        dispatch_status: trade.dispatch_status || "",
        rejection_reason: trade.rejection_reason || null,
        entry_price_exec: trade.entry_price_exec || null,
        value: detailPlan,
        onChange: (k, v) =>
          setDetailPlan((p) => applyLinkedPlanChange(p, k, v)),
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
