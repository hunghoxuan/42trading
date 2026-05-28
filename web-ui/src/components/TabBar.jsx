import React from "react";

export default function TabBar({ value, options = [], onChange, size = "sm" }) {
  const fontSize = size === "md" ? 12 : 11;
  const padding = size === "md" ? "6px 12px" : "4px 10px";
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {options.map((opt) => {
        const active = String(opt.value) === String(value);
        return (
          <button
            key={opt.value}
            type="button"
            className={`secondary-button ${active ? "active" : ""}`}
            disabled={opt.disabled}
            onClick={() => onChange?.(opt.value)}
            style={{ fontSize, padding, ...(opt.style || {}) }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
