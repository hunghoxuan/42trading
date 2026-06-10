import React from "react";

export default function CronSectionCard({
  title,
  subtitle = "",
  children,
  className = "",
}) {
  return (
    <section className={`panel stack-layout ${className}`.trim()} style={{ gap: 12 }}>
      <div className="panel-label" style={{ marginBottom: 0 }}>
        {title}
        {subtitle ? (
          <span className="minor-text" style={{ marginLeft: 8, fontSize: 10 }}>
            {subtitle}
          </span>
        ) : null}
      </div>
      {children}
    </section>
  );
}
