import "./GroupButtons.css";

function itemValue(item) {
  if (item && item.value !== undefined && item.value !== null) return item.value;
  return item?.label;
}

function normalizeSelectedItems(selectedItems) {
  if (!Array.isArray(selectedItems)) return null;
  return selectedItems.map((item) =>
    item && typeof item === "object" ? itemValue(item) : item,
  );
}

export default function GroupButtons({
  items = [],
  selectedItems = null,
  selectionMode = "single",
  onClick,
  onSelected,
  onChange,
  border_type = "multiple",
  className = "",
  buttonClassName = "",
  size = "md",
  type = "button",
  itemsLayout = "column",
  disabled = false,
  readOnly = false,
  ariaLabel,
  style,
  buttonStyle,
}) {
  const controlledValues = normalizeSelectedItems(selectedItems);
  const resolvedSelectedValues =
    controlledValues ||
    items.filter((item) => !!item?.selected).map((item) => itemValue(item));
  const selectedSet = new Set(resolvedSelectedValues);
  const safeSelectionMode =
    selectionMode === "multiple" ? "multiple" : "single";
  const visualType = String(type || "button").toLowerCase() === "checkbox"
    ? "checkbox"
    : "button";
  const htmlButtonType =
    type === "submit" || type === "reset" ? type : "button";
  const safeItemsLayout =
    String(itemsLayout || "column").toLowerCase() === "row"
      ? "row"
      : "column";

  const handleItemClick = (item, event) => {
    if (disabled || readOnly || item?.disabled) return;

    const value = itemValue(item);
    const isSelected = selectedSet.has(value);
    let nextSelectedValues = [];

    if (safeSelectionMode === "multiple") {
      nextSelectedValues = isSelected
        ? resolvedSelectedValues.filter((entry) => entry !== value)
        : [...resolvedSelectedValues, value];
    } else {
      nextSelectedValues = [value];
    }

    const nextSelectedItems = items.filter((entry) =>
      nextSelectedValues.includes(itemValue(entry)),
    );

    onClick?.(item, nextSelectedValues, event);
    onSelected?.(nextSelectedItems);
    onChange?.(nextSelectedValues, nextSelectedItems);
  };

  return (
    <div
      data-component="GroupButtons"
      className={[
        "group-buttons",
        `group-buttons--${size}`,
        `group-buttons--border-${border_type || "multiple"}`,
        `group-buttons--layout-${safeItemsLayout}`,
        `group-buttons--type-${visualType}`,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="group"
      aria-label={ariaLabel}
      aria-readonly={readOnly || undefined}
      style={style}
    >
      {items.map((item) => {
        const value = itemValue(item);
        const isSelected = selectedSet.has(value);
        return (
          <button
            key={item?.key || value}
            type={htmlButtonType}
            data-component="GroupButtons.Item"
            className={[
              isSelected ? "primary-button" : "secondary-button",
              "group-buttons__item",
              isSelected
                ? "group-buttons__item--active"
                : "group-buttons__item--inactive",
              buttonClassName,
              isSelected ? "active" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            onClick={(event) => handleItemClick(item, event)}
            disabled={disabled || readOnly || item?.disabled}
            aria-pressed={safeSelectionMode === "multiple" ? isSelected : undefined}
            title={item?.title}
            style={{ ...(buttonStyle || {}), ...(item?.style || {}) }}
          >
            {visualType === "checkbox" ? (
              <input
                type="checkbox"
                data-component="GroupButtons.Check"
                className="group-buttons__check"
                checked={isSelected}
                onChange={() => {}}
                tabIndex={-1}
                aria-hidden="true"
                disabled={disabled || readOnly || item?.disabled}
              />
            ) : null}
            <span
              data-component="GroupButtons.Label"
              className="group-buttons__label"
            >
              {item?.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
