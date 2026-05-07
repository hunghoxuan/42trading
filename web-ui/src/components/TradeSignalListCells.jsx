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
  status = "PENDING",
}) {
  const sideUp = String(side || "-").toUpperCase();
  const sideCls = sideUp === "BUY" ? "side-buy" : "side-sell";
  const st = String(status || "PENDING").toUpperCase();
  const isFilled = st === "FILLED" || st === "OPEN";
  const statusCls = isFilled ? "status-solid" : "status-blur";
  const rrNum = num(rr);

  return (
    <div className="cell-wrap">
      <div className="cell-major" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span className={`side-badge ${sideCls} ${statusCls}`}>{sideUp[0] || "-"}</span>
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

export function PositionAuditCell({
  source = "-",
  strategy = "-",
  timeText = "-",
  sid = "-",
  brokerId = "-",
  confidence = null,
  riskManagement = null,
}) {
  const sourceStrategy = [source, strategy].filter((x) => x && x !== "-").join(" | ");
  const confidenceText = confidence != null ? `${confidence}%` : null;
  const riskText = riskManagement != null ? `Risk: ${riskManagement}` : null;
  const metaLine = [sid, brokerId && brokerId !== "-" ? brokerId : null, confidenceText, riskText]
    .filter(Boolean)
    .join(" | ");

  return (
    <div className="cell-wrap">
      <div className="cell-major">
        {sourceStrategy || "-"}{" "}
        {timeText !== "-" && (
          <span className="minor-text" style={{ fontSize: 11, opacity: 0.8, marginLeft: 4 }}>
            {timeText}
          </span>
        )}
      </div>
      <div className="cell-minor" style={{ opacity: 0.7 }}>
        {metaLine}
      </div>
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
  hideStatus = false,
  tpPnl = null,
  slPnl = null,
  status = "",
  hidePnl = false,
}) {
  const pnlNum = num(pnl);
  const st = String(status || "").toUpperCase();
  const shouldShowMetrics = st === "FILLED" || st === "CLOSED" || st === "OPEN" || st === "PARTIAL";
  
  return (
    <div className="cell-wrap" style={{ alignItems: 'flex-end' }}>
      <div className="cell-major" style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', fontWeight: 400 }}>
        {!hideStatus && statusNode}
        {shouldShowMetrics && !hidePnl && (
          <>
            {brokerPips != null && (
              <div className="minor-text" style={{ fontSize: '10px', opacity: 0.5, fontWeight: 400 }}>
                {Math.round(num(brokerPips))} pips
              </div>
            )}
            {pnlNum != null && (
              <div 
                className={`${pnlNum < 0 ? "money-neg" : "money-pos"}`} 
                style={{ fontSize: '12px', fontWeight: 400, opacity: 0.75 }}
              >
                ${Math.abs(pnlNum).toFixed(2)}
              </div>
            )}
          </>
        )}
      </div>
      {showFilledDetails && !hidePnl ? (
        <div className="cell-minor" style={{ fontSize: '10px', opacity: 0.5, marginTop: 2, textAlign: 'right' }}>
          {tpPnl != null ? <span className="money-pos" style={{ opacity: 0.7 }}>+${num(tpPnl).toFixed(1)}</span> : "-"} 
          {" "}/{" "}
          {slPnl != null ? <span className="money-neg" style={{ opacity: 0.7 }}>-${Math.abs(num(slPnl)).toFixed(1)}</span> : "-"}
        </div>
      ) : null}
    </div>
  );
}

