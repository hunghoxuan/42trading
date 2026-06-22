import React from "react";
import ResponsivePanel from "./ResponsivePanel";

export function MasterDetailSidebarPanel({
  label = "",
  actions = null,
  children,
  className = "",
  style = null,
}) {
  return (
    <ResponsivePanel
      title={label}
      headerActions={actions}
      showToggle={false}
      bodyClassName={["stack-layout", className].filter(Boolean).join(" ")}
      style={{ minWidth: 0, ...(style || {}) }}
    >
      {children}
    </ResponsivePanel>
  );
}

export function MasterDetailContentPanel({
  children,
  className = "",
  style = null,
}) {
  return (
    <ResponsivePanel
      showToggle={false}
      bodyClassName={["stack-layout", className].filter(Boolean).join(" ")}
      style={{ minWidth: 0, ...(style || {}) }}
    >
      {children}
    </ResponsivePanel>
  );
}
