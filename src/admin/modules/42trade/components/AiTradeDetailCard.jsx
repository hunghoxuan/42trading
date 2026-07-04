import TradeDetailCard from "./TradeDetailCard";
import { applyLinkedPlanChange } from "../../../shared/utils/tradeDetailUtils";
import { formatDateTimeWithDuration, showDateTime } from "../../../shared/utils/format";
import {
  resolveDisplayedPlannedPnl,
} from "../../../shared/utils/tradePlannedPnl";

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

function formatClosedWithDuration(openedAt, closedAt) {
  return formatDateTimeWithDuration(closedAt, openedAt);
}

function formatOpenedWithDuration(createdAt, openedAt) {
  return formatDateTimeWithDuration(openedAt, createdAt);
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
  const bTpPnl = resolveDisplayedPlannedPnl(trade, "tp");
  const bSlPnl = resolveDisplayedPlannedPnl(trade, "sl");
  const plan = detailPlan || {};
  const brokerItems = [
    {
      label: "Entry",
      value: trade.entry_price_exec || trade.entry || "-",
      group: "identity",
    },
    { label: "TP", value: plan.tp || trade.tp || "-", group: "identity" },
    { label: "SL", value: plan.sl || trade.sl || "-", group: "identity" },
    {
      label: "RR",
      value: plan.rr || trade.rr_planned || "-",
      group: "pnl",
    },
    {
      label: "Planned TP / SL",
      value:
        bTpPnl != null || bSlPnl != null
          ? `${bTpPnl != null ? `$${bTpPnl.toFixed(2)}` : "-"} / ${bSlPnl != null ? `$${bSlPnl.toFixed(2)}` : "-"}`
          : "-",
      renderValue:
        bTpPnl != null || bSlPnl != null ? (
          <span>
            <span style={{ color: "#22c55e" }}>
              {bTpPnl != null ? `$${bTpPnl.toFixed(2)}` : "-"}
            </span>
            {" / "}
            <span style={{ color: "#ef4444" }}>
              {bSlPnl != null ? `$${bSlPnl.toFixed(2)}` : "-"}
            </span>
          </span>
        ) : null,
      group: "pnl",
    },
    { label: "__spacer_first_row__", value: "", spacer: true },
    {
      label: "Created",
      value: showDateTime(trade.created_at),
      group: "identity",
    },
    {
      label: "Opened",
      value: formatOpenedWithDuration(trade.created_at, trade.opened_at),
      group: "identity",
    },
    {
      label: "Closed",
      value: formatClosedWithDuration(trade.opened_at, trade.closed_at),
      group: "identity",
    },
    {
      label: "Exit Price",
      value:
        trade.exit_price != null && Number.isFinite(Number(trade.exit_price))
          ? String(Number(trade.exit_price))
          : "-",
      group: "identity",
    },
    {
      label: "Broker PnL",
      value:
        trade.pnl_realized != null
          ? `$${Number(trade.pnl_realized).toFixed(2)}`
          : bProfit != null
            ? `$${bProfit.toFixed(2)}`
          : "-",
      group: "identity",
    },
    { label: "__spacer__", value: "", spacer: true },
    {
      label: "Broker Ticket",
      value: trade.broker_trade_id || broker.ticket || "-",
      group: "identity",
    },
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
      label: "Broker Status",
      value: trade.execution_status || broker.status || "-",
      group: "identity",
    },
    {
      label: "Dispatch",
      value: trade.dispatch_status || "-",
      group: "identity",
    },
    {
      label: "Last Sync",
      value: showDateTime(trade.updated_at || broker.last_sync_at),
      group: "identity",
    },
    { label: "Account", value: trade.account_id || "-", group: "identity" },
    {
      label: "Provider",
      value:
        trade.account_metadata?.provider_code ||
        trade.metadata?.provider_code ||
        "-",
      group: "identity",
    },
    {
      label: "Margin",
      value: bMargin != null ? `$${bMargin.toFixed(2)}` : "-",
      group: "sizing",
    },
    {
      label: "Vol",
      value: bVol != null ? `${bVol.toLocaleString()} units` : "-",
      group: "sizing",
    },
    {
      label: "Lots",
      value: bLots != null ? `${bLots.toFixed(2)} lots` : "-",
      group: "sizing",
    },
    {
      label: "Commission",
      value: bComm != null ? `$${bComm.toFixed(2)}` : "-",
      group: "sizing",
    },
    {
      label: "Swap",
      value: bSwap != null ? `$${bSwap.toFixed(2)}` : "-",
      group: "sizing",
    },
    bProfit != null
      ? {
          label: "Broker Net Profit",
          value: `$${bProfit.toFixed(2)}`,
          group: "pnl",
        }
      : null,
    trade.margin != null
      ? {
          label: "Margin",
          value: `$${Number(trade.margin).toFixed(2)}`,
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
  ].filter(Boolean);
  return (
    <TradeDetailCard
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
        mode: "cache",
        enableChartObjects: true,
        showObjectInspector: true,
        interval: trade.trade_tf || trade.signal_tf || trade.chart_tf || "1h",
        live: true,
      }}
      metaItems={brokerItems}
    />
  );
}
