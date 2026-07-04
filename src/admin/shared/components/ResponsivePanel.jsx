import { useEffect, useMemo, useState } from "react";
import "./ResponsivePanel.css";
import {
  RESPONSIVE_PANEL_MOBILE_BREAKPOINT,
  normalizeResponsivePanelWidth,
  resolveResponsivePanelBorderClass,
  resolveResponsivePanelMotionClass,
} from "./ResponsivePanel.utils.js";

function getToggleGlyph(direction, open) {
  const raw = String(direction || "").trim().toLowerCase();
  if (raw === "top-down") return open ? "▴" : "▾";
  if (raw === "zoom" || raw === "zoom-in-out") return open ? "−" : "+";
  if (raw === "left-right") return open ? "◂" : "▸";
  return open ? "▴" : "▾";
}

function getIsMobile() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < RESPONSIVE_PANEL_MOBILE_BREAKPOINT;
}

export default function ResponsivePanel({
  title = "",
  subtitle = "",
  headerContent = null,
  children,
  width = "100%",
  open = undefined,
  defaultOpen = true,
  onOpenChange,
  collapseDirection = "top-down",
  headerActions = null,
  className = "",
  style = {},
  bodyClassName = "",
  showToggle = true,
  border = "desktop",
  headerMode = "always",
}) {
  const [isMobile, setIsMobile] = useState(getIsMobile);
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isControlled = typeof open === "boolean";
  const isOpen = isControlled ? open : internalOpen;
  const panelWidth = isMobile ? "100%" : normalizeResponsivePanelWidth(width);
  const effectiveDirection = isMobile ? "top-down" : collapseDirection;
  const motionClass = resolveResponsivePanelMotionClass(effectiveDirection);
  const borderClass = resolveResponsivePanelBorderClass(border);
  const effectiveShowToggle = isMobile
    ? Boolean(title || subtitle || headerContent || headerActions || showToggle)
    : showToggle;

  const toggleTitle = useMemo(
    () => (isOpen ? "Collapse panel" : "Open panel"),
    [isOpen],
  );
  const hasHeader = Boolean(
    title || subtitle || headerContent || headerActions || effectiveShowToggle,
  );
  const isToggleOnlyHeader = Boolean(
    effectiveShowToggle && !title && !subtitle && !headerContent && !headerActions,
  );
  const hideTitleWhenCollapsed =
    !isOpen && effectiveDirection === "left-right";

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const mq = window.matchMedia(
      `(max-width: ${RESPONSIVE_PANEL_MOBILE_BREAKPOINT - 1}px)`,
    );
    const onChange = (event) => setIsMobile(event.matches);
    setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const handleToggle = () => {
    const next = !isOpen;
    if (!isControlled) setInternalOpen(next);
    onOpenChange?.(next);
  };

  return (
    <section
      data-component="ResponsivePanel"
      className={[
        "responsive-panel",
        motionClass,
        borderClass,
        `responsive-panel--header-${headerMode}`,
        isMobile ? "is-mobile" : "is-desktop",
        isOpen ? "is-open" : "is-collapsed",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: panelWidth, ...style }}
    >
      {hasHeader ? (
        <div
          className={[
            "responsive-panel__header",
            isToggleOnlyHeader ? "is-toggle-only" : "",
            isOpen ? "" : "is-collapsed",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <div
            className={[
              "responsive-panel__title",
              hideTitleWhenCollapsed ? "is-hidden" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {headerContent}
            {title ? <div className="panel-label">{title}</div> : null}
            {subtitle ? (
              <div className="minor-text" style={{ fontSize: 11 }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
            {isOpen ? headerActions : null}
            {effectiveShowToggle ? (
              <button
                type="button"
                data-component="ResponsivePanel.Toggle"
                className="secondary-button responsive-panel__toggle"
                onClick={handleToggle}
                title={toggleTitle}
                aria-label={toggleTitle}
                aria-expanded={isOpen}
              >
                {getToggleGlyph(effectiveDirection, isOpen)}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
        data-component="ResponsivePanel.Body"
        className={["responsive-panel__body", bodyClassName]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </div>
    </section>
  );
}
