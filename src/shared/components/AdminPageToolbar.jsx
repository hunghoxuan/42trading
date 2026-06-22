import React from "react";

export function AdminToolbarGroup({
  className = "",
  style = null,
  children,
}) {
  return (
    <div
      className={className}
      style={style || undefined}
      data-component="AdminToolbarGroup"
    >
      {children}
    </div>
  );
}

export default function AdminPageToolbar({
  pagination = null,
  filters = null,
  actions = null,
  className = "",
  style = null,
}) {
  return (
    <div
      className={["toolbar-panel", className].filter(Boolean).join(" ")}
      style={style || undefined}
      data-component="AdminPageToolbar"
    >
      {pagination}
      {filters}
      {actions}
    </div>
  );
}
