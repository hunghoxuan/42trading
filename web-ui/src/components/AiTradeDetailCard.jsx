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
      entry: trade?.entry,
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
    />
  );
}
