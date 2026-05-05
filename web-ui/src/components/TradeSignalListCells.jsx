import React from "react";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatTf(min) {
  if (!min || min === "manual") return min || "-";
  const n = Number(min);
  if (Number.isNaN(n) || n <= 0) return String(min);
  if (n < 60) return `${n}m`;
  if (n < 1440) return `${n / 60}h`;
  if (n < 10080) return `${n / 1440}d`;
  if (n < 43200) return `${n / 10080}W`;
  if (n === 43200) return "1M";
  return `${n / 43200}M`;
}

export function SymbolEntryCell({
  side = "-",
  symbol = "-",
  orderType = "limit",
  entry = "-",
  tp = "-",
  sl = "-",
  rr = null,
}) {
  const sideUp = String(side || "-").toUpperCase();
  const sideCls = sideUp === "BUY" ? "side-buy" : "side-sell";
  const rrNum = num(rr);
  return (
    <div className="cell-wrap">
      <div className="cell-major" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className={`side-badge ${sideCls}`}>{sideUp[0] || "-"}</span>
        <span style={{ fontWeight: 800 }}>{symbol}</span>
        <span className="minor-text" style={{ fontSize: 11, textTransform: "lowercase", opacity: 0.8 }}>{orderType || "limit"}</span>
      </div>
      <div className="cell-minor">
        {entry} → <span style={{ color: "var(--accent)" }}>{tp}</span> / {sl}{" "}
        {rrNum != null ? `${rrNum.toFixed(1)}r` : "-"}
      </div>
    </div>
  );
}

export function StrategyTfCell({ strategy = "-", entryModel = "-", tf = "-" }) {
  return (
    <div className="cell-wrap">
      <div className="cell-major">{strategy} | {entryModel}</div>
      <div className="cell-minor">{formatTf(tf)}</div>
    </div>
  );
}

export function AuditCell({ timeText = "-", sid = "-", brokerTradeId = "-" }) {
  return (
    <div className="cell-wrap">
      <div className="cell-major">{timeText}</div>
      <div className="cell-minor">- | {sid} | {brokerTradeId}</div>
    </div>
  );
}

export function StatusPnlCell({
  statusNode = null,
  pnl = null,
  showFilledDetails = false,
  brokerVolume = null,
  brokerLots = null,
  brokerPips = null,
}) {
  const pnlNum = num(pnl);
  return (
    <div className="cell-wrap">
      <div className="cell-major">{statusNode}</div>
      {showFilledDetails ? (
        <div className="cell-minor">
          {brokerVolume ?? "-"} | {brokerLots ?? "-"} lots | {brokerPips ?? "-"} pips
        </div>
      ) : null}
      {pnlNum != null && pnlNum !== 0 ? (
        <div className={`cell-minor ${pnlNum < 0 ? "money-neg" : "money-pos"}`}>${pnlNum.toFixed(2)}</div>
      ) : null}
    </div>
  );
}

