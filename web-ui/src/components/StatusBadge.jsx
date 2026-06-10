import React from "react";
import Tooltip from "./Tooltip";

export function statusBadgeToken(status) {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  if (["ERROR", "FAIL", "FAILED", "REJECTED", "LOSE", "NEGATIVE"].includes(s)) {
    return "SL";
  }
  if (["PENDING", "CONSUMED", "WARN", "WARNING", "INFO", "START", "PROGRESS"].includes(s)) {
    return "PENDING";
  }
  if (["FILLED", "OPEN"].includes(s)) return "FILLED";
  if (["ACTIVE", "OK", "SUCCESS", "DONE", "WIN", "POSITIVE"].includes(s)) {
    return "ACTIVE";
  }
  if (["INACTIVE", "DISABLED", "DISABLE", "CANCELLED", "CANCEL", "OFFLINE", "NEW", "DRAFT", "PLANNED", "EXPIRED"].includes(s)) {
    return "INACTIVE";
  }
  return "NEUTRAL";
}

export function StatusBadge({
  id,
  status,
  className = "badge badge-mini",
  style = {},
  tooltipSide = "right",
}) {
  const text = String(id || "").trim();
  if (!text || text === "-") return null;
  const token = statusBadgeToken(status);
  return (
    <Tooltip
      content={`${text} (${String(status || "unknown").toUpperCase()})`}
      side={tooltipSide}
    >
      <span className={`${className} ${token}`} style={style}>
        {text}
      </span>
    </Tooltip>
  );
}

export function BrokerTicketBadge(props) {
  return (
    <StatusBadge
      id={props.brokerId}
      status={props.dispatchStatus}
      className={props.className}
      style={props.style}
    />
  );
}
