import { useState, useEffect, useCallback } from "react";
import useIsMobile from "../hooks/useIsMobile.js";

function setGlobalBackgroundGlow(clientX, clientY) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--app-pointer-x", `${clientX}px`);
  document.documentElement.style.setProperty("--app-pointer-y", `${clientY}px`);
}

export default function AppShell({
  topbar,
  mobileTopbar,
  mobileDrawer,
  mobileBottomBar,
  children,
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const useMobileBottomBar = Boolean(isMobile && mobileBottomBar);

  useEffect(() => {
    const onClose = () => setMobileOpen(false);
    window.addEventListener("mobile-nav-close", onClose);
    return () => window.removeEventListener("mobile-nav-close", onClose);
  }, []);

  const close = useCallback(() => setMobileOpen(false), []);
  const handlePointerEnter = useCallback((event) => {
    setGlobalBackgroundGlow(event.clientX, event.clientY);
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--app-light-opacity", "1");
    }
  }, []);
  const handlePointerMove = useCallback((event) => {
    setGlobalBackgroundGlow(event.clientX, event.clientY);
  }, []);
  const handlePointerLeave = useCallback(() => {
    if (typeof document !== "undefined") {
      document.documentElement.style.setProperty("--app-light-opacity", "0");
    }
  }, []);
  const handleTopbarClickCapture = useCallback(
    (event) => {
      if (!isMobile || !useMobileBottomBar) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const brandLink = target.closest(".site-navigation__brand-link");
      if (!brandLink) return;
      event.preventDefault();
      event.stopPropagation();
      setMobileOpen(true);
    },
    [isMobile, useMobileBottomBar],
  );

  return (
    <div
      className={`app-shell${useMobileBottomBar ? " app-shell--mobile-bottom-bar" : ""}`}
      onPointerEnter={handlePointerEnter}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* Desktop: sticky topbar. Mobile: hamburger toggle */}
      <header className="topbar" onClickCapture={handleTopbarClickCapture}>
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
      {isMobile && mobileOpen && (
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
