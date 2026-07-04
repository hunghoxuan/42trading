import React from "react";
import ResponsivePanel from "../../../shared/components/ResponsivePanel";

export default function CronSectionCard({
  title,
  subtitle = "",
  children,
  className = "",
}) {
  return (
    <ResponsivePanel
      title={title}
      subtitle={subtitle}
      className={className}
      bodyClassName="stack-layout"
      collapseDirection="top-down"
      style={{ width: "100%" }}
    >
      {children}
    </ResponsivePanel>
  );
}
