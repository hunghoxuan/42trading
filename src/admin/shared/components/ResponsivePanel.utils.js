export { MOBILE_VIEWPORT_BREAKPOINT as RESPONSIVE_PANEL_MOBILE_BREAKPOINT } from "../utils/viewport.js";

export function normalizeResponsivePanelWidth(width) {
  if (typeof width === "number" && Number.isFinite(width)) return `${width}px`;
  const raw = String(width || "").trim();
  if (!raw) return "100%";
  return raw;
}

export function resolveResponsivePanelMotionClass(direction) {
  const raw = String(direction || "").trim().toLowerCase();
  if (raw === "left-right") return "responsive-panel--motion-horizontal";
  if (raw === "top-down") return "responsive-panel--motion-vertical";
  if (raw === "zoom" || raw === "zoom-in-out") {
    return "responsive-panel--motion-zoom";
  }
  return "responsive-panel--motion-vertical";
}

export function resolveResponsivePanelBorderClass(border) {
  const raw = String(border || "").trim().toLowerCase();
  if (raw === "none") return "responsive-panel--border-none";
  if (raw === "mobile") return "responsive-panel--border-mobile";
  if (raw === "always") return "responsive-panel--border-always";
  return "responsive-panel--border-desktop";
}
