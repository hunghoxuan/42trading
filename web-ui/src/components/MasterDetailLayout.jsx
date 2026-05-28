import React from "react";

export default function MasterDetailLayout({
  sidebar,
  detail,
  children,
  sidebarWidth = 280,
  gap = 24,
  style = {},
  className = "",
}) {
  const width =
    typeof sidebarWidth === "number" ? `${sidebarWidth}px` : sidebarWidth;
  return (
    <div
      className={`master-detail-grid ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: `${width} 1fr`,
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
