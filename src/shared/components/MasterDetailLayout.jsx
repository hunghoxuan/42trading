import React from "react";

export default function MasterDetailLayout({
  sidebar,
  detail,
  children,
  sidebarWidth = 280,
  sidebarCollapsed = false,
  collapsedSidebarWidth = 0,
  gap = 24,
  style = {},
  className = "",
}) {
  const width =
    typeof sidebarWidth === "number" ? `${sidebarWidth}px` : sidebarWidth;
  const collapsedWidth =
    typeof collapsedSidebarWidth === "number"
      ? `${collapsedSidebarWidth}px`
      : collapsedSidebarWidth;
  return (
    <div
      className={`master-detail-grid ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: sidebarCollapsed
          ? `${collapsedWidth} 1fr`
          : `minmax(200px, ${width}) 1fr`,
        gap,
        marginTop: 12,
        ...style,
      }}
    >
      {children || (
        <>
          {sidebar}
          {detail}
        </>
      )}
    </div>
  );
}
