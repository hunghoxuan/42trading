import { Children, isValidElement, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

function flattenOptions(children, groupLabel = "") {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement(child)) return [];

    if (String(child.type || "").toLowerCase() === "optgroup") {
      return flattenOptions(child.props.children, child.props.label || groupLabel);
    }

    if (String(child.type || "").toLowerCase() !== "option") return [];

    const rawValue = child.props.value ?? child.props.children ?? "";
    const rawLabel = child.props.children ?? rawValue ?? "";
    const labelText = Array.isArray(rawLabel)
      ? rawLabel.join("")
      : String(rawLabel ?? "");

    return [
      {
        value: String(rawValue ?? ""),
        label: groupLabel ? `${groupLabel}: ${labelText}` : labelText,
        disabled: Boolean(child.props.disabled),
      },
    ];
  });
}

function buildEventPayload({
  id,
  name,
  value,
  values,
  multiple,
}) {
  const selectedValues = Array.isArray(values)
    ? values.map((item) => String(item ?? ""))
    : [];
  const payload = {
    id,
    name,
    value: multiple ? selectedValues[0] || "" : String(value ?? ""),
    values: multiple ? selectedValues : undefined,
    selectedOptions: multiple
      ? selectedValues.map((item) => ({ value: item }))
      : [{ value: String(value ?? "") }],
  };
  return {
    target: payload,
    currentTarget: payload,
  };
}

function defaultSingleLabel(options, value) {
  return (
    options.find((option) => option.value === String(value ?? ""))?.label ||
    options[0]?.label ||
    "Select..."
  );
}

function defaultMultiLabel(options, values) {
  const normalized = Array.isArray(values)
    ? values.map((item) => String(item ?? ""))
    : [];
  if (!normalized.length) return "Select...";
  const labels = options
    .filter((option) => normalized.includes(option.value))
    .map((option) => option.label);
  if (!labels.length) return "Select...";
  if (labels.length === 1) return labels[0];
  return `${labels.length} selected`;
}

export default function FormComboSelect({
  children,
  value,
  onChange,
  multiple = false,
  disabled = false,
  readOnly = false,
  id,
  name,
  className = "",
  style,
  "aria-label": ariaLabel,
  title,
  searchable = false,
  searchPlaceholder = "Filter...",
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef(null);
  const options = useMemo(() => flattenOptions(children), [children]);
  const filteredOptions = useMemo(() => {
    const query = String(search || "").trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      String(option.label || "").toLowerCase().includes(query),
    );
  }, [options, search]);
  const normalizedValue = multiple
    ? Array.isArray(value)
      ? value.map((item) => String(item ?? ""))
      : []
    : String(value ?? "");
  const label = multiple
    ? defaultMultiLabel(options, normalizedValue)
    : defaultSingleLabel(options, normalizedValue);

  function emitChange(nextValue) {
    if (disabled || readOnly) return;
    if (multiple) {
      const currentValues = Array.isArray(normalizedValue) ? normalizedValue : [];
      const exists = currentValues.includes(nextValue);
      const nextValues = exists
        ? currentValues.filter((item) => item !== nextValue)
        : [...currentValues, nextValue];
      onChange?.(
        buildEventPayload({
          id,
          name,
          value: nextValues[0] || "",
          values: nextValues,
          multiple: true,
        }),
      );
      return;
    }

    onChange?.(
      buildEventPayload({
        id,
        name,
        value: nextValue,
        multiple: false,
      }),
    );
  }

  return (
    <DropdownMenu.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setSearch("");
          return;
        }
        window.requestAnimationFrame(() => {
          searchInputRef.current?.focus?.();
          searchInputRef.current?.select?.();
        });
      }}
    >
      <DropdownMenu.Trigger asChild>
        <button
          id={id}
          name={name}
          type="button"
          className={[
            "secondary-button",
            "combo-button-menu-trigger",
            "form-combo-select",
            className,
          ]
            .filter(Boolean)
            .join(" ")}
          style={style}
          disabled={disabled || readOnly}
          aria-readonly={readOnly || undefined}
          aria-label={ariaLabel}
          title={title}
          data-component="FormComboSelect"
        >
          <span className="combo-button-menu-trigger__label">{label}</span>
          <span
            aria-hidden="true"
            className="combo-button-menu-trigger__caret"
          >
            ▾
          </span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={[
            "combo-button-menu",
            multiple ? "combo-button-menu--multiple" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          align="start"
          sideOffset={6}
          data-component={multiple ? "FormMultiComboSelect" : "ComboButtonMenu"}
        >
          {searchable ? (
            <div className="combo-button-menu__filter-wrap">
              <input
                ref={searchInputRef}
                className="combo-button-menu__filter"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={searchPlaceholder}
                onKeyDown={(event) => event.stopPropagation()}
              />
            </div>
          ) : null}
          {filteredOptions.map((option) => {
            const isSelected = multiple
              ? normalizedValue.includes(option.value)
              : normalizedValue === option.value;
            return (
              <DropdownMenu.Item
                asChild
                key={`${option.value}::${option.label}`}
                disabled={option.disabled}
                onSelect={(event) => {
                  if (multiple) event.preventDefault();
                }}
              >
                <button
                  type="button"
                  className={isSelected ? "active" : ""}
                  data-checkbox-item={multiple ? "true" : undefined}
                  disabled={readOnly}
                  onClick={() => {
                    emitChange(option.value);
                    if (!multiple) setOpen(false);
                  }}
                >
                  {multiple ? (
                    <span className="combo-button-menu__check">
                      {isSelected ? "✓" : ""}
                    </span>
                  ) : null}
                  <span>{option.label}</span>
                </button>
              </DropdownMenu.Item>
            );
          })}
          {!filteredOptions.length ? (
            <div className="minor-text" style={{ padding: 10, fontSize: 11 }}>
              No matches
            </div>
          ) : null}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
