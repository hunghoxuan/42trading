import { useMemo } from "react";

function normalizeOption(option) {
  if (option && typeof option === "object") {
    const value = String(option.value || "").trim();
    if (!value) return null;
    return {
      value,
      label: String(option.label || value),
      disabled: Boolean(option.disabled),
    };
  }
  const value = String(option || "").trim();
  if (!value) return null;
  return { value, label: value, disabled: false };
}

function normalizeValue(value, multiple) {
  if (multiple) {
    return Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  }
  return String(value || "").trim();
}

export default function TimeframeSelector({
  value,
  onChange,
  options = [],
  multiple = false,
  allowEmpty = true,
  className = "",
  buttonClassName = "",
  size = "md",
  disabled = false,
  ariaLabel = "Timeframes",
}) {
  const items = useMemo(
    () => options.map(normalizeOption).filter(Boolean),
    [options],
  );
  const normalizedValue = normalizeValue(value, multiple);

  const selectedSet = useMemo(
    () =>
      new Set(
        multiple ? normalizedValue : normalizedValue ? [normalizedValue] : [],
      ),
    [multiple, normalizedValue],
  );

  const itemOrder = useMemo(() => {
    const map = new Map();
    items.forEach((item, index) => map.set(item.value, index));
    return map;
  }, [items]);

  const emitChange = (next) => {
    if (typeof onChange === "function") onChange(next);
  };

  const toggleValue = (nextValue) => {
    if (disabled) return;
    if (multiple) {
      const exists = selectedSet.has(nextValue);
      let next = exists
        ? normalizedValue.filter((item) => item !== nextValue)
        : [...normalizedValue, nextValue];
      if (!allowEmpty && next.length === 0) return;
      next = [...new Set(next)].sort(
        (a, b) => (itemOrder.get(a) ?? 999) - (itemOrder.get(b) ?? 999),
      );
      emitChange(next);
      return;
    }
    if (normalizedValue === nextValue) {
      if (!allowEmpty) return;
      emitChange("");
      return;
    }
    emitChange(nextValue);
  };

  return (
    <>
      {/* <!-- COMPONENT: TimeframeSelector --> */}
      <div
        className={`tf-selector tf-selector--${size}${disabled ? " is-disabled" : ""}${className ? ` ${className}` : ""}`}
        role={multiple ? "group" : "radiogroup"}
        aria-label={ariaLabel}
        data-component="TimeframeSelector"
      >
        {items.map((item) => {
          const active = selectedSet.has(item.value);
          return (
            <button
              key={item.value}
              type="button"
              className={`tf-selector__button${active ? " is-active" : ""}${buttonClassName ? ` ${buttonClassName}` : ""}`}
              onClick={() => toggleValue(item.value)}
              disabled={disabled || item.disabled}
              aria-pressed={multiple ? active : undefined}
              aria-checked={!multiple ? active : undefined}
              role={multiple ? undefined : "radio"}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {/* <!-- /COMPONENT: TimeframeSelector --> */}
    </>
  );
}
