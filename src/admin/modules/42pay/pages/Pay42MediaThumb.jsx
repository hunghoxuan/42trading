import { useState } from "react";

function initialsFromLabel(label = "") {
  const words = String(label || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "42";
  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function normalizeMediaSrc(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const resolved = new URL(raw, window.location.origin);
    const host = String(resolved.hostname || "").trim().toLowerCase();
    if (
      host === "images.example.test" ||
      host === "example.test" ||
      host.endsWith(".example.test")
    ) {
      return "";
    }
    return resolved.toString();
  } catch {
    return raw;
  }
}

export default function Pay42MediaThumb({
  src = "",
  alt = "",
  label = "",
  className = "pay42-thumb",
  kind = "product",
}) {
  const [failed, setFailed] = useState(false);
  const imageSrc = normalizeMediaSrc(src);
  const showImage = Boolean(imageSrc) && !failed;
  const fallbackText = kind === "qr" ? "QR" : initialsFromLabel(label || alt);

  if (showImage) {
    return (
      <img
        src={imageSrc}
        alt={alt || label || "42Pay media"}
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div
      className={`${className} pay42-thumb-fallback${kind === "qr" ? " pay42-thumb-fallback--qr" : ""}`}
      aria-label={alt || label || "42Pay media"}
      title={label || alt || "42Pay media"}
    >
      <span>{fallbackText}</span>
    </div>
  );
}
