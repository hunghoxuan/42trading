import { useState, useEffect, useCallback } from "react";

const MOBILE_BREAKPOINT = 768;

export default function AppShell({ topbar, children }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.innerWidth < MOBILE_BREAKPOINT,
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const close = useCallback(() => setMobileOpen(false), []);

  return (
    <div className="app-shell">
      {/* Desktop: sticky topbar. Mobile: hamburger toggle */}
      <header className="topbar">
        {isMobile && (
          <button
            className="mobile-nav-toggle icon-button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        )}
        {!isMobile && topbar}
      </header>

      {/* Mobile slide-out drawer */}
      {isMobile && mobileOpen && (
        <>
          <div className="mobile-nav-backdrop" onClick={close} />
          <nav className="mobile-nav-drawer" onClick={close}>
            {topbar}
          </nav>
        </>
      )}

      <main className="page-wrap">{children}</main>
    </div>
  );
}
