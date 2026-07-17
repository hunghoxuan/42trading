export default function BooleanButton({
  checked = false,
  defaultChecked,
  onChange,
  disabled = false,
  readOnly = false,
  name,
  value,
  id,
  title,
  mode = "toggle_button",
  label = "",
  description = "",
  count = null,
  tone = "#22d3ee",
  compact = false,
  style = {},
  inputProps = {},
  ...rest
}) {
  const isChecked =
    typeof checked === "boolean"
      ? checked
      : Boolean(defaultChecked);
  const visualMode =
    String(mode || "toggle_button").trim().toLowerCase() === "checkbox"
      ? "checkbox"
      : "toggle_button";
  const textColor = isChecked ? "#e2e8f0" : "#94a3b8";

  const handleToggle = (event) => {
    if (disabled || readOnly) return;
    onChange?.({
      ...event,
      target: {
        ...event.target,
        checked: !isChecked,
        name,
        value,
        id,
      },
      currentTarget: {
        ...event.currentTarget,
        checked: !isChecked,
        name,
        value,
        id,
      },
    });
  };

  return (
    <button
      type="button"
      className={[
        "secondary-button",
        "boolean-button",
        compact ? "boolean-button--compact" : "",
        isChecked ? "active" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="checkbox"
      aria-checked={isChecked}
      aria-readonly={readOnly || undefined}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={title}
      onClick={handleToggle}
      style={{
        display: "grid",
        gridTemplateColumns: visualMode === "checkbox" ? "16px minmax(0, 1fr)" : "minmax(0, 1fr)",
        alignItems: "center",
        gap: visualMode === "checkbox" ? 10 : 6,
        width: "100%",
        minWidth: 0,
        minHeight: compact ? 28 : 40,
        padding: compact ? "3px 8px" : "8px 10px",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        textAlign: "left",
        ...style,
      }}
      {...rest}
    >
      <input
        type="checkbox"
        checked={isChecked}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={value}
        id={id}
        style={{
          display: visualMode === "checkbox" ? "inline-block" : "none",
          margin: 0,
          pointerEvents: "none",
        }}
        {...inputProps}
      />
      <span style={{ minWidth: 0, display: "grid", gap: 2 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0,
            minWidth: 0,
          }}
        >
          <span
            style={{
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              color: textColor,
              fontSize: compact ? 10 : 12,
              fontWeight: 700,
              lineHeight: 1.1,
            }}
          >
            {label}
          </span>
        </span>
      </span>
    </button>
  );
}
