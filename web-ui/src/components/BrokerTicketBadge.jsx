import React from "react";
import Tooltip from "./Tooltip";

function brokerDispatchToken(dispatchStatus = "") {
  const d = String(dispatchStatus || "").trim().toUpperCase();
  if (["REJECTED", "ERROR", "FAIL", "FAILED"].includes(d)) return "SL";
  if (["LEASED", "OPEN", "MODIFY", "CLOSE", "CANCEL"].includes(d)) return "PENDING";
  if (["CONSUMED", "OK", "SUCCESS", "FILLED", "CLOSED", "CANCELLED"].includes(d)) return "ACTIVE";
  return "NEUTRAL";
}

export function BrokerTicketBadge({
  brokerId,
  dispatchStatus = "",
  className = "badge badge-mini",
  style = {},
  tooltipSide = "right",
}) {
  const text = String(brokerId || "").trim();
  if (!text || text === "-") return null;
  return (
    <Tooltip content={text} side={tooltipSide}>
      <span className={`${className} ${brokerDispatchToken(dispatchStatus)}`} style={style}>
        {text}
      </span>
    </Tooltip>
  );
}
