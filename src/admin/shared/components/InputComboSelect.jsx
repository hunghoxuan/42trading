import { Children, isValidElement, useEffect, useMemo, useRef, useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

function normalizeItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      if (item && typeof item === "object") {
        const value = String(item.value ?? item.label ?? "").trim();
        return {
          value,
          label: String(item.label ?? item.value ?? "").trim() || value,
          disabled: Boolean(item.disabled),
        };
      }
      const value = String(item ?? "").trim();
      return {
        value,
        label: value,
        disabled: false,
      };
    })
    .filter((item) => item.value);
}

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

function resolveOptions(items, children) {
  const childOptions = flattenOptions(children);
  if (childOptions.length) return childOptions;
  return normalizeItems(items);
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
  const normalized = String(value ?? "").trim();
  if (!normalized) return "Select...";
  return (
    options.find((option) => option.value === normalized)?.label ||
    normalized ||
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

function matchesOption(text = "", option = {}) {
  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    String(option.value || "").trim().toLowerCase() === normalized ||
    String(option.label || "").trim().toLowerCase() === normalized
  );
}

function inferType(text = "", options = [], fallback = "value") {
  const normalized = String(text || "").trim();
  if (!normalized) return fallback === "param" ? "param" : "value";
  return options.some((option) => matchesOption(normalized, option)) ? "param" : "value";
}

export default function InputComboSelect({
  mode = "combo",
  children,
  items = [],
  value,
  text,
  type = "value",
  onChange,
  onSelected,
  multiple = false,
  disabled = false,
  readOnly = false,
  id,
  name,
  placeholder = "",
  className = "",
  style,
  "aria-label": ariaLabel,
  title,
  inputTitle,
  menuTitle,
  showType = true,
  matchTriggerWidth = true,
  searchable = false,
  searchPlaceholder = "Filter...",
  dataComponent,
}) {
  const effectiveMode =
    mode === "combo" && text !== undefined && text !== null
      ? "both"
      : mode;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchInputRef = useRef(null);
  const inputRef = useRef(null);
  const wrapperRef = useRef(null);
  const [menuWidth, setMenuWidth] = useState(0);
  const options = useMemo(() => resolveOptions(items, children), [items, children]);

  const normalizedComboValue = multiple
    ? Array.isArray(value)
      ? value.map((item) => String(item ?? ""))
      : []
    : String(value ?? "");
  const normalizedText = String(text ?? value ?? "");
  const normalizedType = inferType(normalizedText, options, type);

  const comboLabel = multiple
    ? defaultMultiLabel(options, normalizedComboValue)
    : defaultSingleLabel(options, normalizedComboValue);

  const filteredOptions = useMemo(() => {
    let query = "";
    if (effectiveMode === "combo") query = String(search || "").trim().toLowerCase();
    if (effectiveMode === "both") {
      query = String(searchable ? search : normalizedText).trim().toLowerCase();
    }
    if (!query) return options;
    return options.filter((option) =>
      String(option.label || "").toLowerCase().includes(query) ||
      String(option.value || "").toLowerCase().includes(query),
    );
  }, [effectiveMode, normalizedText, options, search, searchable]);
  const filteredEnabledOptions = useMemo(
    () => filteredOptions.filter((option) => !option.disabled),
    [filteredOptions],
  );
  const allFilteredSelected = useMemo(
    () =>
      multiple &&
      filteredEnabledOptions.length > 0 &&
      filteredEnabledOptions.every((option) => normalizedComboValue.includes(option.value)),
    [filteredEnabledOptions, multiple, normalizedComboValue],
  );
  const someFilteredSelected = useMemo(
    () =>
      multiple &&
      filteredEnabledOptions.some((option) => normalizedComboValue.includes(option.value)),
    [filteredEnabledOptions, multiple, normalizedComboValue],
  );
  const selectAllRef = useRef(null);

  useEffect(() => {
    if (!multiple || !selectAllRef.current) return;
    selectAllRef.current.indeterminate = someFilteredSelected && !allFilteredSelected;
  }, [allFilteredSelected, multiple, someFilteredSelected]);

  useEffect(() => {
    if (effectiveMode !== "both" || !matchTriggerWidth) return undefined;
    const updateWidth = () => {
      const nextWidth = wrapperRef.current?.offsetWidth || 0;
      setMenuWidth(nextWidth);
    };
    updateWidth();
    if (typeof window === "undefined") return undefined;
    window.addEventListener("resize", updateWidth);
    return () => window.removeEventListener("resize", updateWidth);
  }, [effectiveMode, items, matchTriggerWidth, showType, text]);

  function emitComboChange(nextValue) {
    if (disabled || readOnly) return;
    if (multiple) {
      const currentValues = Array.isArray(normalizedComboValue) ? normalizedComboValue : [];
      const exists = currentValues.includes(nextValue);
      const nextValues = exists
        ? currentValues.filter((item) => item !== nextValue)
        : [...currentValues, nextValue];
      const eventPayload = buildEventPayload({
        id,
        name,
        value: nextValues[0] || "",
        values: nextValues,
        multiple: true,
      });
      onChange?.(eventPayload);
      onSelected?.(nextValues, options.find((option) => option.value === nextValue) || null);
      return;
    }

    const eventPayload = buildEventPayload({
      id,
      name,
      value: nextValue,
      multiple: false,
    });
    onChange?.(eventPayload);
    onSelected?.(nextValue, options.find((option) => option.value === nextValue) || null);
  }

  function emitHybridChange(nextText, nextType = normalizedType) {
    onChange?.({
      text: nextText,
      type: nextType,
    });
  }

  if (effectiveMode === "text") {
    return (
      <input
        ref={inputRef}
        id={id}
        name={name}
        className={className}
        style={style}
        value={normalizedText}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        readOnly={readOnly}
        aria-label={ariaLabel}
        title={inputTitle || title}
        data-component={dataComponent || "InputComboSelect"}
      />
    );
  }

  if (effectiveMode === "both") {
    return (
      <DropdownMenu.Root
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSearch("");
            return;
          }
          if (searchable) {
            window.requestAnimationFrame(() => {
              searchInputRef.current?.focus?.();
              searchInputRef.current?.select?.();
            });
          }
        }}
      >
        <div
          ref={wrapperRef}
          className={[
            "value-param-input",
            showType ? "value-param-input--with-type" : "value-param-input--no-type",
            className,
          ].filter(Boolean).join(" ")}
          style={style}
          title={title}
          data-component={dataComponent || "InputComboSelect"}
        >
          {showType ? (
            <button
              type="button"
              className={[
                "value-param-input__type",
                normalizedType === "param" ? "is-param" : "is-value",
              ].join(" ")}
              disabled
              aria-hidden="true"
              tabIndex={-1}
            >
              {normalizedType === "param" ? "Param" : "Value"}
            </button>
          ) : null}
          <input
            ref={inputRef}
            id={id}
            name={name}
            className="value-param-input__input"
            value={normalizedText}
            onChange={(event) => {
              const nextText = event.target.value;
              emitHybridChange(nextText, inferType(nextText, options, type));
            }}
            onKeyDown={(event) => {
              if (
                event.key === "ArrowDown" &&
                !disabled &&
                !readOnly &&
                !open
              ) {
                event.preventDefault();
                setOpen(true);
              }
            }}
            placeholder={placeholder}
            disabled={disabled}
            readOnly={readOnly}
            aria-label={ariaLabel}
            title={inputTitle || title}
          />
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="value-param-input__trigger"
              disabled={disabled || readOnly}
              aria-label={menuTitle || "Show suggestions"}
              title={menuTitle || "Show suggestions"}
            >
              <span
                aria-hidden="true"
                className="combo-button-menu-trigger__caret"
              >
                ▾
              </span>
            </button>
          </DropdownMenu.Trigger>
        </div>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            className={[
              "combo-button-menu",
              "value-param-input__menu",
              matchTriggerWidth ? "value-param-input__menu--match-trigger" : "",
            ].join(" ")}
            style={
              matchTriggerWidth && menuWidth > 0
                ? {
                    width: menuWidth,
                    minWidth: menuWidth,
                    maxWidth: menuWidth,
                  }
                : undefined
            }
            side="bottom"
            align="end"
            sideOffset={6}
            collisionPadding={8}
            sticky="partial"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              inputRef.current?.focus?.();
            }}
            data-component={`${dataComponent || "InputComboSelect"}.Menu`}
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
            {filteredOptions.map((option) => (
              <DropdownMenu.Item asChild key={`${option.value}::${option.label}`}>
                <button
                  type="button"
                  className={matchesOption(normalizedText, option) ? "active" : ""}
                  onClick={() => {
                    emitHybridChange(option.value, "param");
                    onSelected?.(option.value, option);
                    setOpen(false);
                  }}
                >
                  {option.label}
                </button>
              </DropdownMenu.Item>
            ))}
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
          data-component={dataComponent || "InputComboSelect"}
        >
          <span className="combo-button-menu-trigger__label">{comboLabel}</span>
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
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={8}
          sticky="partial"
          data-component={multiple ? "FormMultiComboSelect" : dataComponent || "InputComboSelect.Menu"}
        >
          {searchable || multiple ? (
            <div className="combo-button-menu__toolbar">
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
              {multiple ? (
                <label
                  className="combo-button-menu__select-all"
                  onKeyDown={(event) => event.stopPropagation()}
                  title="Select all filtered"
                >
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label="Select all filtered"
                    checked={allFilteredSelected}
                    disabled={disabled || readOnly || !filteredEnabledOptions.length}
                    onChange={(event) => {
                      event.stopPropagation();
                      const filteredValues = filteredEnabledOptions.map((option) => option.value);
                      const currentValues = Array.isArray(normalizedComboValue)
                        ? normalizedComboValue
                        : [];
                      const nextValues = event.target.checked
                        ? [...new Set([...currentValues, ...filteredValues])]
                        : currentValues.filter((value) => !filteredValues.includes(value));
                      const eventPayload = buildEventPayload({
                        id,
                        name,
                        value: nextValues[0] || "",
                        values: nextValues,
                        multiple: true,
                      });
                      onChange?.(eventPayload);
                      onSelected?.(
                        nextValues,
                        filteredEnabledOptions.length === 1 ? filteredEnabledOptions[0] : null,
                      );
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                </label>
              ) : null}
            </div>
          ) : null}
          {filteredOptions.map((option) => {
            const isSelected = multiple
              ? normalizedComboValue.includes(option.value)
              : normalizedComboValue === option.value;
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
                    emitComboChange(option.value);
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
