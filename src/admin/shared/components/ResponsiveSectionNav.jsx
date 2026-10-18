import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import useIsMobile from "../hooks/useIsMobile";
import MobileFullscreenModal from "./MobileFullscreenModal";
import "./ResponsiveSectionNav.css";

// Mobile: up to four sections share one row; larger sets use a full-screen menu.
// Callers can override mobile placement and persist it in their own settings.
export default function ResponsiveSectionNav({
  items = [], value, onChange, label = "Sections", menuLabel = "Menu",
  closeLabel = "Close", mobilePlacement = "menu", onMobilePlacementChange,
  placementLabel = "Mobile navigation", menuOptionLabel = "Automatic menu",
  bottomOptionLabel = "Bottom navigation",
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const trigger = useRef(null);
  const content = useRef(null);
  const menuId = useId();
  const close = useCallback(() => setOpen(false), []);
  const bottom = isMobile && mobilePlacement === "bottom";
  const inline = isMobile && !bottom && items.length <= 4;
  const active = items.find((item) => item.value === value);

  useEffect(() => { if (!isMobile) setOpen(false); }, [isMobile]);

  useEffect(() => {
    if (!open) return undefined;
    const panel = content.current?.closest(".mobile-fullscreen-modal__panel");
    const previousFocus = document.activeElement;
    (panel?.querySelector('[aria-current="page"]') || panel?.querySelector("button"))?.focus();
    const trapFocus = (event) => {
      if (event.key !== "Tab") return;
      const controls = [...panel.querySelectorAll("button:not(:disabled), select:not(:disabled), a[href]")];
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    };
    panel?.addEventListener("keydown", trapFocus);
    return () => {
      panel?.removeEventListener("keydown", trapFocus);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  const sections = (className) => <nav className={className} aria-label={label}>
    {items.map((item) => <button key={item.value} type="button"
      className={`secondary-button${value === item.value ? " active" : ""}`}
      aria-current={value === item.value ? "page" : undefined}
      onClick={() => { onChange?.(item.value); close(); }}>
      {item.label}
    </button>)}
  </nav>;

  return <div className="responsive-section-nav" data-mobile-placement={mobilePlacement}>
    {!isMobile && sections("responsive-section-nav__desktop")}
    {inline && <div className="responsive-section-nav__inline">
      {sections("responsive-section-nav__inline-items")}
      {onMobilePlacementChange && <button ref={trigger} type="button"
        className="secondary-button responsive-section-nav__settings" aria-label={placementLabel}
        title={placementLabel} aria-haspopup="dialog" aria-expanded={open}
        aria-controls={open ? menuId : undefined} onClick={() => setOpen(true)}>
        <span aria-hidden="true">⚙</span>
      </button>}
    </div>}
    {isMobile && !inline && <button ref={trigger} type="button" className="secondary-button responsive-section-nav__trigger"
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? menuId : undefined}
      onClick={() => setOpen(true)}>
      <span>{active?.label || label}</span><span aria-hidden="true">☰</span><span>{menuLabel}</span>
    </button>}
    {bottom && createPortal(<div className="responsive-section-nav__bottom">
      {sections("responsive-section-nav__bottom-items")}
    </div>, document.body)}
    {isMobile && open && createPortal(
      <MobileFullscreenModal open title={label} closeLabel={closeLabel} onClose={close}
        className="responsive-section-nav__modal">
        <div id={menuId} ref={content} className="responsive-section-nav__content">
          {sections("responsive-section-nav__tiles")}
          {onMobilePlacementChange && <label className="responsive-section-nav__placement">
            <span>{placementLabel}</span>
            <select value={mobilePlacement} onChange={(event) => onMobilePlacementChange(event.target.value)}>
              <option value="menu">{menuOptionLabel}</option>
              <option value="bottom">{bottomOptionLabel}</option>
            </select>
          </label>}
        </div>
      </MobileFullscreenModal>, document.body)}
  </div>;
}
