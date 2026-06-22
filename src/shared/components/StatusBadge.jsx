import React from "react";
import Tooltip from "./Tooltip";

export function statusBadgeToken(status) {
  const s = String(status || "")
    .trim()
    .toUpperCase();
  if (
    [
      "ERROR",
      "FAIL",
      "FAILED",
      "REJECTED",
      "LOSE",
      "NEGATIVE",
      "SL",
    ].includes(s)
  ) {
    return "danger";
  }
  if (
    [
      "WARN",
      "WARNING",
      "INFO",
      "PENDING",
      "PROGRESS",
      "PLACED",
      "LOCKED",
      "CAUTION",
      "CHECK",
      "REVIEW",
      "IDLE",
    ].includes(s)
  ) {
    return "warning";
  }
  if (
    [
      "OK",
      "ACTIVE",
      "DONE",
      "ENABLED",
      "SUCCESS",
      "SUCCESSFUL",
      "FINISHED",
      "WIN",
      "POSITIVE",
      "LIVE",
      "START",
      "OPEN",
      "FILLED",
      "READY",
      "ONLINE",
    ].includes(s)
  ) {
    return "success";
  }
  if (
    [
      "INACTIVE",
      "DISABLE",
      "DISABLED",
      "FALSE",
      "OFFLINE",
      "CANCELLED",
      "CANCEL",
      "NEUTRAL",
      "NEW",
      "DRAFT",
      "PLANNED",
      "EXPIRED",
      "UNKNOWN",
    ].includes(s)
  ) {
    return "neutral";
  }
  return "neutral";
}

export function StatusDisplay({
  status,
  label = null,
  className = "",
  style = {},
  title,
  tooltipContent = null,
  tooltipSide = "right",
  size = "mini",
}) {
  const tone = statusBadgeToken(status);
  const text = label == null ? "" : String(label).trim();
  const content = (
    <span
      className={[
        "status-display",
        text ? "status-display--badge" : "status-display--dot-only",
        `status-display--${size === "md" ? "md" : "mini"}`,
        `status-display--${tone}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={style}
      title={title}
    >
      <span className="status-display__dot" />
      {text ? <span className="status-display__label">{text}</span> : null}
    </span>
  );

  if (!tooltipContent) return content;
  return (
    <Tooltip content={tooltipContent} side={tooltipSide}>
      {content}
    </Tooltip>
  );
}

export function StatusBadge({
  id,
  status,
  className = "",
  style = {},
  tooltipSide = "right",
}) {
  const text = String(id || "").trim();
  if (!text || text === "-") return null;
  return (
    <StatusDisplay
      status={status}
      label={text}
      className={className}
      style={style}
      tooltipSide={tooltipSide}
      tooltipContent={`${text} (${String(status || "unknown").toUpperCase()})`}
    />
  );
}

export function BrokerTicketBadge(props) {
  return (
    <StatusBadge
      id={props.brokerId}
      status={props.dispatchStatus}
      className={props.className}
      style={props.style}
      tooltipSide={props.tooltipSide}
    />
  );
}
