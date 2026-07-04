import React from "react";

export default function SidebarListItem({
  active = false,
  enabled = false,
  title,
  subtitle = null,
  rightSlot = null,
  onClick,
  children,
  style = {},
  className = "",
}) {
  return (
    <button
      type="button"
      className={`sidebar-item-v2 ${active ? "active" : ""} ${className}`.trim()}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: rightSlot ? "space-between" : "flex-start",
        gap: 6,
        textAlign: "left",
        ...style,
      }}
    >
      {children || (
        <>
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: enabled ? "#22c55e" : "#666",
              flexShrink: 0,
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontWeight: 700, fontSize: 12 }}>{title}</span>
            {subtitle !== null ? (
              <span className="minor-text" style={{ fontSize: 9 }}>
                {subtitle}
              </span>
            ) : null}
          </div>
          {rightSlot}
        </>
      )}
    </button>
  );
}
