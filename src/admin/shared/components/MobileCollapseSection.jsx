import { useEffect, useState } from "react";

import useIsMobile from "../hooks/useIsMobile.js";

export default function MobileCollapseSection({
  title,
  defaultOpenMobile = false,
  defaultOpenDesktop = true,
  className = "",
  bodyClassName = "",
  children,
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(() =>
    isMobile ? defaultOpenMobile : defaultOpenDesktop,
  );

  useEffect(() => {
    setOpen(isMobile ? defaultOpenMobile : defaultOpenDesktop);
  }, [isMobile, defaultOpenMobile, defaultOpenDesktop]);

  if (!isMobile) {
    return (
      <div className={className} style={{ display: "contents" }}>
        {children}
      </div>
    );
  }

  return (
    <section
      className={`mobile-collapse-section ${open ? "is-open" : "is-closed"} ${className}`}
    >
      <div className="mobile-collapse-head">
        <div className="mobile-collapse-title">{title}</div>
        <button
          type="button"
          className="secondary-button mobile-collapse-toggle"
          onClick={() => setOpen((prev) => !prev)}
          title={open ? "Collapse" : "Open"}
          aria-label={open ? "Collapse" : "Open"}
        >
          {open ? "↑" : "↓"}
        </button>
      </div>
      {open ? (
        <div className={`mobile-collapse-body ${bodyClassName}`}>{children}</div>
      ) : null}
    </section>
  );
}
