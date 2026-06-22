function asNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function meaningful(value) {
  return Number.isFinite(value) && Math.abs(value) > 0.000001;
}

function findSymbolMetric(trade) {
  const symbol = String(trade?.symbol || "")
    .trim()
    .toUpperCase();
  if (!symbol) return null;
  const metrics = Array.isArray(trade?.account_metadata?.symbol_metrics)
    ? trade.account_metadata.symbol_metrics
    : Array.isArray(trade?.metadata?.symbol_metrics)
      ? trade.metadata.symbol_metrics
      : [];
  return (
    metrics.find(
      (metric) =>
        String(metric?.symbol || "")
          .trim()
          .toUpperCase() === symbol,
    ) || null
  );
}

export function computePlannedPnlFromTrade(trade) {
  const entry = asNum(trade?.entry);
  const sl = asNum(trade?.sl);
  const tp = asNum(trade?.tp1 ?? trade?.tp);
  const volume = asNum(trade?.volume);
  const side = String(trade?.action || trade?.side || "")
    .trim()
    .toUpperCase();
  const metric = findSymbolMetric(trade);
  const pipSize = asNum(metric?.pip_size);
  const pipValue = asNum(metric?.pip_value);
  if (
    !Number.isFinite(entry) ||
    !Number.isFinite(volume) ||
    volume <= 0 ||
    !["BUY", "SELL"].includes(side) ||
    !Number.isFinite(pipSize) ||
    pipSize <= 0 ||
    !Number.isFinite(pipValue) ||
    pipValue <= 0
  ) {
    return { tpPnl: null, slPnl: null };
  }

  const calc = (target) => {
    if (!Number.isFinite(target)) return null;
    let pips = (target - entry) / pipSize;
    if (side === "SELL") pips = -pips;
    return Number((pips * pipValue * volume).toFixed(2));
  };

  return {
    tpPnl: calc(tp),
    slPnl: calc(sl),
  };
}

export function resolveDisplayedPlannedPnl(trade, kind) {
  const brokerData = trade?.metadata?.broker_data || {};
  const brokerValue =
    kind === "tp"
      ? asNum(trade?.broker_tp_pnl) ?? asNum(brokerData.tp_pnl ?? brokerData.pnl_tp)
      : asNum(trade?.broker_sl_pnl) ?? asNum(brokerData.sl_pnl ?? brokerData.pnl_sl);
  if (meaningful(brokerValue)) return brokerValue;

  const storedValue =
    kind === "tp"
      ? asNum(trade?.planned_tp_pnl) ?? asNum(trade?.metadata?.planned_tp_pnl)
      : asNum(trade?.planned_sl_pnl) ?? asNum(trade?.metadata?.planned_sl_pnl);
  if (meaningful(storedValue)) return storedValue;

  const computed = computePlannedPnlFromTrade(trade);
  const computedValue = kind === "tp" ? computed.tpPnl : computed.slPnl;
  if (meaningful(computedValue)) return computedValue;

  if (Number.isFinite(storedValue)) return storedValue;
  if (Number.isFinite(brokerValue)) return brokerValue;
  return computedValue;
}

export function plannedPnlValueStyle(kind) {
  return {
    color: kind === "tp" ? "#22c55e" : "#ef4444",
    fontWeight: 700,
  };
}
