import React from "react";
export function buildDetailHeader({
  side = "-",
  symbol = "-",
  sideClass = "",
  positionText = "-",
  showPnl = false,
  pnlText = "-",
  pnlClassName = "minor-text",
  dateText = "-",
  statsText = "-",
  statusNode = null,
  columns = "minmax(0, 1fr) minmax(0, 1.25fr) minmax(120px, 0.55fr)",
}) {
  return {
    columns,
    left: (
      <>
        <span className={sideClass}>{side}</span> {symbol}
      </>
    ),
    center: <>{positionText}</>,
    rightTop: showPnl ? <span className={pnlClassName} style={{ fontWeight: 800 }}>{pnlText}</span> : <span className="minor-text">-</span>,
    leftMinor: dateText,
    centerMinor: statsText,
    rightBottom: statusNode,
  };
}

