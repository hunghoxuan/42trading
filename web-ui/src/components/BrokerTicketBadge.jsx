import React from "react";
import Tooltip from "./Tooltip";

export function brokerDispatchColor(dispatchStatus, fallback = "var(--border)") {
  const d = String(dispatchStatus || "").trim().toUpperCase();
  if (["REJECTED", "ERROR", "FAIL", "FAILED"].includes(d)) return "#dc2626";
  if (["LEASED", "OPEN", "MODIFY", "CLOSE", "CANCEL"].includes(d)) return "#f59e0b";
  if (["CONSUMED", "OK", "SUCCESS", "FILLED", "CLOSED", "CANCELLED"].includes(d)) return "#16a34a";
  return fallback;
}

export function BrokerTicketBadge({
  brokerId,
  dispatchStatus = "",
  className = "badge badge-mini",
  style = {},
  fallbackColor = "var(--border)",
}) {
  const text = String(brokerId || "").trim();
  if (!text || text === "-") return null;
  return (
    <Tooltip content={text}>
      <span
        className={className}
        style={{
          padding: "2px 6px",
          fontSize: 9,
          fontWeight: 400,
          ...style,
          borderColor: brokerDispatchColor(dispatchStatus, fallbackColor),
          borderWidth: 1.5,
        }}
      >
        {text}
      </span>
    </Tooltip>
  );
}
