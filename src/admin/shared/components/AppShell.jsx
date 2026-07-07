import { useState, useEffect, useCallback } from "react";

const MOBILE_BREAKPOINT = 768;

export default function AppShell({
  topbar,
  mobileTopbar,
  mobileDrawer,
  mobileBottomBar,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => window.innerWidth < MOBILE_BREAKPOINT,
  );
  const useMobileBottomBar = Boolean(isMobile && mobileBottomBar);

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = (e) => setIsMobile(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const onClose = () => setMobileOpen(false);
    window.addEventListener("mobile-nav-close", onClose);
    return () => window.removeEventListener("mobile-nav-close", onClose);
  }, []);

  const close = useCallback(() => setMobileOpen(false), []);

  return (
    <div
      className={`app-shell${useMobileBottomBar ? " app-shell--mobile-bottom-bar" : ""}`}
    >
      {/* Desktop: sticky topbar. Mobile: hamburger toggle */}
      <header className="topbar">
        {isMobile && !useMobileBottomBar && (
          <>
            <button
              className="mobile-nav-toggle icon-button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Toggle navigation"
            >
              {mobileOpen ? "✕" : "☰"}
            </button>
            <div className="mobile-topbar-inline">
              {mobileTopbar || topbar}
            </div>
          </>
        )}
        {(!isMobile || useMobileBottomBar) && topbar}
      </header>

      {/* Mobile slide-out drawer */}
      {isMobile && !useMobileBottomBar && mobileOpen && (
        <>
          <div className="mobile-nav-backdrop" onClick={close} />
          <nav className="mobile-nav-drawer">
            {mobileDrawer || topbar}
          </nav>
        </>
      )}

      <main className="page-wrap">{children}</main>
      {useMobileBottomBar ? (
        <nav className="mobile-bottom-bar">{mobileBottomBar}</nav>
      ) : null}
    </div>
  );
}
