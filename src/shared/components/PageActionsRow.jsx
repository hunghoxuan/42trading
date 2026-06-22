import React from "react";

export default function PageActionsRow({
  children,
  className = "",
  style = null,
}) {
  return (
    <div
      className={className}
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        alignItems: "center",
        ...(style || {}),
      }}
      data-component="PageActionsRow"
    >
      {children}
    </div>
  );
}
