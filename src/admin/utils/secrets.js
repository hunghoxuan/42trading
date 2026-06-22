export function maskSecretPreview(value) {
  const raw = String(value || "");
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 1)}****${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}****${raw.slice(-4)}`;
}
