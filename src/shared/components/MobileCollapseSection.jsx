import { useEffect, useState } from "react";

const MOBILE_BREAKPOINT = 768;

function getIsMobile() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export default function MobileCollapseSection({
  title,
  defaultOpenMobile = false,
  defaultOpenDesktop = true,
  className = "",
  bodyClassName = "",
  children,
}) {
  const [isMobile, setIsMobile] = useState(getIsMobile);
  const [open, setOpen] = useState(() =>
    getIsMobile() ? defaultOpenMobile : defaultOpenDesktop,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (event) => setIsMobile(event.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

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
