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
  const isError = ["REJECTED", "CANCELLED", "ERROR", "FAIL"].includes(st);
  const isPending = ["PENDING", "NEW", "PLACED", "LOCKED"].includes(st);
  const isFilled = st === "FILLED" || st === "OPEN" || st === "START";
  const statusCls = isError
    ? "status-error"
    : isPending
      ? "status-blur status-pending"
      : isFilled
        ? "status-solid"
        : "status-blur";
  const rrNum = num(rr);

  return (
    <div className="cell-wrap">
      <div
        className="cell-major"
        style={{ display: "flex", alignItems: "center", gap: 8 }}
      >
        <span className={`side-badge ${sideCls} ${statusCls}`}>
          {sideUp[0] || "-"}
        </span>
        <span style={{ fontWeight: 800 }}>{symbol}</span>
        <span
          className="minor-text"
          style={{ fontSize: 11, textTransform: "lowercase", opacity: 0.8 }}
        >
          {orderType || "limit"}
        </span>
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
  riskPct = null,
}) {
  const sourceStrategy = [source, strategy]
    .filter((x) => x && x !== "-")
    .join(" | ");
  const confidenceText = confidence != null ? `${confidence}%` : null;
  const riskText = riskManagement != null ? `Risk: ${riskManagement}` : null;
  const metaLine = [
    sid,
    brokerId && brokerId !== "-" ? brokerId : null,
    riskPct != null ? `${(Number(riskPct) * 100).toFixed(2)}%` : null,
    confidenceText,
    riskText,
  ]
    .filter(Boolean)
    .join(" | ");

  return (
    <div className="cell-wrap">
      <div className="cell-major">
        {sourceStrategy || "-"}{" "}
        {timeText !== "-" && (
          <span
            className="minor-text"
            style={{ fontSize: 11, opacity: 0.8, marginLeft: 4 }}
          >
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
  margin = null,
  status = "",
  hidePnl = false,
  flashFields = null, // Set of field names to flash (e.g. "broker_pnl", "broker_pips")
}) {
  const pnlNum = num(pnl);
  const st = String(status || "").toUpperCase();
  const isError = ["REJECTED", "CANCELLED", "ERROR", "FAIL"].includes(st);
  const isPending = ["PENDING", "PLACED", "NEW"].includes(st);
  const isFinished = ["CLOSED", "TP", "SL", "CANCEL"].includes(st);
  const isActive = ["OPEN", "FILLED", "PARTIAL", "START"].includes(st);

  // Error states: show status text, hide metrics
  if (isError) {
    return (
      <div className="cell-wrap" style={{ alignItems: "flex-end" }}>
        <div className="cell-major" style={{ justifyContent: "flex-end" }}>
          <span
            className="badge"
            style={{
              background: "rgba(156,163,175,0.15)",
              color: "#9ca3af",
              fontSize: 11,
            }}
          >
            {st}
          </span>
        </div>
      </div>
    );
  }

  const shouldShowLiveMetrics = (isActive || isFinished) && !hidePnl;
  const shouldShowProjectedMetrics = isPending && !hidePnl;
  const flashed = (field) =>
    flashFields instanceof Set && flashFields.has(field) ? " value-flash" : "";

  return (
    <div className="cell-wrap" style={{ alignItems: "flex-end" }}>
      <div
        className="cell-major"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          justifyContent: "flex-end",
          fontWeight: 400,
        }}
      >
        {!hideStatus && statusNode}
        {shouldShowLiveMetrics && (
          <>
            {brokerPips != null && (
              <div
                className={"minor-text" + flashed("broker_pips")}
                style={{ fontSize: "10px", opacity: 0.5, fontWeight: 400 }}
              >
                {Math.round(num(brokerPips))} pips
              </div>
            )}
            {pnlNum != null && (
              <div
                className={`${pnlNum < 0 ? "money-neg" : "money-pos"}${flashed("broker_pnl")}${flashed("pnl_realized")}`}
                style={{ fontSize: "12px", fontWeight: 400, opacity: 0.75 }}
              >
                ${Math.abs(pnlNum).toFixed(2)}
              </div>
            )}
          </>
        )}
        {shouldShowProjectedMetrics && margin != null && margin > 0 && (
          <div
            className="minor-text"
            style={{ fontSize: "10px", opacity: 0.5 }}
          >
            Risk: ${num(margin).toFixed(2)}
          </div>
        )}
      </div>
      {isFinished ? (
        <div
          className="cell-minor"
          style={{
            fontSize: "10px",
            opacity: 0.5,
            marginTop: 2,
            textAlign: "right",
          }}
        >
          {num(tpPnl) != null && num(slPnl) != null ? (
            <span>
              {tpPnl} → {slPnl} |{" "}
              <span
                className={num(pnl) < 0 ? "money-neg" : "money-pos"}
                style={{ fontWeight: 700 }}
              >
                {num(pnl) != null ? (pnl > 0 ? "+" : "") : ""}
                {num(pnl) != null && num(margin)
                  ? (pnl / Math.abs(margin)).toFixed(1)
                  : "0.0"}
                r
              </span>
            </span>
          ) : (
            "-"
          )}
        </div>
      ) : (showFilledDetails || isPending) && !hidePnl ? (
        <div
          className="cell-minor"
          style={{
            fontSize: "10px",
            opacity: 0.5,
            marginTop: 2,
            textAlign: "right",
          }}
        >
          {tpPnl != null && num(tpPnl) !== 0 ? (
            <span className="money-pos" style={{ opacity: 0.7 }}>
              +${num(tpPnl).toFixed(1)}
            </span>
          ) : (
            "-"
          )}{" "}
          /{" "}
          {slPnl != null && num(slPnl) !== 0 ? (
            <span className="money-neg" style={{ opacity: 0.7 }}>
              -${Math.abs(num(slPnl)).toFixed(1)}
            </span>
          ) : (
            "-"
          )}
        </div>
      ) : null}
    </div>
  );
}
