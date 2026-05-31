import React from "react";
import Tooltip from "./Tooltip";

export function statusColor(status) {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  // Light gray: new / draft
  if (["NEW", "DRAFT", "PLANNED"].includes(s)) return "var(--muted)";
  // Yellow: pending / consumed
  if (["PENDING", "CONSUMED"].includes(s)) return "#f59e0b";
  // Cyan/teal: filled / active / leased / open / modify
  if (
    ["FILLED", "ACTIVE", "OPEN", "LEASED", "MODIFY", "IN_PROGRESS"].includes(s)
  )
    return "var(--accent)";
  // Dark red: error / fail / rejected
  if (["ERROR", "FAIL", "FAILED", "REJECTED"].includes(s)) return "#dc2626";
  // Dark gray: closed / cancelled / archived
  if (["CLOSED", "CANCELLED", "CANCEL", "ARCHIVED", "EXPIRED"].includes(s))
    return "#64748b";
  return "var(--border)";
}

export function StatusBadge({
  id,
  status,
  className = "badge badge-mini",
  style = {},
}) {
  const text = String(id || "").trim();
  const s = String(status || "")
    .trim()
    .toUpperCase();
  if (!text || text === "-") return null;
  const color = statusColor(s);
  return (
    <Tooltip content={`${text} (${s || "unknown"})`}>
      <span
        className={className}
        style={{
          padding: "2px 6px",
          fontSize: 9,
          fontWeight: 500,
          border: "1px solid",
          borderColor: color,
          color,
          borderRadius: 4,
          ...style,
        }}
      >
        {text}
      </span>
    </Tooltip>
  );
}

// Legacy alias
export function brokerDispatchColor(
  dispatchStatus,
  fallback = "var(--border)",
) {
  return statusColor(dispatchStatus) === "var(--border)"
    ? fallback
    : statusColor(dispatchStatus);
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
