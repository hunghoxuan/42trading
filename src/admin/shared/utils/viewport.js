export const MOBILE_VIEWPORT_BREAKPOINT = 768;

export function getMobileViewportMediaQuery() {
  return `(max-width: ${MOBILE_VIEWPORT_BREAKPOINT - 1}px)`;
}

export function getIsMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_VIEWPORT_BREAKPOINT;
}
