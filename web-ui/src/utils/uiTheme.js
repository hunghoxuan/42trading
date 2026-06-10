const FALLBACK_LIGHT = {
  bg: "#edf2f7",
  surface: "#f7f9fc",
  panel: "#eef3f8",
  border: "#d8e0ea",
  text: "#0f172a",
  muted: "#64748b",
};

const FALLBACK_DARK = {
  bg: "#0b0f14",
  surface: "#121821",
  panel: "#161c27",
  border: "#263244",
  text: "#e6edf3",
  muted: "#9fb0c4",
};

export function getUiThemeMode() {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

export function getUiThemeColors() {
  const mode = getUiThemeMode();
  if (typeof window === "undefined" || typeof document === "undefined") {
    return { mode, ...(mode === "light" ? FALLBACK_LIGHT : FALLBACK_DARK) };
  }

  const styles = getComputedStyle(document.documentElement);
  const read = (name, fallback) =>
    String(styles.getPropertyValue(name) || "").trim() || fallback;

  return {
    mode,
    bg: read("--bg", mode === "light" ? FALLBACK_LIGHT.bg : FALLBACK_DARK.bg),
    surface: read(
      "--surface",
      mode === "light" ? FALLBACK_LIGHT.surface : FALLBACK_DARK.surface,
    ),
    panel: read(
      "--panel",
      mode === "light" ? FALLBACK_LIGHT.panel : FALLBACK_DARK.panel,
    ),
    border: read(
      "--border",
      mode === "light" ? FALLBACK_LIGHT.border : FALLBACK_DARK.border,
    ),
    text: read(
      "--text",
      mode === "light" ? FALLBACK_LIGHT.text : FALLBACK_DARK.text,
    ),
    muted: read(
      "--muted",
      mode === "light" ? FALLBACK_LIGHT.muted : FALLBACK_DARK.muted,
    ),
  };
}
